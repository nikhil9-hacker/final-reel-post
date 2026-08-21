import fs from 'fs';
import path from 'path';
import { findDriveFile, refreshAccessTokenIfNeeded } from './google.js';
import { getUsers, getAllGoogleUsers } from './db.js';

const CACHE_DIR = path.join('/tmp', 'reels_cache');
const inFlightDownloads = new Map<string, Promise<{ filePath: string; actualFileId: string }>>();

// Ensure cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.error('[VideoCache] Failed to create cache directory:', err);
}

export function getLocalVideoPath(fileId: string): string | null {
  const filePath = path.join(CACHE_DIR, `${fileId}.mp4`);
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 0) {
        return filePath;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function ensureLocalVideoCached(fileId: string, googleToken: string, fileName?: string): Promise<{ filePath: string; actualFileId: string }> {
  const filePath = path.join(CACHE_DIR, `${fileId}.mp4`);
  
  // Check if valid cache exists
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 0) {
        return { filePath, actualFileId: fileId };
      }
    } catch {
      // Continue to re-download
    }
  }

  // Deduplicate concurrent downloads for the same file
  if (inFlightDownloads.has(fileId)) {
    return inFlightDownloads.get(fileId)!;
  }

  const downloadPromise = (async () => {
    let effectiveId = fileId;
    let currentToken = googleToken;
    console.log(`[VideoCache] Caching Google Drive video ${fileId} (${fileName || 'unknown'}) to ${filePath}...`);
    const tempPath = `${filePath}.tmp_${Date.now()}`;

    try {
      let driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${effectiveId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });

      // If initial fetch was not ok (401, 404, 403), search across all available Google users and fuzzy match
      if (!driveRes.ok) {
        console.warn(`[VideoCache] Initial download for ${effectiveId} returned ${driveRes.status}. Trying all connected Google accounts & fuzzy find...`);
        const allUsers = getAllGoogleUsers();
        
        for (const user of allUsers) {
          try {
            const userToken = await refreshAccessTokenIfNeeded(user, false);
            // Try downloading directly with effectiveId
            let userDriveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${effectiveId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
              headers: { Authorization: `Bearer ${userToken}` }
            });

            if (userDriveRes.ok) {
              console.log(`[VideoCache] Successfully accessed ${effectiveId} using account ${user.email}`);
              driveRes = userDriveRes;
              currentToken = userToken;
              break;
            }

            // If not found and fileName is available, search Drive of this user
            if (fileName) {
              const fallback = await findDriveFile(userToken, '', fileName);
              if (fallback && fallback.id) {
                console.log(`[VideoCache] Found matching file ${fallback.name} (ID: ${fallback.id}) in ${user.email}'s Drive`);
                const fallbackRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fallback.id}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
                  headers: { Authorization: `Bearer ${userToken}` }
                });
                if (fallbackRes.ok) {
                  effectiveId = fallback.id;
                  driveRes = fallbackRes;
                  currentToken = userToken;
                  break;
                }
              }
            }
          } catch (accountErr) {
            console.warn(`[VideoCache] Error checking account ${user.email}:`, accountErr);
          }
        }
      }

      // If still not ok and fileName exists, try findDriveFile with currentToken
      if (!driveRes.ok && fileName) {
        try {
          const fallback = await findDriveFile(currentToken, '', fileName);
          if (fallback && fallback.id && fallback.id !== effectiveId) {
            console.log(`[VideoCache] Found replacement binary video ID ${fallback.id} for "${fileName}". Downloading...`);
            effectiveId = fallback.id;
            driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${effectiveId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
              headers: { Authorization: `Bearer ${currentToken}` }
            });
          }
        } catch {}
      }

      if (!driveRes.ok) {
        let errorDetail = '';
        let errorReason = '';
        try {
          const errorBody = await driveRes.text();
          try {
            const parsed = JSON.parse(errorBody);
            errorDetail = parsed?.error?.message || parsed?.error?.errors?.[0]?.message || parsed?.error_description || '';
            errorReason = parsed?.error?.errors?.[0]?.reason || '';
          } catch {
            errorDetail = errorBody.substring(0, 300);
          }
        } catch {}

        if (driveRes.status === 404) {
          throw new Error(`Google Drive video "${fileName || fileId}" was not found (404 Not Found). The file may have been moved, deleted, or permissions changed in Google Drive.`);
        }

        if (driveRes.status === 403) {
          if (errorDetail.includes('Only files with binary content can be downloaded') || errorDetail.includes('Docs Editors')) {
            throw new Error(`Google Drive file "${fileName || fileId}" is a Google Docs/Sheet/editor document and cannot be downloaded as a video. Please upload a valid MP4 or MOV video file to Google Drive.`);
          }
          if (errorReason === 'rateLimitExceeded' || errorReason === 'userRateLimitExceeded' || errorReason === 'downloadQuotaExceeded' || errorDetail.toLowerCase().includes('quota') || errorDetail.toLowerCase().includes('rate limit')) {
            throw new Error(`Google Drive download rate limit/quota reached for video "${fileName || fileId}" (403 Forbidden). Google temporarily limits high-frequency downloads for this file. The scheduler will retry.`);
          }
          if (errorReason === 'insufficientFilePermissions' || errorDetail.toLowerCase().includes('permission') || errorDetail.toLowerCase().includes('insufficient')) {
            throw new Error(`Google Drive permission denied for "${fileName || fileId}" (403 Forbidden). Please check that your Google account has permission to download this file, or reconnect Google Drive in Settings.`);
          }
          throw new Error(`Google Drive download forbidden (403 Forbidden)${errorDetail ? ': ' + errorDetail : ''}. Please verify Google Drive permissions or reconnect your account in Settings.`);
        }

        if (driveRes.status === 401) {
          throw new Error(`Google authentication expired (401 Unauthorized). Please reconnect Google Drive in Settings.`);
        }

        throw new Error(`Google Drive download failed with status ${driveRes.status}: ${errorDetail || driveRes.statusText}`);
      }

      const buffer = await driveRes.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw new Error(`Downloaded video buffer for ${fileName || fileId} is empty.`);
      }

      fs.writeFileSync(tempPath, Buffer.from(buffer));
      fs.renameSync(tempPath, filePath);

      // If effective ID is different, also cache or link to effectiveId.mp4
      if (effectiveId !== fileId) {
        const altPath = path.join(CACHE_DIR, `${effectiveId}.mp4`);
        try {
          fs.copyFileSync(filePath, altPath);
        } catch {}
      }

      console.log(`[VideoCache] Successfully cached ${fileId} (${buffer.byteLength} bytes)`);
      return { filePath, actualFileId: effectiveId };
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    } finally {
      inFlightDownloads.delete(fileId);
    }
  })();

  inFlightDownloads.set(fileId, downloadPromise);
  return downloadPromise;
}

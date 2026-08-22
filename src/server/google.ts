import { User } from '../types.js';
import { saveUser, addLog, getDriveFolderConfig, getGoogleOAuthConfig } from './db.js';
import fs from 'fs';
import path from 'path';

// Load fallback client ID and client secret from configuration files if not present in env
let fallbackClientId = '';
let fallbackClientSecret = '';

try {
  const secretsPath = path.join(process.cwd(), 'google-client-secret.json');
  if (fs.existsSync(secretsPath)) {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const webConfig = secrets.web || secrets.installed;
    if (webConfig) {
      fallbackClientId = webConfig.client_id || '';
      fallbackClientSecret = webConfig.client_secret || '';
    }
  }
} catch (err) {
  console.error('Failed to read fallback credentials from google-client-secret.json:', err);
}

if (!fallbackClientId) {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.oAuthClientId) {
        fallbackClientId = config.oAuthClientId;
      }
    }
  } catch (err) {
    console.error('Failed to read fallback client ID from firebase-applet-config.json:', err);
  }
}

/**
 * Dynamically retrieves clean, sanitized Google OAuth Credentials.
 * Priority:
 * 1. Stored custom credentials in database (configured via UI / Settings)
 * 2. Process environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
 * 3. Fallback credentials from google-client-secret.json
 */
export function getGoogleOAuthCredentials(): { clientId: string; clientSecret: string } {
  // 1. Database-saved custom configuration
  const dbConfig = getGoogleOAuthConfig();
  if (dbConfig?.clientId && dbConfig?.clientSecret) {
    return {
      clientId: dbConfig.clientId.trim().replace(/^["']|["']$/g, ''),
      clientSecret: dbConfig.clientSecret.trim().replace(/^["']|["']$/g, '')
    };
  }

  // 2. Environment variables with whitespace & quotes cleanup
  const envClientId = (process.env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  const envClientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');

  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret
    };
  }

  // 3. Fallback credentials
  return {
    clientId: envClientId || fallbackClientId || '',
    clientSecret: envClientSecret || fallbackClientSecret || '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'
  };
}

export function getGoogleAuthUrl(redirectUri: string): string {
  const { clientId } = getGoogleOAuthCredentials();
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errJson: any = null;
    try {
      errJson = JSON.parse(errText);
    } catch {}
    if (errJson?.error === 'invalid_client' || errText.includes('client secret is invalid')) {
      throw new Error(`Google exchange failed: The provided Google Client Secret is invalid. Please check your Google OAuth credentials in Google Cloud Console / Settings.`);
    }
    throw new Error(`Google exchange failed: ${errText}`);
  }

  return response.json();
}

export async function getUserProfile(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user profile from Google');
  }

  return response.json();
}

export async function refreshAccessTokenIfNeeded(user: User, forceRefresh: boolean = false): Promise<string> {
  const isExpired = forceRefresh || (Date.now() >= user.googleTokenExpiry - 60000); // 1 min buffer
  if (!isExpired && user.googleAccessToken) {
    return user.googleAccessToken;
  }

  if (!user.googleRefreshToken) {
    if (user.googleAccessToken) {
      return user.googleAccessToken;
    }
    throw new Error('No Google refresh token available. Please reconnect Google Drive.');
  }

  addLog({
    action: 'REFRESH_GOOGLE_TOKEN',
    status: 'info',
    apiRequest: 'POST https://oauth2.googleapis.com/token'
  });

  try {
    const { clientId, clientSecret } = getGoogleOAuthCredentials();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: user.googleRefreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error_description || data.error || 'Unknown error';
      if (data.error === 'invalid_client' || errMsg.includes('client secret is invalid')) {
        console.warn(`[Google Token Refresh]: Client Secret mismatch for ${user.email}.`);
        throw new Error(`The provided Google Client Secret is invalid. Please update your Google OAuth credentials in Settings.`);
      }
      throw new Error(errMsg);
    }

    const updatedUser: User = {
      ...user,
      googleAccessToken: data.access_token,
      googleTokenExpiry: Date.now() + (data.expires_in * 1000),
    };

    // If Google returned a new refresh token (sometimes happens), save it
    if (data.refresh_token) {
      updatedUser.googleRefreshToken = data.refresh_token;
    }

    saveUser(updatedUser);
    addLog({
      action: 'REFRESH_GOOGLE_TOKEN',
      status: 'success',
      apiResponse: 'Google Access Token refreshed successfully.'
    });

    return updatedUser.googleAccessToken;
  } catch (err: any) {
    addLog({
      action: 'REFRESH_GOOGLE_TOKEN',
      status: 'error',
      errorMessage: err.message
    });
    // Fall back to returning current access token rather than hard crashing if possible
    if (user.googleAccessToken) {
      console.warn('Returning cached access token as fallback:', err.message);
      return user.googleAccessToken;
    }
    throw err;
  }
}

function parseDriveApiError(errText: string, actionName: string): string {
  try {
    const json = JSON.parse(errText);
    if (json.error) {
      const msg = json.error.message || '';
      const status = json.error.status || '';
      const code = json.error.code;
      const reasons = (json.error.errors || []).map((e: any) => e.reason).join(' ');

      if (status === 'PERMISSION_DENIED' || msg.includes('unregistered callers') || reasons.includes('accessNotConfigured') || msg.includes('API has not been used')) {
        return `Google Drive API is not enabled in your Google Cloud project. Please enable 'Google Drive API' in Google Cloud Console (APIs & Services > Library).`;
      }
      if (code === 403 || reasons.includes('insufficientPermissions') || msg.includes('insufficient authentication scopes')) {
        return `Google Drive permission denied (403). The granted token is missing Drive read/write scopes. Please disconnect and reconnect Google Drive with all requested permissions checked.`;
      }
      if (code === 401 || reasons.includes('authError') || msg.includes('Invalid Credentials') || msg.includes('authError')) {
        return `Google Drive session expired or unauthorized. Please re-authenticate your Google Drive in Dashboard.`;
      }
      if (reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded')) {
        return `Google Drive rate limit reached. Please wait a few moments before syncing again.`;
      }
      if (msg) {
        return `${actionName}: ${msg}`;
      }
    }
  } catch {}
  return `${actionName}: ${errText}`;
}

export async function getTokenInfo(accessToken: string): Promise<{ scopes: string[]; email?: string; expiresIn?: number; valid: boolean; error?: string }> {
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`);
    if (!res.ok) {
      const errText = await res.text();
      return { scopes: [], valid: false, error: errText };
    }
    const data = await res.json();
    const scopeStr: string = data.scope || '';
    const scopes = scopeStr.split(/\s+/).filter(Boolean);
    return {
      scopes,
      email: data.email,
      expiresIn: data.expires_in,
      valid: true
    };
  } catch (err: any) {
    return { scopes: [], valid: false, error: err.message };
  }
}

// Drive integration
export async function listFolders(accessToken: string) {
  const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const params = new URLSearchParams({
    q,
    pageSize: '100',
    fields: 'files(id, name)',
    orderBy: 'name',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(parseDriveApiError(errText, 'Failed to list folders'));
  }

  const data = await response.json();
  return data.files || [];
}

export interface VideoMediaMetadata {
  width?: number;
  height?: number;
  durationMillis?: string;
}

export interface DriveVideoItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  hasThumbnail?: boolean;
  videoMediaMetadata?: VideoMediaMetadata;
  iconLink?: string;
  webViewLink?: string;
  captionFileId?: string;
  captionFileName?: string;
  captionText: string;
  isTweaked?: boolean;
}

export interface SyncResult {
  videos: DriveVideoItem[];
}

export async function syncDriveFolder(accessToken: string, folderId: string): Promise<SyncResult> {
  // Query all files in the given folder
  const q = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    pageSize: '500',
    fields: 'files(id, name, mimeType, size, thumbnailLink, hasThumbnail, videoMediaMetadata, iconLink, webViewLink)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(parseDriveApiError(errText, 'Failed to list files in folder'));
  }

  const data = await response.json();
  const files: any[] = data.files || [];

  // Categorize files
  const videoFiles = files.filter(f => f.mimeType?.startsWith('video/') || f.name?.toLowerCase().endsWith('.mp4') || f.name?.toLowerCase().endsWith('.mov'));
  const textFiles = files.filter(f => f.mimeType === 'text/plain' || f.name?.toLowerCase().endsWith('.txt'));

  const videos: SyncResult['videos'] = [];

  for (const video of videoFiles) {
    // Determine the base name without extension
    const videoBase = video.name.substring(0, video.name.lastIndexOf('.')) || video.name;
    const videoBaseLower = videoBase.toLowerCase();

    // Match caption file:
    // 1. Exact match (e.g. video1.mp4 and video1.txt)
    // 2. Starts with same base or index (e.g. video1.mp4 and caption1.txt or video1_caption.txt)
    let matchingTxt = textFiles.find(t => {
      const txtBase = t.name.substring(0, t.name.lastIndexOf('.')) || t.name;
      const txtBaseLower = txtBase.toLowerCase();
      // Exact base match
      if (txtBaseLower === videoBaseLower) return true;
      // Match "video1" vs "caption1"
      const videoNum = videoBaseLower.match(/\d+/)?.[0];
      const txtNum = txtBaseLower.match(/\d+/)?.[0];
      if (videoNum && txtNum && videoNum === txtNum) return true;
      // Substring match
      if (txtBaseLower.includes(videoBaseLower) || videoBaseLower.includes(txtBaseLower)) return true;
      return false;
    });

    let captionText = '';
    let captionFileId = undefined;
    let captionFileName = undefined;

    if (matchingTxt) {
      captionFileId = matchingTxt.id;
      captionFileName = matchingTxt.name;
      try {
        captionText = await downloadTextFile(accessToken, matchingTxt.id);
      } catch (err) {
        console.error(`Failed to read caption file ${matchingTxt.name}:`, err);
        captionText = `[Failed to load caption from ${matchingTxt.name}]`;
      }
    }

    // Enhance thumbnail link to higher resolution if available
    let enhancedThumbnail = video.thumbnailLink;
    if (enhancedThumbnail && enhancedThumbnail.includes('=s')) {
      enhancedThumbnail = enhancedThumbnail.replace(/=s\d+/, '=s480');
    }

    videos.push({
      id: video.id,
      name: video.name,
      mimeType: video.mimeType,
      size: video.size,
      thumbnailLink: enhancedThumbnail,
      hasThumbnail: video.hasThumbnail ?? Boolean(enhancedThumbnail),
      videoMediaMetadata: video.videoMediaMetadata,
      iconLink: video.iconLink,
      webViewLink: video.webViewLink,
      captionFileId,
      captionFileName,
      captionText
    });
  }

  return { videos };
}

export async function getFileThumbnail(accessToken: string, fileId: string): Promise<{ buffer: Buffer; contentType: string } | { redirectUrl: string } | null> {
  try {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,thumbnailLink,hasThumbnail,videoMediaMetadata&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    let thumbUrl = meta.thumbnailLink;
    if (!thumbUrl) {
      return null;
    }
    // High-res parameter adjustment
    if (thumbUrl.includes('=s')) {
      thumbUrl = thumbUrl.replace(/=s\d+/, '=s480');
    } else if (thumbUrl.includes('=w')) {
      thumbUrl = thumbUrl.replace(/=w\d+/, '=w480');
    }

    const imgRes = await fetch(thumbUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (imgRes.ok) {
      const arrayBuf = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      return { buffer: Buffer.from(arrayBuf), contentType };
    } else {
      return { redirectUrl: thumbUrl };
    }
  } catch (err) {
    console.error(`[GoogleDrive] Failed to get thumbnail for ${fileId}:`, err);
    return null;
  }
}

async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download text file: ${response.statusText}`);
  }

  return response.text();
}

export async function downloadFileStream(accessToken: string, fileId: string, rangeHeader?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file stream from Google Drive: ${response.statusText}`);
  }

  return response;
}

export async function findOrCreateReelsFolder(accessToken: string): Promise<{ id: string; name: string }> {
  // Search for an existing 'Reels' folder
  const q = "name = 'Reels' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const params = new URLSearchParams({
    q,
    pageSize: '1',
    fields: 'files(id, name)',
  });

  const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchResponse.ok) {
    const errText = await searchResponse.text();
    throw new Error(`Failed to search for 'Reels' folder: ${errText}`);
  }

  const searchData = await searchResponse.json();
  const existingFolder = searchData.files?.[0];

  if (existingFolder) {
    return { id: existingFolder.id, name: existingFolder.name };
  }

  // If not found, automatically create 'Reels' folder in the user's root Drive folder
  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Reels',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Failed to create 'Reels' folder: ${errText}`);
  }

  const newFolder = await createResponse.json();
  return { id: newFolder.id, name: newFolder.name };
}

export async function findDriveFile(accessToken: string, fileId: string, fileName?: string): Promise<{ id: string; name: string } | null> {
  const isGoogleAppsDoc = (mimeType?: string) => {
    if (!mimeType) return false;
    return (
      mimeType === 'application/vnd.google-apps.document' ||
      mimeType === 'application/vnd.google-apps.spreadsheet' ||
      mimeType === 'application/vnd.google-apps.presentation' ||
      mimeType === 'application/vnd.google-apps.folder' ||
      mimeType === 'application/vnd.google-apps.form' ||
      mimeType === 'application/vnd.google-apps.drawing' ||
      mimeType === 'application/vnd.google-apps.site'
    );
  };

  // 1. Check direct ID with all drive permissions & resolve shortcuts if any
  if (fileId) {
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,trashed,shortcutDetails&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.trashed) {
          // If this is a shortcut, resolve the actual target ID
          if (data.mimeType === 'application/vnd.google-apps.shortcut' && data.shortcutDetails?.targetId) {
            const targetMime = data.shortcutDetails.targetMimeType;
            if (!isGoogleAppsDoc(targetMime)) {
              console.log(`[GoogleDrive] Resolved shortcut ${fileId} -> ${data.shortcutDetails.targetId}`);
              return { id: data.shortcutDetails.targetId, name: data.name };
            }
          } else if (!isGoogleAppsDoc(data.mimeType)) {
            return { id: data.id, name: data.name };
          } else {
            console.warn(`[GoogleDrive] File ${fileId} is a Google Docs Editor file (${data.mimeType}), searching for binary video match instead...`);
          }
        }
      }
    } catch (err) {
      console.warn(`[GoogleDrive] Direct lookup for file ID ${fileId} failed:`, err);
    }
  }

  // 2. Search inside the active configured Reels folder first if set
  const folderConfig = getDriveFolderConfig();
  if (folderConfig?.selectedFolderId && fileName) {
    try {
      const params = new URLSearchParams({
        q: `'${folderConfig.selectedFolderId}' in parents and trashed = false`,
        pageSize: '200',
        fields: 'files(id, name, mimeType, shortcutDetails)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true'
      });
      const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (folderRes.ok) {
        const data = await folderRes.json();
        const rawFiles: Array<{ id: string; name: string; mimeType: string; shortcutDetails?: any }> = data.files || [];
        
        // Filter out Google Docs editor files (resolve shortcuts if valid)
        const validFiles = rawFiles
          .map(f => {
            if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId) {
              return { id: f.shortcutDetails.targetId, name: f.name, mimeType: f.shortcutDetails.targetMimeType || '' };
            }
            return f;
          })
          .filter(f => !isGoogleAppsDoc(f.mimeType));

        const normTarget = fileName.trim().toLowerCase();
        const normBaseTarget = fileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
        
        // Prioritize exact video matches
        const found = validFiles.find(f => f.name.trim().toLowerCase() === normTarget) ||
                      validFiles.find(f => (f.mimeType.startsWith('video/') || f.name.endsWith('.mp4')) && f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase() === normBaseTarget) ||
                      validFiles.find(f => f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase() === normBaseTarget) ||
                      validFiles.find(f => f.name.toLowerCase().includes(normBaseTarget) || normBaseTarget.includes(f.name.replace(/\.[^/.]+$/, '').toLowerCase()));
        
        if (found) {
          console.log(`[GoogleDrive] Located replacement binary video file ID ${found.id} inside connected folder for "${fileName}"`);
          return { id: found.id, name: found.name };
        }
      }
    } catch (err) {
      console.warn(`[GoogleDrive] Folder search for "${fileName}" failed:`, err);
    }
  }

  // 3. Search by filename variations across user's entire Drive
  if (fileName) {
    try {
      const cleanBase = fileName.replace(/\.[^/.]+$/, '').trim();
      const safeName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeBaseName = cleanBase.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      
      const searchQueries = [
        `name = '${safeName}' and trashed = false`,
        `name = '${safeBaseName}' and trashed = false`,
        `name contains '${safeBaseName}' and trashed = false`
      ];

      for (const qBase of searchQueries) {
        const q = `${qBase} and mimeType != 'application/vnd.google-apps.document' and mimeType != 'application/vnd.google-apps.spreadsheet' and mimeType != 'application/vnd.google-apps.presentation' and mimeType != 'application/vnd.google-apps.folder'`;
        const params = new URLSearchParams({
          q,
          pageSize: '20',
          fields: 'files(id, name, mimeType, trashed, shortcutDetails)',
          includeItemsFromAllDrives: 'true',
          supportsAllDrives: 'true'
        });
        const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (searchRes.ok) {
          const data = await searchRes.json();
          const rawFiles: any[] = data.files || [];
          for (const file of rawFiles) {
            if (file.mimeType === 'application/vnd.google-apps.shortcut' && file.shortcutDetails?.targetId) {
              if (!isGoogleAppsDoc(file.shortcutDetails.targetMimeType)) {
                return { id: file.shortcutDetails.targetId, name: file.name };
              }
            } else if (!isGoogleAppsDoc(file.mimeType)) {
              console.log(`[GoogleDrive] Located replacement binary file ID ${file.id} for "${fileName}"`);
              return { id: file.id, name: file.name };
            }
          }
        }
      }

      // 4. In-memory fuzzy match across recent video files in Drive
      const recentParams = new URLSearchParams({
        q: "trashed = false and mimeType != 'application/vnd.google-apps.document' and mimeType != 'application/vnd.google-apps.spreadsheet' and mimeType != 'application/vnd.google-apps.presentation' and mimeType != 'application/vnd.google-apps.folder'",
        pageSize: '150',
        fields: 'files(id, name, mimeType, shortcutDetails)',
        orderBy: 'modifiedTime desc',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true'
      });
      const videoListRes = await fetch(`https://www.googleapis.com/drive/v3/files?${recentParams.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (videoListRes.ok) {
        const data = await videoListRes.json();
        const allFiles: Array<{ id: string; name: string; mimeType?: string; shortcutDetails?: any }> = data.files || [];
        const cleanTarget = fileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
        
        const validRecentFiles = allFiles
          .map(f => {
            if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId) {
              return { id: f.shortcutDetails.targetId, name: f.name, mimeType: f.shortcutDetails.targetMimeType || '' };
            }
            return f;
          })
          .filter(f => !isGoogleAppsDoc(f.mimeType));

        // Prioritize actual video files
        const match = validRecentFiles.find(f => f.name.toLowerCase() === fileName.toLowerCase()) ||
                      validRecentFiles.find(f => (f.mimeType?.startsWith('video/') || f.name.endsWith('.mp4')) && f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase() === cleanTarget) ||
                      validRecentFiles.find(f => f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase() === cleanTarget) ||
                      validRecentFiles.find(f => cleanTarget.length >= 3 && (f.name.toLowerCase().includes(cleanTarget) || cleanTarget.includes(f.name.toLowerCase())));

        if (match) {
          console.log(`[GoogleDrive] Located replacement binary video file ID ${match.id} via fuzzy match for "${fileName}"`);
          return { id: match.id, name: match.name };
        }
      }
    } catch (err) {
      console.warn(`[GoogleDrive] Filename lookup for "${fileName}" failed:`, err);
    }
  }

  return null;
}

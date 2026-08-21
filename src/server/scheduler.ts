import { getSchedules, saveSchedule, getMetaConfig, getFirstUser, getUsers, getAllGoogleUsers, addLog, getAppUrl, getSystemHealthRecord, saveSystemHealthRecord, recordApiError, clearApiError } from './db.js';
import { refreshAccessTokenIfNeeded } from './google.js';
import { uploadReelDirectBinary, uploadReelContainer, checkContainerStatus, publishReel } from './meta.js';
import { ensureLocalVideoCached, getLocalVideoPath } from './videoCache.js';
import { optimizeForInstagramReel, probeVideo } from './videoOptimizer.js';
import { SystemHealth } from '../types.js';
import fs from 'fs';
import crypto from 'crypto';

let isRunning = false;
let runningSince = 0;
let cdnCooldownUntil = 0;
let checksSinceLastHealthLog = 0;

// Generate a secure temporary signature for video URLs
export function generateVideoToken(fileId: string): string {
  const secret = process.env.ENCRYPTION_SECRET || 'reelpilot-video-secret-salt-2026';
  // Standard HMAC to sign the fileId
  return crypto.createHmac('sha256', secret).update(fileId).digest('hex');
}

export function verifyVideoToken(fileId: string, token: string): boolean {
  const expected = generateVideoToken(fileId);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function forceResetWorker() {
  const wasRunning = isRunning;
  isRunning = false;
  runningSince = 0;
  saveSystemHealthRecord({
    isWorkerRunning: false,
    runningSince: null,
    lastCheckedStatus: 'idle',
    healthStatus: 'healthy'
  });
  addLog({
    action: 'WORKER_HEALTH',
    status: 'info',
    apiResponse: `Manual worker reset executed (wasRunning: ${wasRunning}). Reset lock and refreshed state.`
  });
  return { success: true, message: 'Worker state successfully reset.' };
}

export function getDetailedSystemHealth(): SystemHealth {
  const metaConfig = getMetaConfig();
  const user = getFirstUser();
  const schedules = getSchedules();
  const storedHealth = getSystemHealthRecord();
  const now = Date.now();

  const pendingDue = schedules.filter(
    s => s.scheduledTime <= now && (
      s.status === 'pending' || 
      (s.status === 'failed' && s.retryCount < 3) ||
      (s.status === 'publishing' && (now - s.createdAt > 3 * 60 * 1000))
    )
  ).length;

  const publishedPosts = schedules.filter(s => s.status === 'published');
  const lastPublished = publishedPosts.reduce((latest, s) => {
    const time = s.publishedAt || s.scheduledTime || 0;
    return time > latest ? time : latest;
  }, 0);

  const isStaleRun = isRunning && (now - runningSince > 5 * 60 * 1000);
  let healthStatus: 'healthy' | 'warning' | 'error' | 'idle' = 'healthy';

  if (!user || !metaConfig) {
    healthStatus = 'idle';
  } else if (isStaleRun) {
    healthStatus = 'warning';
  } else if (storedHealth.lastApiError && (now - storedHealth.lastApiError.timestamp < 30 * 60 * 1000)) {
    healthStatus = 'error';
  } else if (schedules.some(s => s.status === 'failed')) {
    healthStatus = 'warning';
  }

  return {
    lastCheckedAt: storedHealth.lastCheckedAt || (runningSince ? runningSince : now),
    lastCheckedStatus: storedHealth.lastCheckedStatus || (healthStatus === 'error' ? 'error' : 'healthy'),
    lastApiError: storedHealth.lastApiError || null,
    isWorkerRunning: isRunning,
    runningSince: isRunning ? runningSince : null,
    workerIntervalSeconds: 60,
    metaConnected: !!metaConfig,
    googleConnected: !!user,
    healthStatus,
    pendingDueCount: pendingDue,
    totalPending: schedules.filter(s => s.status === 'pending').length,
    totalPublished: publishedPosts.length,
    totalFailed: schedules.filter(s => s.status === 'failed').length,
    lastSuccessfulPublishAt: lastPublished > 0 ? lastPublished : null
  };
}

export async function pingSystemHealth(): Promise<SystemHealth> {
  const now = Date.now();
  const schedules = getSchedules();
  const metaConfig = getMetaConfig();
  const user = getFirstUser();
  
  saveSystemHealthRecord({
    lastCheckedAt: now,
    lastCheckedStatus: 'healthy'
  });

  const dueCount = schedules.filter(
    s => s.scheduledTime <= now && s.status === 'pending'
  ).length;

  const health = getDetailedSystemHealth();

  addLog({
    action: 'WORKER_HEALTH',
    status: health.lastApiError ? 'error' : 'info',
    apiResponse: `[System Health Ping] Worker heartbeat OK | Last checked at: ${new Date(now).toLocaleString()} | Queue: ${dueCount} due | Google: ${user ? 'Connected (' + user.email + ')' : 'Disconnected'} | Meta: ${metaConfig ? 'Connected (IG ID: ' + metaConfig.instagramBusinessAccountId + ')' : 'Not configured'} | Last API Error: ${health.lastApiError ? health.lastApiError.message : 'None'}`
  });

  // Also invoke check
  checkAndPublishPending().catch(e => console.error('Ping check error:', e));

  return health;
}

async function uploadToTmpfiles(buffer: Buffer, fileName: string = 'video.mp4'): Promise<string> {
  const formData = new FormData();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
  const fileBlob = new Blob([buffer], { type: 'video/mp4' });
  formData.append('file', fileBlob, safeName.endsWith('.mp4') ? safeName : `${safeName}.mp4`);

  const res = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: formData
  });

  if (!res.ok) {
    throw new Error(`Tmpfiles upload returned status ${res.status}`);
  }

  const json: any = await res.json();
  if (json?.status === 'success' && json?.data?.url) {
    // Transform https://tmpfiles.org/12345/video.mp4 -> https://tmpfiles.org/dl/12345/video.mp4 for direct raw download
    const rawUrl = json.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
    return rawUrl;
  }
  throw new Error(`Tmpfiles response invalid: ${JSON.stringify(json)}`);
}

async function uploadToLitterbox(buffer: Buffer, fileName: string = 'video.mp4'): Promise<string> {
  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  formData.append('time', '1h');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
  const fileBlob = new Blob([buffer], { type: 'video/mp4' });
  formData.append('fileToUpload', fileBlob, safeName.endsWith('.mp4') ? safeName : `${safeName}.mp4`);

  const uploadRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`Litterbox upload returned status ${uploadRes.status}`);
  }

  const url = await uploadRes.text();
  if (!url.startsWith('https://')) {
    throw new Error(`Litterbox upload failed with response: ${url.slice(0, 100)}`);
  }

  return url.trim();
}

async function uploadVideoToCdn(filePath: string, fileName: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  // Tier 1: Try tmpfiles.org
  try {
    console.log(`[VideoCDN] Attempting upload to tmpfiles.org CDN (${buffer.byteLength} bytes)...`);
    const tmpUrl = await uploadToTmpfiles(buffer, fileName);
    console.log(`[VideoCDN] Successfully uploaded to tmpfiles: ${tmpUrl}`);
    return tmpUrl;
  } catch (err: any) {
    console.warn(`[VideoCDN] Tmpfiles upload failed: ${err?.message || err}. Trying Litterbox...`);
  }

  // Tier 2: Try Litterbox
  try {
    console.log(`[VideoCDN] Attempting upload to Litterbox (${buffer.byteLength} bytes)...`);
    const litterboxUrl = await uploadToLitterbox(buffer, fileName);
    console.log(`[VideoCDN] Successfully uploaded to Litterbox: ${litterboxUrl}`);
    return litterboxUrl;
  } catch (err: any) {
    console.warn(`[VideoCDN] Litterbox upload failed: ${err?.message || err}`);
  }

  throw new Error('All external temporary CDNs are currently unavailable');
}

export async function checkAndPublishPending() {
  if (isRunning) {
    if (Date.now() - runningSince > 10 * 60 * 1000) {
      console.warn('[Scheduler] Worker run exceeded 10m timeout threshold. Force resetting isRunning flag.');
      isRunning = false;
      addLog({
        action: 'WORKER_HEALTH',
        status: 'error',
        errorMessage: 'Background worker exceeded 10-minute active execution threshold. Automatic concurrency recovery lock released.'
      });
    } else {
      console.log(`[Scheduler] Worker currently active (running for ${Math.round((Date.now() - runningSince) / 1000)}s), skipping duplicate trigger.`);
      return;
    }
  }

  isRunning = true;
  runningSince = Date.now();
  const checkTimestamp = runningSince;
  console.log('[Scheduler] Running schedule check at', new Date(checkTimestamp).toISOString());

  saveSystemHealthRecord({
    lastCheckedAt: checkTimestamp,
    isWorkerRunning: true,
    runningSince: checkTimestamp,
    lastCheckedStatus: 'running'
  });

  try {
    const schedules = getSchedules();
    const metaConfig = getMetaConfig();
    const user = getFirstUser();
    const users = getUsers();

    if (!user) {
      // No Google user connected yet, can't sync or run scheduler
      saveSystemHealthRecord({
        isWorkerRunning: false,
        runningSince: null,
        lastCheckedStatus: 'idle',
        healthStatus: 'idle'
      });
      isRunning = false;
      return;
    }

    if (!metaConfig) {
      // Meta is not configured yet
      saveSystemHealthRecord({
        isWorkerRunning: false,
        runningSince: null,
        lastCheckedStatus: 'idle',
        healthStatus: 'idle'
      });
      isRunning = false;
      return;
    }

    const now = Date.now();
    // Find schedules that are due (scheduledTime <= now) and are 'pending', 'failed' (retryCount < 3), or stuck 'publishing'
    const dueSchedules = schedules.filter(
      s => s.scheduledTime <= now && (
        s.status === 'pending' || 
        (s.status === 'failed' && s.retryCount < 3) ||
        (s.status === 'publishing' && (now - s.createdAt > 3 * 60 * 1000))
      )
    );

    checksSinceLastHealthLog++;
    if (dueSchedules.length > 0 || checksSinceLastHealthLog >= 15) {
      checksSinceLastHealthLog = 0;
      const storedHealth = getSystemHealthRecord();
      addLog({
        action: 'WORKER_HEALTH',
        status: storedHealth.lastApiError ? 'error' : 'info',
        apiResponse: `Scheduler check cycle complete at ${new Date(checkTimestamp).toLocaleTimeString()} | Queue: ${dueSchedules.length} due posts | Last API Error: ${storedHealth.lastApiError ? storedHealth.lastApiError.message : 'None (Healthy)'}`
      });
    }

    if (dueSchedules.length === 0) {
      saveSystemHealthRecord({
        isWorkerRunning: false,
        runningSince: null,
        lastCheckedStatus: 'healthy',
        healthStatus: 'healthy'
      });
      isRunning = false;
      return;
    }

    addLog({
      action: 'SCHEDULER_RUN',
      status: 'info',
      apiResponse: `Found ${dueSchedules.length} due scheduled posts: ${dueSchedules.map(s => `"${s.videoFileName}" (scheduled ${new Date(s.scheduledTime).toLocaleTimeString()})`).join(', ')}`
    });

    for (let i = 0; i < dueSchedules.length; i++) {
      const schedule = dueSchedules[i];
      try {
        console.log(`[Scheduler] [${i + 1}/${dueSchedules.length}] Processing schedule ${schedule.id} for file ${schedule.videoFileName}`);
        
        addLog({
          action: 'SCHEDULER_ITEM_START',
          status: 'info',
          videoFileName: schedule.videoFileName,
          instagramAccount: metaConfig.instagramBusinessAccountId,
          apiResponse: `Starting publication workflow for "${schedule.videoFileName}" (Queue item ${i + 1} of ${dueSchedules.length})`
        });

        // Mark as publishing first to avoid double runs
        schedule.status = 'publishing';
        saveSchedule(schedule);

        // Find relevant user or default user
        let scheduleUser = user;
        if ((schedule as any).userId) {
          const matchedUser = users.find(u => u.id === (schedule as any).userId);
          if (matchedUser) {
            scheduleUser = matchedUser;
          }
        }

        // Ensure google access token is fresh
        const googleToken = await refreshAccessTokenIfNeeded(scheduleUser);

        // Pre-cache video to local disk storage for instant zero-latency serving (with multi-account fallback)
        const { filePath: cachedFilePath, actualFileId } = await ensureLocalVideoCached(schedule.videoFileId, googleToken, schedule.videoFileName);
        
        if (actualFileId && actualFileId !== schedule.videoFileId) {
          console.log(`[Scheduler] Updating schedule videoFileId from ${schedule.videoFileId} to ${actualFileId}`);
          schedule.videoFileId = actualFileId;
          saveSchedule(schedule);
        }

        // Automatic Video Optimization for Instagram Reels specifications
        // (Enforces standard 90s max Reel duration, 9:16 vertical ratio, H.264/AAC standards, and faststart headers)
        const optResult = await optimizeForInstagramReel(cachedFilePath, 90);
        const uploadFilePath = optResult.filePath;

        if (optResult.wasOptimized) {
          console.log(`[Scheduler] Auto-optimized ${schedule.videoFileName}: ${optResult.reasons.join(', ')}`);
          addLog({
            action: 'OPTIMIZE_VIDEO',
            status: 'info',
            videoFileName: schedule.videoFileName,
            apiResponse: `Auto-optimized video for Instagram Reels: ${optResult.reasons.join('; ')}`
          });
        }

        let containerId = '';

        // Step 1: Upload media container to Instagram
        // Strategy A: Direct Resumable Upload (Meta recommended, streams video bytes directly to rupload.facebook.com to bypass URL crawling & error 2207082)
        try {
          console.log(`[Scheduler] Uploading ${schedule.videoFileName} via Meta Resumable Binary protocol (${optResult.wasOptimized ? 'Optimized' : 'Original'})...`);
          const videoBuffer = fs.readFileSync(uploadFilePath);
          containerId = await uploadReelDirectBinary(metaConfig, videoBuffer, schedule.captionText);
          console.log(`[Scheduler] Meta Resumable upload successful, container ID: ${containerId}`);
        } catch (directUploadErr: any) {
          console.warn(`[Scheduler] Direct Resumable binary upload encountered error (${directUploadErr?.message || directUploadErr}). Falling back to URL-based ingestion.`);
          
          addLog({
            action: 'SCHEDULER_UPLOAD_FALLBACK',
            status: 'info',
            videoFileName: schedule.videoFileName,
            errorMessage: `Direct binary upload fallback: ${directUploadErr?.message || directUploadErr}. Attempting URL container method.`
          });

          // Strategy B: URL-based container upload
          const videoToken = generateVideoToken(schedule.videoFileId);
          const appUrl = process.env.APP_URL || getAppUrl() || 'http://localhost:3000';
          const fallbackVideoUrl = `${appUrl}/api/public/video/${schedule.videoFileId}?token=${videoToken}`;

          let videoUrl = fallbackVideoUrl;
          const deliveryMode = metaConfig.videoDeliveryMode || 'auto';
          const isCdnCooldown = Date.now() < cdnCooldownUntil;

          if (deliveryMode !== 'proxy' && !isCdnCooldown) {
            try {
              console.log(`[Scheduler] Uploading video ${schedule.videoFileName} to high-speed CDN for Meta ingestion...`);
              videoUrl = await uploadVideoToCdn(uploadFilePath, schedule.videoFileName);
            } catch (cdnErr: any) {
              console.warn(`[Scheduler] External CDN upload unavailable (${cdnErr?.message || cdnErr}). Falling back to direct streaming proxy.`);
              cdnCooldownUntil = Date.now() + 15 * 60 * 1000;
              videoUrl = fallbackVideoUrl;
            }
          }

          console.log(`[Scheduler] Using URL container ingestion: ${videoUrl}`);
          containerId = await uploadReelContainer(metaConfig, videoUrl, schedule.captionText);
        }

        // Step 2: Poll container status until FINISHED
        let attempts = 0;
        let isFinished = false;
        let lastStatus = '';
        let statusErrorMessage = '';

        while (attempts < 20 && !isFinished) {
          console.log(`[Scheduler] Polling container ${containerId} status (attempt ${attempts + 1})...`);
          // Wait 15 seconds between polls
          await new Promise(resolve => setTimeout(resolve, 15000));

          const statusRes = await checkContainerStatus(metaConfig, containerId);
          lastStatus = statusRes.statusCode;
          
          if (lastStatus === 'FINISHED') {
            isFinished = true;
            addLog({
              action: 'CONTAINER_READY',
              status: 'success',
              videoFileName: schedule.videoFileName,
              instagramAccount: metaConfig.instagramBusinessAccountId,
              apiResponse: `Meta Container ${containerId} status is FINISHED (Ready for publication)`
            });
          } else if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
            statusErrorMessage = statusRes.errorMessage || 'Instagram video rendering error.';
            addLog({
              action: 'CONTAINER_ERROR',
              status: 'error',
              videoFileName: schedule.videoFileName,
              instagramAccount: metaConfig.instagramBusinessAccountId,
              errorMessage: `Meta Container ${containerId} error: ${statusErrorMessage}`,
              apiResponse: JSON.stringify(statusRes)
            });
            break;
          }
          attempts++;
        }

        if (!isFinished) {
          throw new Error(statusErrorMessage || `Instagram processing timed out or failed (status: ${lastStatus})`);
        }

        // Step 3: Publish container to make it live
        const postId = await publishReel(metaConfig, containerId);

        // Update schedule as successful
        schedule.status = 'published';
        schedule.instagramPostId = postId;
        schedule.publishedAt = Date.now();
        schedule.errorMessage = undefined;
        saveSchedule(schedule);

        // Mark system health healthy & update publish timestamp
        saveSystemHealthRecord({
          lastSuccessfulPublishAt: Date.now(),
          healthStatus: 'healthy',
          lastCheckedStatus: 'healthy'
        });
        clearApiError();

        addLog({
          action: 'PUBLISH_REEL',
          status: 'success',
          videoFileName: schedule.videoFileName,
          instagramAccount: metaConfig.instagramBusinessAccountId,
          apiResponse: `Successfully published Reel on Instagram. Post ID: ${postId}`
        });

        // Step 4: Handle recurrence
        if (schedule.recurrence !== 'single') {
          const nextTime = calculateNextScheduledTime(schedule.scheduledTime, schedule.recurrence);
          const nextSchedule = {
            ...schedule,
            id: crypto.randomUUID(),
            scheduledTime: nextTime,
            status: 'pending' as const,
            retryCount: 0,
            instagramPostId: undefined,
            publishedAt: undefined,
            createdAt: Date.now()
          };
          saveSchedule(nextSchedule);
          addLog({
            action: 'SCHEDULER_RECURRENCE',
            status: 'info',
            videoFileName: schedule.videoFileName,
            apiResponse: `Created next recurring post scheduled for ${new Date(nextTime).toLocaleString()}`
          });
        }

      } catch (err: any) {
        let userFriendlyMsg = 'Unknown scheduling error.';
        let isMissingFile = false;

        if (err) {
          const msg = err.message || '';
          const code = err.code || (err.raw?.error?.code);
          const type = err.type || (err.raw?.error?.type);
          
          if (msg.includes('API access blocked') || code === 200) {
            userFriendlyMsg = 'API access blocked (Meta Code 200). Your Meta Access Token may have expired or lacks the necessary permissions. Please ensure pages_read_engagement, pages_show_list, pages_manage_posts, and instagram_content_publish are fully granted in your Meta App Settings, then regenerate the Page Access Token.';
          } else if (code === 190 || type === 'OAuthException') {
            userFriendlyMsg = 'Meta Authentication Failed (Meta Code 190). The access token is invalid or has expired. Please refresh or update your Meta Access Token in settings.';
          } else if (msg.includes('Container processing failed') || msg.includes('rendering error') || msg.includes('2207082') || msg.includes('Media upload has failed')) {
            userFriendlyMsg = 'Instagram video processing failed (Meta Error 2207082). Instagram could not process or render the video. Please verify that your video meets Instagram Reel specifications: vertical 9:16 aspect ratio (1080x1920), H.264/HEVC MP4/MOV codec, 30-60 FPS, 3s to 15m duration, and under 1GB.';
          } else if (msg.includes('was not found') || msg.includes('404 Not Found') || msg.includes('404')) {
            userFriendlyMsg = `Google Drive video "${schedule.videoFileName}" was not found in your Drive (404 Not Found). Please re-sync your Drive folder or upload the video to Google Drive.`;
            isMissingFile = true;
          } else if (msg.includes('Google Docs/Sheet/editor document') || msg.includes('Only files with binary content can be downloaded') || msg.includes('Docs Editors')) {
            userFriendlyMsg = `Google Drive file "${schedule.videoFileName}" is a Google Doc/Editor document and cannot be published as a video Reel. Please ensure an MP4 or MOV video file is in your Drive folder.`;
            isMissingFile = true;
          } else if (msg.includes('403') || msg.includes('Forbidden') || msg.includes('permission denied')) {
            userFriendlyMsg = err.message || `Google Drive access forbidden for "${schedule.videoFileName}" (403 Forbidden). Please check file permissions or re-connect your Google Drive account in Settings.`;
          } else {
            userFriendlyMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
          }
        }

        if (isMissingFile) {
          console.warn(`[Scheduler] Schedule ${schedule.id} skipped due to missing Drive file: ${userFriendlyMsg}`);
          schedule.retryCount = 3;
        } else {
          console.error(`[Scheduler] Error publishing schedule ${schedule.id}:`, err);
          schedule.retryCount += 1;
        }

        schedule.status = 'failed';
        schedule.errorMessage = userFriendlyMsg;
        saveSchedule(schedule);

        recordApiError({
          message: userFriendlyMsg,
          action: 'PUBLISH_REEL',
          details: `Failed on video "${schedule.videoFileName}"`
        });
 
        addLog({
          action: 'PUBLISH_REEL',
          status: 'error',
          videoFileName: schedule.videoFileName,
          instagramAccount: metaConfig.instagramBusinessAccountId,
          errorMessage: isMissingFile 
            ? `Publish skipped: ${schedule.errorMessage}`
            : `Publish failed (Attempt ${schedule.retryCount}/3): ${schedule.errorMessage}`
        });

        addLog({
          action: 'WORKER_HEALTH',
          status: 'error',
          videoFileName: schedule.videoFileName,
          errorMessage: `[Worker Hang/Failure Alert] API Error occurred during schedule run: ${userFriendlyMsg} (Last checked at: ${new Date(checkTimestamp).toLocaleTimeString()})`
        });
      }
    }

  } catch (err: any) {
    console.error('[Scheduler] Global worker error:', err);
    recordApiError({
      message: err?.message || 'Global background worker exception',
      action: 'SCHEDULER_RUN'
    });
    addLog({
      action: 'WORKER_HEALTH',
      status: 'error',
      errorMessage: `Global scheduler exception: ${err?.message || err}`
    });
  } finally {
    isRunning = false;
    saveSystemHealthRecord({
      isWorkerRunning: false,
      runningSince: null,
      lastCheckedStatus: 'healthy'
    });
  }
}

function calculateNextScheduledTime(current: number, recurrence: 'daily' | 'weekly' | 'monthly'): number {
  const d = new Date(current);
  if (recurrence === 'daily') {
    return current + 24 * 60 * 60 * 1000;
  } else if (recurrence === 'weekly') {
    return current + 7 * 24 * 60 * 60 * 1000;
  } else if (recurrence === 'monthly') {
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  return current;
}

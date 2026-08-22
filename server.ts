import 'dotenv/config';
import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { 
  getUsers, 
  saveUser, 
  getMetaConfig, 
  saveMetaConfig, 
  getDriveFolderConfig, 
  saveDriveFolderConfig, 
  getSchedules, 
  saveSchedule, 
  deleteSchedule, 
  getLogs, 
  clearLogs, 
  addLog,
  getFirstUser,
  saveAppUrl,
  getRateLimits,
  clearApiError
} from './src/server/db.js';
import { 
  getGoogleAuthUrl, 
  exchangeCodeForTokens, 
  getUserProfile, 
  listFolders, 
  syncDriveFolder, 
  downloadFileStream,
  refreshAccessTokenIfNeeded,
  findOrCreateReelsFolder,
  findDriveFile,
  getFileThumbnail
} from './src/server/google.js';
import { verifyMetaConnection, uploadReelContainer } from './src/server/meta.js';
import { 
  checkAndPublishPending, 
  verifyVideoToken, 
  generateVideoToken,
  getDetailedSystemHealth,
  pingSystemHealth,
  forceResetWorker
} from './src/server/scheduler.js';
import { ensureLocalVideoCached, getLocalVideoPath } from './src/server/videoCache.js';
import { probeVideo } from './src/server/videoOptimizer.js';
import crypto from 'crypto';

const app = express();
export { app };
export default app;
const PORT = 3000;

app.use(express.json());

// Ensure req.url starts with /api for Vercel serverless functions (unless it's an auth handler or health check)
app.use((req, res, next) => {
  if (
    process.env.VERCEL && 
    !req.url.startsWith('/api') && 
    !req.url.startsWith('/health') && 
    !req.url.startsWith('/__/') &&
    !req.url.startsWith('/auth')
  ) {
    req.url = '/api' + (req.url.startsWith('/') ? '' : '/') + req.url;
  }
  next();
});

// In-memory session store (simple, reliable, fast)
const SESSIONS: Record<string, { userId: string; email?: string; googleAccessToken?: string; createdAt?: number }> = {};

// Custom Cookie parser middleware
app.use((req: any, res, next) => {
  const cookieHeader = req.headers.cookie || '';
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((c: string) => {
    const parts = c.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  req.cookies = cookies;

  // Dynamically capture and save APP_URL from incoming traffic
  const host = req.headers.host;
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || host.includes('.run.app');
    const protocol = isHttps ? 'https' : 'http';
    saveAppUrl(`${protocol}://${host}`);
  }

  next();
});

// Middleware to protect API routes
const requireAuth = (req: any, res: express.Response, next: express.NextFunction) => {
  let sessionId = req.cookies?.session_id;

  // Fallback to Authorization header or custom header for iframe environments where cookies are blocked
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }
  const customHeader = req.headers['x-session-id'];
  if (customHeader) {
    sessionId = customHeader as string;
  }

  const session = sessionId ? SESSIONS[sessionId] : null;

  if (!session) {
    res.status(401).json({ error: 'Unauthorized. Please login with Google Drive first.' });
    return;
  }

  req.userSession = session;
  next();
};

// ==========================================
// GOOGLE OAUTH ROUTES
// ==========================================

function getDynamicRedirectUri(req: any): string {
  // If APP_URL is provided, use it
  if (process.env.APP_URL) {
    let appUrl = process.env.APP_URL;
    if (appUrl.endsWith('/')) {
      appUrl = appUrl.slice(0, -1);
    }
    return `${appUrl}/__/auth/handler`;
  }
  
  // Construct dynamically from request headers
  const host = req.headers.host || '';
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || host.includes('.run.app');
  const protocol = isHttps ? 'https' : 'http';
  const origin = host ? `${protocol}://${host}` : 'http://localhost:3000';
  return `${origin}/__/auth/handler`;
}

app.get('/api/auth/google/url', (req, res) => {
  try {
    const redirectUri = getDynamicRedirectUri(req);
    const url = getGoogleAuthUrl(redirectUri);
    res.json({ success: true, url });
  } catch (err: any) {
    console.error('Error generating Google Auth URL:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to generate auth URL', url: '' });
  }
});

app.get(['/__/auth/handler', '/__/auth/handler/', '/api/auth/google/callback', '/auth/callback'], async (req: any, res) => {
  const code = req.query.code as string;
  const redirectUri = getDynamicRedirectUri(req);

  if (!code) {
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_FAILURE', error: 'No auth code returned from Google' }, '*');
              window.close();
            } else {
              window.location.href = '/?error=No+auth+code+returned+from+Google';
            }
          </script>
          <p>Authentication failed: No auth code returned from Google</p>
        </body>
      </html>
    `);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const profile = await getUserProfile(tokens.access_token);

    const user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token || '', // Google only sends this the first time, or on prompt=consent
      googleTokenExpiry: Date.now() + (tokens.expires_in * 1000),
      createdAt: Date.now(),
    };

    // If Google didn't return a refresh token (e.g. user re-logging without prompt=consent),
    // retain the existing refresh token we have stored.
    const existingUsers = getUsers();
    const existingUser = existingUsers.find(u => u.id === user.id);
    if (!user.googleRefreshToken && existingUser) {
      user.googleRefreshToken = existingUser.googleRefreshToken;
    }

    saveUser(user);

    // Create a local session
    const sessionId = crypto.randomUUID();
    SESSIONS[sessionId] = { userId: user.id, email: user.email };

    addLog({
      action: 'GOOGLE_AUTH_CALLBACK',
      status: 'success',
      apiResponse: `Successfully authenticated user ${user.email}`
    });

    // Set cookie with SameSite=None and Secure for reliable iframe session persistence
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Manual cookie header set as fallback for absolute reliability in iframe
    res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=${30 * 24 * 60 * 60}; SameSite=None; Secure`);

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionId: '${sessionId}' }, '*');
              window.close();
            } else {
              window.location.href = '/?session_id=${sessionId}';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('Google auth callback error:', err);
    addLog({
      action: 'GOOGLE_AUTH_CALLBACK',
      status: 'error',
      errorMessage: err.message
    });
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_FAILURE', error: ${JSON.stringify(err.message)} }, '*');
              window.close();
            } else {
              window.location.href = '/?error=' + encodeURIComponent(${JSON.stringify(err.message)});
            }
          </script>
          <p>Authentication failed: ${err.message}</p>
        </body>
      </html>
    `);
  }
});

app.post('/api/auth/firebase-login', express.json(), (req, res) => {
  const { uid, email, displayName, photoURL, googleAccessToken, googleRefreshToken } = req.body;

  if (!uid || !email) {
    res.status(400).json({ error: 'Missing uid or email' });
    return;
  }

  const existingUsers = getUsers();
  let user = existingUsers.find(u => u.id === uid || u.email === email);

  if (user) {
    user.id = uid; // Ensure ID is uid
    user.email = email;
    user.name = displayName || user.name;
    user.picture = photoURL || user.picture;
    user.googleAccessToken = googleAccessToken;
    if (googleRefreshToken) {
      user.googleRefreshToken = googleRefreshToken;
    }
    user.googleTokenExpiry = Date.now() + 3600 * 1000;
    saveUser(user);
  } else {
    user = {
      id: uid,
      email,
      name: displayName || email.split('@')[0],
      picture: photoURL,
      googleAccessToken,
      googleRefreshToken: googleRefreshToken || '',
      googleTokenExpiry: Date.now() + 3600 * 1000,
      createdAt: Date.now()
    };
    saveUser(user);
  }

  const sessionId = crypto.randomBytes(16).toString('hex');
  SESSIONS[sessionId] = {
    userId: user.id,
    googleAccessToken: user.googleAccessToken,
    createdAt: Date.now()
  };

  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture
    }
  });
});

app.get('/api/auth/me', (req: any, res) => {
  let sessionId = req.cookies?.session_id;

  // Fallback to Authorization header or custom header for iframe environments
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }
  const customHeader = req.headers['x-session-id'];
  if (customHeader) {
    sessionId = customHeader as string;
  }

  const session = sessionId ? SESSIONS[sessionId] : null;

  if (!session) {
    res.json({ authenticated: false });
    return;
  }

  const users = getUsers();
  const user = users.find(u => u.id === session.userId);

  if (!user) {
    res.json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      googleAccessToken: user.googleAccessToken
    },
    sessionId
  });
});

app.post('/api/auth/logout', (req, res) => {
  let sessionId = (req as any).cookies?.session_id;

  // Fallback to Authorization header or custom header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }
  const customHeader = req.headers['x-session-id'];
  if (customHeader) {
    sessionId = customHeader as string;
  }

  if (sessionId) {
    delete SESSIONS[sessionId];
  }
  res.setHeader('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=None; Secure');
  res.json({ success: true });
});

app.get('/api/auth/token', requireAuth, async (req: any, res) => {
  try {
    const users = getUsers();
    const user = users.find(u => u.id === req.userSession.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const freshToken = await refreshAccessTokenIfNeeded(user);
    res.json({ accessToken: freshToken });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to refresh token: ${err.message}` });
  }
});

// ==========================================
// META GRAPH CONFIG & OPERATIONS
// ==========================================

app.get('/api/meta/config', requireAuth, (req, res) => {
  const config = getMetaConfig();
  if (!config) {
    res.json({ configured: false });
    return;
  }

  // Sanitized configuration for frontend safety (do not expose appSecret or accessToken)
  res.json({
    configured: true,
    config: {
      appId: config.appId ? `${config.appId.slice(0, 3)}...${config.appId.slice(-3)}` : '',
      appSecret: config.appSecret ? '••••••••••••••••' : '',
      accessToken: config.accessToken ? `${config.accessToken.slice(0, 8)}...${config.accessToken.slice(-8)}` : '',
      instagramBusinessAccountId: config.instagramBusinessAccountId,
      facebookPageId: config.facebookPageId,
      graphApiVersion: config.graphApiVersion,
      businessPortfolioId: config.businessPortfolioId,
      webhookVerifyToken: config.webhookVerifyToken,
      appMode: config.appMode,
      environment: config.environment,
      videoDeliveryMode: config.videoDeliveryMode || 'proxy'
    }
  });
});

app.post('/api/meta/config', requireAuth, (req, res) => {
  const {
    appId,
    appSecret,
    accessToken,
    instagramBusinessAccountId,
    facebookPageId,
    graphApiVersion,
    businessPortfolioId,
    webhookVerifyToken,
    appMode,
    environment,
    videoDeliveryMode
  } = req.body;

  if (!appId || !appSecret || !accessToken || !instagramBusinessAccountId || !facebookPageId || !graphApiVersion) {
    res.status(400).json({ error: 'Missing required configuration fields.' });
    return;
  }

  const existingConfig = getMetaConfig();
  
  // Create or update
  const newConfig = {
    appId,
    appSecret: appSecret === '••••••••••••••••' && existingConfig ? existingConfig.appSecret : appSecret,
    accessToken: accessToken.includes('...') && existingConfig ? existingConfig.accessToken : accessToken,
    instagramBusinessAccountId,
    facebookPageId,
    graphApiVersion,
    businessPortfolioId,
    webhookVerifyToken,
    appMode,
    environment,
    videoDeliveryMode: videoDeliveryMode || 'proxy',
    updatedAt: Date.now()
  };

  saveMetaConfig(newConfig);

  addLog({
    action: 'META_CONFIG_SAVE',
    status: 'success',
    apiResponse: 'Meta configuration successfully saved and encrypted.'
  });

  res.json({ success: true });
});

app.post('/api/meta/verify', requireAuth, async (req, res) => {
  const config = getMetaConfig();
  if (!config) {
    res.status(400).json({ error: 'Meta is not configured.' });
    return;
  }

  const result = await verifyMetaConnection(config);
  res.json(result);
});

app.post('/api/meta/refresh-token', requireAuth, async (req, res) => {
  const config = getMetaConfig();
  if (!config) {
    res.status(400).json({ error: 'Meta is not configured.' });
    return;
  }

  addLog({
    action: 'META_REFRESH_TOKEN',
    status: 'info',
    apiRequest: 'GET /oauth/access_token (long-lived)'
  });

  try {
    // Generate long-lived user access token from short-lived token
    const url = `https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token?` + 
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: config.accessToken
      }).toString();

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to exchange Meta token');
    }

    config.accessToken = data.access_token;
    config.updatedAt = Date.now();
    saveMetaConfig(config);

    addLog({
      action: 'META_REFRESH_TOKEN',
      status: 'success',
      apiResponse: `Long-lived access token refreshed successfully. Expires in: ${data.expires_in || 'never'}`
    });

    res.json({ success: true, message: 'Long-lived token refreshed.' });
  } catch (err: any) {
    addLog({
      action: 'META_REFRESH_TOKEN',
      status: 'error',
      errorMessage: err.message,
      apiResponse: JSON.stringify(err)
    });
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GOOGLE DRIVE INTEGRATION ROUTES
// ==========================================

app.get('/api/drive/folders', requireAuth, async (req: any, res) => {
  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId);
  if (!user) {
    res.status(401).json({ error: 'User session invalid.' });
    return;
  }

  try {
    const googleToken = await refreshAccessTokenIfNeeded(user);
    const folders = await listFolders(googleToken);
    res.json({ folders });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drive/config', requireAuth, async (req: any, res) => {
  let config = getDriveFolderConfig();

  // If no folder is connected, or we want to ensure 'Reels' folder automation:
  if (!config || !config.selectedFolderId) {
    const users = getUsers();
    const user = users.find(u => u.id === req.userSession.userId);
    if (user) {
      try {
        const googleToken = await refreshAccessTokenIfNeeded(user);
        const reelsFolder = await findOrCreateReelsFolder(googleToken);
        
        config = {
          selectedFolderId: reelsFolder.id,
          selectedFolderName: reelsFolder.name,
          lastSyncedAt: Date.now()
        };
        saveDriveFolderConfig(config);

        addLog({
          action: 'AUTO_SETUP_DRIVE',
          status: 'success',
          apiResponse: `Successfully auto-discovered or created 'Reels' folder and connected it.`
        });
      } catch (err: any) {
        console.error('Failed to automatically configure Reels folder:', err);
        addLog({
          action: 'AUTO_SETUP_DRIVE',
          status: 'error',
          errorMessage: err.message
        });
      }
    }
  }

  res.json({ config });
});

app.post('/api/drive/folder', requireAuth, async (req: any, res) => {
  const { folderId, folderName } = req.body;
  if (!folderId || !folderName) {
    res.status(400).json({ error: 'Folder ID and Folder Name are required.' });
    return;
  }

  saveDriveFolderConfig({
    selectedFolderId: folderId,
    selectedFolderName: folderName,
    lastSyncedAt: Date.now()
  });

  addLog({
    action: 'SYNC_DRIVE',
    status: 'info',
    apiResponse: `Connecting Google Drive Folder: ${folderName}`
  });

  // Trigger an initial sync right away!
  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId);
  if (user) {
    try {
      const googleToken = await refreshAccessTokenIfNeeded(user);
      const result = await syncDriveFolder(googleToken, folderId);
      
      // Keep track of synchronized items
      addLog({
        action: 'SYNC_DRIVE',
        status: 'success',
        apiResponse: `Successfully synchronized ${result.videos.length} videos from Google Drive folder: ${folderName}`
      });
      
      res.json({ success: true, videos: result.videos });
    } catch (err: any) {
      addLog({
        action: 'SYNC_DRIVE',
        status: 'error',
        errorMessage: err.message
      });
      res.status(500).json({ error: err.message });
    }
  } else {
    res.json({ success: true });
  }
});

app.post('/api/drive/sync', requireAuth, async (req: any, res) => {
  const folderConfig = getDriveFolderConfig();
  if (!folderConfig) {
    res.status(400).json({ error: 'No Google Drive Folder selected yet.' });
    return;
  }

  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId);
  if (!user) {
    res.status(401).json({ error: 'User session invalid.' });
    return;
  }

  try {
    const googleToken = await refreshAccessTokenIfNeeded(user);
    const result = await syncDriveFolder(googleToken, folderConfig.selectedFolderId);
    
    folderConfig.lastSyncedAt = Date.now();
    saveDriveFolderConfig(folderConfig);

    // Auto-heal existing schedules by re-associating fresh Google Drive file IDs
    const schedules = getSchedules();
    let healedCount = 0;
    for (const sch of schedules) {
      const cleanSchBase = sch.videoFileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
      const match = result.videos.find(v => {
        const cleanVBase = v.name.replace(/\.[^/.]+$/, '').trim().toLowerCase();
        return v.name.toLowerCase() === sch.videoFileName.toLowerCase() ||
               v.id === sch.videoFileId ||
               cleanVBase === cleanSchBase;
      });

      if (match) {
        let updated = false;
        if (sch.videoFileId !== match.id) {
          sch.videoFileId = match.id;
          updated = true;
        }
        if (sch.status === 'failed') {
          sch.status = 'pending';
          sch.retryCount = 0;
          sch.errorMessage = undefined;
          updated = true;
          healedCount++;
        }
        if (updated) {
          saveSchedule(sch);
        }
      }
    }

    addLog({
      action: 'SYNC_DRIVE',
      status: 'success',
      apiResponse: `Manually synchronized ${result.videos.length} videos from folder: ${folderConfig.selectedFolderName}${healedCount > 0 ? ` (Auto-repaired ${healedCount} pending/failed schedule items)` : ''}`
    });

    // Trigger scheduler to process any newly healed schedules
    checkAndPublishPending().catch(err => console.error('[Post-Sync Scheduler Trigger Error]', err));

    res.json({ success: true, videos: result.videos, healedCount });
  } catch (err: any) {
    addLog({
      action: 'SYNC_DRIVE',
      status: 'error',
      errorMessage: err.message
    });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drive/thumbnail/:fileId', async (req: any, res) => {
  let sessionId = req.cookies?.session_id || req.query?.session_id;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }
  const customHeader = req.headers['x-session-id'];
  if (customHeader) {
    sessionId = customHeader as string;
  }

  let user: any = null;
  const users = getUsers();
  if (sessionId && SESSIONS[sessionId]) {
    user = users.find(u => u.id === SESSIONS[sessionId].userId);
  }
  if (!user && users.length > 0) {
    user = users[0];
  }

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { fileId } = req.params;
    const googleToken = await refreshAccessTokenIfNeeded(user);
    const result = await getFileThumbnail(googleToken, fileId);
    if (!result) {
      res.status(404).json({ error: 'Thumbnail not available' });
      return;
    }

    if ('buffer' in result) {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(result.buffer);
    } else if ('redirectUrl' in result) {
      res.redirect(result.redirectUrl);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch thumbnail' });
  }
});

app.get('/api/videos/:fileId/probe', requireAuth, async (req: any, res) => {
  const { fileId } = req.params;
  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId) || users[0];

  if (!user) {
    res.status(401).json({ error: 'User session invalid' });
    return;
  }

  try {
    const googleToken = await refreshAccessTokenIfNeeded(user);
    const { filePath } = await ensureLocalVideoCached(fileId, googleToken);
    const probe = await probeVideo(filePath);
    res.json({ success: true, metadata: probe });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to probe video specifications' });
  }
});

// ==========================================
// AI CAPTION GENERATION
// ==========================================

app.post('/api/ai/generate-caption', requireAuth, async (req: any, res) => {
  const { videoName } = req.body;
  if (!videoName) {
    res.status(400).json({ error: 'Video name is required.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Gemini API Key is not configured in environment variables. Please set it in Settings > Secrets.' });
    return;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Generate an engaging, catchy, and trendy caption for an Instagram Reel or short video.
The caption should be context-aware, creative, and match the vibe of the video.
Include relevant hashtags (maximum 3-5) and a few appropriate emojis.
Provide only the raw caption text itself. Do not include any introductory phrases (like "Here is a caption:"), quotes, markdown styling, or meta-commentary.

Video Filename: ${videoName}`,
    });

    const text = response.text || '';
    res.json({ caption: text.trim() });
  } catch (err: any) {
    console.error('[Gemini Caption Generator Error]:', err);
    res.status(500).json({ error: err.message || 'Failed to generate caption with AI.' });
  }
});

// ==========================================
// SCHEDULING ROUTES
// ==========================================

app.get('/api/schedules', requireAuth, (req, res) => {
  const schedules = getSchedules();
  res.json({ schedules });
});

app.post('/api/schedules', requireAuth, (req, res) => {
  const {
    videoFileId,
    videoFileName,
    captionFileId,
    captionFileName,
    captionText,
    scheduledTime,
    timezone,
    recurrence
  } = req.body;

  if (!videoFileId || !videoFileName || !scheduledTime || !timezone || !recurrence) {
    res.status(400).json({ error: 'Missing required schedule fields.' });
    return;
  }

  const newSchedule = {
    id: crypto.randomUUID(),
    videoFileId,
    videoFileName,
    captionFileId,
    captionFileName,
    captionText: captionText || '',
    scheduledTime: Number(scheduledTime),
    timezone,
    recurrence,
    status: 'pending' as const,
    retryCount: 0,
    createdAt: Date.now()
  };

  saveSchedule(newSchedule);

  addLog({
    action: 'CREATE_SCHEDULE',
    status: 'success',
    videoFileName: videoFileName,
    apiResponse: `Successfully scheduled post for ${new Date(Number(scheduledTime)).toLocaleString()}`
  });

  res.json({ success: true, schedule: newSchedule });
});

app.put('/api/schedules/:id', requireAuth, (req, res) => {
  const scheduleId = req.params.id;
  const { scheduledTime, captionText, status } = req.body;

  const schedules = getSchedules();
  const schedule = schedules.find(s => s.id === scheduleId);

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  if (scheduledTime !== undefined) {
    schedule.scheduledTime = Number(scheduledTime);
  }
  if (captionText !== undefined) {
    schedule.captionText = captionText;
  }
  if (status !== undefined) {
    schedule.status = status;
    if (status === 'pending') {
      schedule.retryCount = 0; // reset retries if user resets to pending
    }
  }

  saveSchedule(schedule);

  addLog({
    action: 'UPDATE_SCHEDULE',
    status: 'success',
    videoFileName: schedule.videoFileName,
    apiResponse: `Successfully updated scheduled post details.`
  });

  res.json({ success: true, schedule });
});

app.post('/api/schedules/retry-all-failed', requireAuth, async (req: any, res) => {
  const schedules = getSchedules();
  const failedSchedules = schedules.filter(s => s.status === 'failed');

  if (failedSchedules.length === 0) {
    res.json({ success: true, count: 0, message: 'No failed schedules to retry.' });
    return;
  }

  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId);
  let googleToken = '';
  if (user) {
    try {
      googleToken = await refreshAccessTokenIfNeeded(user);
    } catch {}
  }

  for (const sch of failedSchedules) {
    sch.status = 'pending';
    sch.retryCount = 0;
    sch.errorMessage = undefined;

    // If we have token and filename, try healing file ID right now
    if (googleToken && sch.videoFileName) {
      try {
        const found = await findDriveFile(googleToken, sch.videoFileId, sch.videoFileName);
        if (found && found.id) {
          sch.videoFileId = found.id;
        }
      } catch {}
    }

    saveSchedule(sch);
  }

  addLog({
    action: 'RETRY_SCHEDULES',
    status: 'info',
    apiResponse: `Re-queued ${failedSchedules.length} failed schedules for publishing.`
  });

  // Run publisher worker immediately
  checkAndPublishPending().catch(err => console.error('[Retry All Schedule Run Error]', err));

  res.json({ success: true, count: failedSchedules.length, message: `Re-queued ${failedSchedules.length} post(s) for immediate publishing.` });
});

app.post('/api/schedules/:id/retry', requireAuth, async (req: any, res) => {
  const scheduleId = req.params.id;
  const schedules = getSchedules();
  const schedule = schedules.find(s => s.id === scheduleId);

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  schedule.status = 'pending';
  schedule.retryCount = 0;
  schedule.errorMessage = undefined;

  const users = getUsers();
  const user = users.find(u => u.id === req.userSession.userId);
  if (user) {
    try {
      const googleToken = await refreshAccessTokenIfNeeded(user);
      const found = await findDriveFile(googleToken, schedule.videoFileId, schedule.videoFileName);
      if (found && found.id) {
        schedule.videoFileId = found.id;
      }
    } catch {}
  }

  saveSchedule(schedule);

  addLog({
    action: 'RETRY_SCHEDULE',
    status: 'info',
    videoFileName: schedule.videoFileName,
    apiResponse: `Re-queued schedule ${schedule.id} for publishing.`
  });

  // Run publisher worker immediately
  checkAndPublishPending().catch(err => console.error('[Retry Single Schedule Run Error]', err));

  res.json({ success: true, schedule });
});

// Cron endpoint to trigger background schedule worker (for Vercel Cron or external webhooks)
app.get('/api/cron/process-schedules', async (req, res) => {
  try {
    checkAndPublishPending().catch(err => {
      console.error('[Cron Schedule Run Error]', err);
    });
    res.json({ success: true, message: 'Schedule processing triggered successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger schedule processing', details: err?.message });
  }
});

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
  const scheduleId = req.params.id;
  const schedules = getSchedules();
  const schedule = schedules.find(s => s.id === scheduleId);

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  deleteSchedule(scheduleId);

  addLog({
    action: 'DELETE_SCHEDULE',
    status: 'success',
    videoFileName: schedule.videoFileName,
    apiResponse: `Successfully deleted scheduled post.`
  });

  res.json({ success: true });
});

// ==========================================
// DASHBOARD STATS & LOGS
// ==========================================

app.get('/api/dashboard/stats', requireAuth, async (req: any, res) => {
  const user = getFirstUser();
  const metaConfig = getMetaConfig();
  const driveConfig = getDriveFolderConfig();
  const schedules = getSchedules();

  let videosCount = 0;
  if (user && driveConfig) {
    try {
      const googleToken = await refreshAccessTokenIfNeeded(user);
      const result = await syncDriveFolder(googleToken, driveConfig.selectedFolderId);
      videosCount = result.videos.length;
    } catch (err) {
      console.error('Failed to count videos from Drive folder in stats:', err);
    }
  }

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const stats = {
    googleConnected: !!user,
    metaConnected: !!metaConfig,
    selectedFolderName: driveConfig?.selectedFolderName || '',
    videosAvailableCount: videosCount,
    scheduledCount: schedules.filter(s => s.status === 'pending').length,
    publishedTodayCount: schedules.filter(s => s.status === 'published' && s.publishedAt && s.publishedAt >= todayStart.getTime()).length,
    publishedThisWeekCount: schedules.filter(s => s.status === 'published' && s.publishedAt && s.publishedAt >= weekStart.getTime()).length,
    failedCount: schedules.filter(s => s.status === 'failed').length,
    upcomingSchedules: schedules
      .filter(s => s.status === 'pending')
      .sort((a, b) => a.scheduledTime - b.scheduledTime)
      .slice(0, 5),
    rateLimits: getRateLimits(),
    systemHealth: getDetailedSystemHealth()
  };

  res.json(stats);
});

// ==========================================
// SYSTEM HEALTH & WORKER MONITORING
// ==========================================

app.get('/api/system/health', requireAuth, (req, res) => {
  const health = getDetailedSystemHealth();
  const workerLogs = getLogs().filter(l => l.action === 'WORKER_HEALTH' || l.action === 'SCHEDULER_RUN' || l.action === 'PUBLISH_REEL').slice(0, 20);
  res.json({ health, workerLogs });
});

app.post('/api/system/health/ping', requireAuth, async (req, res) => {
  try {
    const health = await pingSystemHealth();
    res.json({ success: true, health });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/health/reset', requireAuth, (req, res) => {
  const result = forceResetWorker();
  res.json({ ...result, health: getDetailedSystemHealth() });
});

app.post('/api/system/health/clear-error', requireAuth, (req, res) => {
  clearApiError();
  res.json({ success: true, health: getDetailedSystemHealth() });
});

app.get('/api/logs', requireAuth, (req, res) => {
  res.json({ logs: getLogs() });
});

app.delete('/api/logs', requireAuth, (req, res) => {
  clearLogs();
  res.json({ success: true });
});

// ==========================================
// PUBLIC VIDEO STREAMING PROXY (FOR META INGRESS)
// ==========================================

app.all(['/api/public/video/:fileId', '/api/public/video/:fileId/'], async (req: any, res: any) => {
  const { fileId } = req.params;
  const { token } = req.query;

  if (!fileId || !token) {
    res.status(400).send('Missing fileId or token parameters.');
    return;
  }

  // Cryptographically verify signature so public users cannot exploit this stream
  const isValid = verifyVideoToken(fileId, token as string);
  if (!isValid) {
    res.status(403).send('Forbidden: Invalid token signature.');
    return;
  }

  const user = getFirstUser();
  if (!user) {
    res.status(404).send('Google authentication details missing on server.');
    return;
  }

  try {
    const googleToken = await refreshAccessTokenIfNeeded(user);
    const { filePath: cachedFilePath } = await ensureLocalVideoCached(fileId, googleToken);

    res.sendFile(cachedFilePath, {
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (err: any) {
    console.error('[PublicVideo] Error caching or streaming video from Google Drive:', err);
    res.status(500).send(`Failed to stream video: ${err.message || err}`);
  }
});

// ==========================================
// VITE AND STATIC ASSETS HANDLING
// ==========================================

// Background scheduler running every 60 seconds (Only in non-serverless long-running process)
if (!process.env.VERCEL) {
  setInterval(() => {
    checkAndPublishPending().catch(err => {
      console.error('[Scheduler Interval Error]', err);
    });
  }, 60000);

  // Kick off immediately on server start to catch missed posts
  setTimeout(() => {
    checkAndPublishPending().catch(err => {
      console.error('[Initial Scheduler Run Error]', err);
    });
  }, 5000);
}

// Vite / static file serving (Only when not running as a Vercel serverless function)
if (!process.env.VERCEL) {
  if (process.env.NODE_ENV !== 'production') {
    import('vite').then(({ createServer: createViteServer }) => {
      createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
      }).then((vite) => {
        app.use(vite.middlewares);
        
        // Catch-all to serve index.html for React Router / SPA routing in development
        app.get('*', (req, res) => {
          res.sendFile(path.join(process.cwd(), 'index.html'));
        });

        app.listen(PORT, '0.0.0.0', () => {
          console.log(`Server is running in DEVELOPMENT mode at http://0.0.0.0:${PORT}`);
        });
      });
    }).catch((err) => {
      console.error('[Vite Server Init Error]:', err);
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running in PRODUCTION mode at http://0.0.0.0:${PORT}`);
    });
  }
}

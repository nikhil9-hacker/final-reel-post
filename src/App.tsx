import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  HardDrive,
  Settings,
  History,
  Folder,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Instagram,
  ExternalLink,
  LogOut,
  Check,
  ChevronLeft,
  ChevronRight,
  Video,
  Play,
  FileText,
  AlertTriangle,
  User,
  Sliders,
  Sparkles,
  Info,
  Gauge,
  Edit2,
  X,
  Activity,
  ShieldCheck
} from 'lucide-react';
import { User as UserType, MetaConfig, DriveFolderConfig, Schedule, AuditLog, DashboardStats, DriveVideoItem, SystemHealth } from './types.js';
import { auth, googleProvider, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase.js';
import { VideoThumbnail } from './components/VideoThumbnail.js';
import { VideoPreviewModal } from './components/VideoPreviewModal.js';
import { SystemHealthWidget } from './components/SystemHealthWidget.js';
import { CalendarTab } from './components/CalendarTab.js';
// Setup default timezone
const DEFAULT_TIMEZONE = 'America/New_York';
const PICKER_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Custom fetch wrapper with retries and session token header attachment,
// which is resilient to initial dev-server wakeups and iframe cookie restrictions.
async function apiFetch(input: RequestInfo | URL, init?: RequestInit, retries = 2): Promise<Response> {
  const sessionId = localStorage.getItem('reelpilot_session_id');
  const modifiedInit = { ...init };
  if (sessionId) {
    modifiedInit.headers = modifiedInit.headers || {};
    if (modifiedInit.headers instanceof Headers) {
      modifiedInit.headers.set('Authorization', `Bearer ${sessionId}`);
      modifiedInit.headers.set('x-session-id', sessionId);
    } else if (Array.isArray(modifiedInit.headers)) {
      modifiedInit.headers = [
        ...modifiedInit.headers,
        ['Authorization', `Bearer ${sessionId}`],
        ['x-session-id', sessionId]
      ];
    } else {
      modifiedInit.headers = {
        ...(modifiedInit.headers as any),
        'Authorization': `Bearer ${sessionId}`,
        'x-session-id': sessionId
      };
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await window.fetch(input, modifiedInit);
      return response;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  return window.fetch(input, modifiedInit);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'drive' | 'meta' | 'logs'>(() => {
    const saved = localStorage.getItem('reelpilot_active_tab');
    if (saved && ['dashboard', 'calendar', 'drive', 'meta', 'logs'].includes(saved)) {
      return saved as any;
    }
    return 'dashboard';
  });
  
  // Auth & System State (strictly isolated per browser session)
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [googleAuthUrl, setGoogleAuthUrl] = useState<string>('');

  // Gmail OAuth step states
  const [gmailEmail, setGmailEmail] = useState<string>('');
  const [gmailPassword, setGmailPassword] = useState<string>('');
  const [gmailStep, setGmailStep] = useState<1 | 2>(1);
  const [gmailError, setGmailError] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  
  // Database & Content States (Loaded freshly upon authenticated user session)
  const [metaConfig, setMetaConfig] = useState<MetaConfig | null>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_meta_config');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [metaConfigured, setMetaConfigured] = useState<boolean>(() => {
    return !!localStorage.getItem('reelpilot_cached_meta_config');
  });
  const [driveConfig, setDriveConfig] = useState<DriveFolderConfig | null>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_drive_config');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [folders, setFolders] = useState<any[]>([]);
  const [manualFolderInput, setManualFolderInput] = useState<string>('');
  const [syncedVideos, setSyncedVideos] = useState<DriveVideoItem[]>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_videos');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_schedules');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [logs, setLogs] = useState<AuditLog[]>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(() => {
    try {
      const saved = localStorage.getItem('reelpilot_cached_stats');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  
  // Loading & Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  
  // Modals / Inputs
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [selectedVideoForSchedule, setSelectedVideoForSchedule] = useState<DriveVideoItem | null>(null);
  const [previewVideoModal, setPreviewVideoModal] = useState<DriveVideoItem | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleTime, setScheduleTime] = useState<string>('');
  const [scheduleRecurrence, setScheduleRecurrence] = useState<'single' | 'daily' | 'weekly' | 'monthly'>('single');
  const [customCaption, setCustomCaption] = useState<string>('');
  const [scheduleSuccess, setScheduleSuccess] = useState<boolean>(false);

  // Bulk scheduling states
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [bulkDate, setBulkDate] = useState<string>('');
  const [bulkTime, setBulkTime] = useState<string>('');
  const [bulkRecurrence, setBulkRecurrence] = useState<'single' | 'daily' | 'weekly' | 'monthly'>('single');
  const [bulkSpacing, setBulkSpacing] = useState<'same_time' | 'space_out'>('space_out');
  const [bulkSpacingHours, setBulkSpacingHours] = useState<number>(24);
  
  // Custom DateTime Picker states
  const [isCustomPickerOpen, setIsCustomPickerOpen] = useState<boolean>(false);
  const [pickerTarget, setPickerTarget] = useState<'single' | 'bulk'>('single');
  const [tempSelectedDate, setTempSelectedDate] = useState<string>('');
  const [tempSelectedTime, setTempSelectedTime] = useState<string>('');
  const [pickerYearMonth, setPickerYearMonth] = useState<Date>(new Date());
  
  // Inline caption editing states
  const [editingCaptionVideoId, setEditingCaptionVideoId] = useState<string | null>(null);
  const [editingCaptionText, setEditingCaptionText] = useState<string>('');
  const [isGeneratingCaption, setIsGeneratingCaption] = useState<boolean>(false);
  
  // Calendar Navigation
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
  const [selectedScheduleDetail, setSelectedScheduleDetail] = useState<Schedule | null>(null);
  
  // Deletion / Confirmation states (iframe-safe)
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);
  const [confirmClearLogs, setConfirmClearLogs] = useState<boolean>(false);
  const [logFilter, setLogFilter] = useState<'all' | 'WORKER_HEALTH' | 'PUBLISH_REEL' | 'SYNC_DRIVE' | 'META_VERIFY' | 'errors'>('all');
  
  // Live Clock State (India IST & Pacific)
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Meta Configuration Form
  const [metaForm, setMetaForm] = useState({
    appId: '',
    appSecret: '',
    accessToken: '',
    instagramBusinessAccountId: '',
    facebookPageId: '',
    graphApiVersion: 'v20.0',
    businessPortfolioId: '',
    webhookVerifyToken: '',
    appMode: 'sandbox' as 'sandbox' | 'live',
    environment: 'development' as 'development' | 'production',
    videoDeliveryMode: 'proxy' as 'proxy' | 'litterbox'
  });
  const [metaVerifyResult, setMetaVerifyResult] = useState<any | null>(null);

  // Google Cloud OAuth Credentials Form
  const [googleOAuthForm, setGoogleOAuthForm] = useState({
    clientId: '',
    clientSecret: ''
  });
  const [googleOAuthStatus, setGoogleOAuthStatus] = useState<{ configured: boolean; isCustom: boolean; clientId: string; clientSecretMasked: string } | null>(null);
  const [isSavingGoogleOAuth, setIsSavingGoogleOAuth] = useState(false);
  const [googleTokenInfo, setGoogleTokenInfo] = useState<{ valid: boolean; email?: string; scopes?: string[]; hasDriveScope?: boolean; expiresIn?: number; error?: string } | null>(null);
  const [isCheckingTokenInfo, setIsCheckingTokenInfo] = useState(false);
  const [driveAuthExpired, setDriveAuthExpired] = useState(false);

  // Load configuration and data on mount
  useEffect(() => {
    // Check if session ID is provided in query parameters (for direct page redirects)
    const urlParams = new URLSearchParams(window.location.search);
    const paramSessionId = urlParams.get('session_id');
    if (paramSessionId) {
      localStorage.setItem('reelpilot_session_id', paramSessionId);
      // Clean up URL query parameters
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }

    checkAuth();
    fetchGoogleUrl();

    // Setup Firebase AuthStateListener
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const u = {
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || firebaseUser.email || 'User',
          picture: firebaseUser.photoURL || undefined
        };
        setCurrentUser(u);
        localStorage.setItem('reelpilot_cached_user', JSON.stringify(u));
        setAuthLoading(false);

        // Ensure server session exists and is synced
        const currentSessionId = localStorage.getItem('reelpilot_session_id');
        if (!currentSessionId) {
          try {
            const fbRes = await apiFetch('/api/auth/firebase-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL
              })
            });
            const fbData = await fbRes.json();
            if (fbData.sessionId) {
              localStorage.setItem('reelpilot_session_id', fbData.sessionId);
            }
          } catch (e) {
            console.error('Failed to sync firebase session:', e);
          }
        }
      } else {
        // Fall back to checking server session auth if no Firebase user
        checkAuth();
      }
    });

    // Listen for postMessage from the Google OAuth callback popup
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      // Allow current window origin, standard dev, shared preview, vercel, and localhost origins
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('vercel.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const sessId = event.data?.sessionId;
        if (sessId) {
          localStorage.setItem('reelpilot_session_id', sessId);
        }
        showNotification('success', 'Google Drive connected successfully!');
        setAuthLoading(false);
        checkAuth();
      } else if (event.data?.type === 'OAUTH_AUTH_FAILURE') {
        showNotification('error', event.data?.error || 'Google authentication failed.');
        setAuthLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Load Google Picker and GIS scripts dynamically
  useEffect(() => {
    const loadGoogleScripts = () => {
      if (!document.getElementById('gapi-script')) {
        const gapiScript = document.createElement('script');
        gapiScript.id = 'gapi-script';
        gapiScript.src = 'https://apis.google.com/js/api.js';
        gapiScript.async = true;
        gapiScript.defer = true;
        gapiScript.onload = () => {
          (window as any).gapi.load('picker', () => {
            console.log('GAPI Picker library loaded.');
          });
        };
        document.body.appendChild(gapiScript);
      } else if ((window as any).gapi) {
        (window as any).gapi.load('picker', () => {});
      }

      if (!document.getElementById('gis-script')) {
        const gisScript = document.createElement('script');
        gisScript.id = 'gis-script';
        gisScript.src = 'https://accounts.google.com/gsi/client';
        gisScript.async = true;
        gisScript.defer = true;
        document.body.appendChild(gisScript);
      }
    };

    loadGoogleScripts();
  }, []);

  // On user authentication, load all dashboard data smoothly without overriding active tab
  useEffect(() => {
    if (currentUser) {
      loadAllData();
    }
  }, [currentUser]);

  const handleTabChange = (tab: 'dashboard' | 'calendar' | 'drive' | 'meta' | 'logs') => {
    setActiveTab(tab);
    localStorage.setItem('reelpilot_active_tab', tab);
  };

  // Periodic polling for schedules, logs, and stats updates
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      fetchSchedules();
      fetchLogs();
      fetchDashboardStats();
    }, 10000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const checkAuth = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          if (data.sessionId) {
            localStorage.setItem('reelpilot_session_id', data.sessionId);
          }
          setCurrentUser(data.user);
        } else {
          // Strictly clear user and state if unauthenticated in this browser session
          setCurrentUser(null);
          localStorage.removeItem('reelpilot_session_id');
          localStorage.removeItem('reelpilot_cached_user');
          setSyncedVideos([]);
          setSchedules([]);
          setLogs([]);
          setDashboardStats(null);
          setDriveConfig(null);
          setMetaConfig(null);
          setMetaConfigured(false);
        }
      } else {
        setCurrentUser(null);
        localStorage.removeItem('reelpilot_session_id');
      }
    } catch (err) {
      console.warn('Could not verify server session:', err);
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchGoogleUrl = async () => {
    try {
      const res = await apiFetch('/api/auth/google/url');
      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          setGoogleAuthUrl(data.url);
        }
      }
    } catch (err) {
      console.warn('Could not fetch Google auth URL on mount:', err);
    }
  };

  const reconnectGoogleDrive = async () => {
    setAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;

      if (googleAccessToken) {
        const res = await apiFetch('/api/auth/firebase-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
            googleAccessToken
          })
        });
        const data = await res.json();
        if (data.sessionId) {
          localStorage.setItem('reelpilot_session_id', data.sessionId);
        }
        setDriveAuthExpired(false);
        showNotification('success', 'Google Drive re-authenticated! Syncing your videos...');
        await loadAllData();
        await syncFolderFiles(true);
      } else {
        showNotification('error', 'Google did not return an access token. Please ensure you approved permissions.');
      }
    } catch (err: any) {
      console.warn('Re-auth error:', err);
      if (err?.code === 'auth/popup-closed-by-user') {
        showNotification('info', 'Re-authentication cancelled.');
      } else if (err?.code === 'auth/popup-blocked') {
        showNotification('error', 'Popup blocked by browser. Please allow popups for this app.');
      } else {
        showNotification('error', err.message || 'Failed to re-authenticate Google Drive.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setAuthLoading(true);
    try {
      // 1. Direct Firebase Google Sign-In Popup with Google Drive Scopes
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;

      // 2. Sync Firebase credentials with server session
      try {
        const fbRes = await apiFetch('/api/auth/firebase-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            googleAccessToken
          })
        });
        const fbData = await fbRes.json();
        if (fbData.sessionId) {
          localStorage.setItem('reelpilot_session_id', fbData.sessionId);
        }
      } catch (e) {
        console.error('Failed to sync firebase login with server session:', e);
      }

      const u = {
        id: firebaseUser.uid,
        email: firebaseUser.email || '',
        name: firebaseUser.displayName || firebaseUser.email || 'User',
        picture: firebaseUser.photoURL || undefined
      };
      setCurrentUser(u);
      setDriveAuthExpired(false);
      localStorage.setItem('reelpilot_cached_user', JSON.stringify(u));
      showNotification('success', `Welcome back, ${firebaseUser.displayName || firebaseUser.email}!`);
      loadAllData();
    } catch (firebaseErr: any) {
      console.warn('Firebase sign in error:', firebaseErr);
      if (firebaseErr?.code === 'auth/popup-closed-by-user') {
        showNotification('info', 'Sign-in cancelled.');
      } else if (firebaseErr?.code === 'auth/popup-blocked') {
        showNotification('error', 'Sign-in popup was blocked by your browser. Please allow popups for this site.');
      } else {
        showNotification('error', firebaseErr?.message || 'Google sign-in failed.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      await apiFetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('reelpilot_session_id');
      localStorage.removeItem('reelpilot_cached_user');
      localStorage.removeItem('reelpilot_cached_schedules');
      localStorage.removeItem('reelpilot_cached_videos');
      localStorage.removeItem('reelpilot_cached_drive_config');
      localStorage.removeItem('reelpilot_cached_meta_config');
      localStorage.removeItem('reelpilot_cached_stats');
      localStorage.removeItem('reelpilot_cached_logs');
      setCurrentUser(null);
      showNotification('success', 'Logged out successfully.');
    } catch (err) {
      showNotification('error', 'Failed to log out.');
    }
  };

  const loadAllData = async () => {
    setActionLoading('loading_all');
    try {
      await Promise.all([
        fetchMetaConfig(),
        fetchGoogleOAuthConfig(),
        fetchDriveConfig(),
        fetchSchedules(),
        fetchLogs(),
        fetchDashboardStats()
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const fetchGoogleOAuthConfig = async () => {
    try {
      const res = await apiFetch('/api/settings/google-oauth');
      const data = await res.json();
      setGoogleOAuthStatus(data);
      if (data.clientId) {
        setGoogleOAuthForm(prev => ({
          ...prev,
          clientId: data.clientId
        }));
      }
    } catch (err) {
      console.error('Failed to load Google OAuth config:', err);
    }
  };

  const saveGoogleOAuthSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleOAuthForm.clientId || !googleOAuthForm.clientSecret) {
      showNotification('error', 'Both Client ID and Client Secret are required.');
      return;
    }
    setIsSavingGoogleOAuth(true);
    try {
      const res = await apiFetch('/api/settings/google-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googleOAuthForm)
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'Google Cloud OAuth credentials saved successfully!');
        setGoogleOAuthForm(prev => ({ ...prev, clientSecret: '' }));
        await fetchGoogleOAuthConfig();
        await fetchGoogleUrl();
      } else {
        showNotification('error', data.error || 'Failed to save Google OAuth credentials');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to save Google OAuth credentials');
    } finally {
      setIsSavingGoogleOAuth(false);
    }
  };

  const fetchMetaConfig = async () => {
    try {
      const res = await apiFetch('/api/meta/config');
      const data = await res.json();
      setMetaConfigured(data.configured);
      if (data.configured && data.config) {
        setMetaConfig(data.config);
        localStorage.setItem('reelpilot_cached_meta_config', JSON.stringify(data.config));
        setMetaForm({
          appId: data.config.appId,
          appSecret: data.config.appSecret,
          accessToken: data.config.accessToken,
          instagramBusinessAccountId: data.config.instagramBusinessAccountId,
          facebookPageId: data.config.facebookPageId,
          graphApiVersion: data.config.graphApiVersion,
          businessPortfolioId: data.config.businessPortfolioId || '',
          webhookVerifyToken: data.config.webhookVerifyToken || '',
          appMode: data.config.appMode,
          environment: data.config.environment,
          videoDeliveryMode: data.config.videoDeliveryMode || 'proxy'
        });
      }
    } catch (err) {
      console.warn('Failed to fetch meta config:', err);
    }
  };

  const fetchDriveConfig = async () => {
    try {
      const res = await apiFetch('/api/drive/config');
      const data = await res.json();
      if (data.config) {
        setDriveConfig(data.config);
        localStorage.setItem('reelpilot_cached_drive_config', JSON.stringify(data.config));
        setSelectedFolder(data.config.selectedFolderId);
        // Fetch synced list
        syncFolderFiles(false);
      }
      // Load available folders
      fetchGoogleFolders();
    } catch (err) {
      console.warn('Failed to fetch drive config:', err);
    }
  };

  const fetchGoogleTokenInfo = async () => {
    setIsCheckingTokenInfo(true);
    try {
      const res = await apiFetch('/api/drive/token-info');
      const data = await res.json();
      setGoogleTokenInfo(data);
    } catch (err: any) {
      console.warn('Failed to fetch Google token info:', err);
    } finally {
      setIsCheckingTokenInfo(false);
    }
  };

  const fetchGoogleFolders = async () => {
    try {
      const res = await apiFetch('/api/drive/folders');
      const data = await res.json();
      if (data.folders && Array.isArray(data.folders)) {
        setFolders(data.folders);
      }
      fetchGoogleTokenInfo();
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  const fetchSchedules = async () => {
    try {
      const res = await apiFetch('/api/schedules');
      const data = await res.json();
      if (data.schedules && Array.isArray(data.schedules)) {
        setSchedules(data.schedules);
        localStorage.setItem('reelpilot_cached_schedules', JSON.stringify(data.schedules));
      }
    } catch (err) {
      console.warn('Failed to fetch schedules:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/api/logs');
      const data = await res.json();
      if (data.logs && Array.isArray(data.logs)) {
        setLogs(data.logs);
        localStorage.setItem('reelpilot_cached_logs', JSON.stringify(data.logs));
      }
    } catch (err) {
      console.warn('Failed to fetch logs:', err);
    }
  };

  const fetchDashboardStats = async () => {
    try {
      const res = await apiFetch('/api/dashboard/stats');
      const data = await res.json();
      if (data && !data.error) {
        setDashboardStats(data);
        localStorage.setItem('reelpilot_cached_stats', JSON.stringify(data));
      }
    } catch (err) {
      console.warn('Failed to fetch dashboard stats:', err);
    }
  };

  const pingWorker = async () => {
    setActionLoading('ping_worker');
    try {
      const res = await apiFetch('/api/system/health/ping', { method: 'POST' });
      const data = await res.json();
      if (data.health) {
        setDashboardStats(prev => prev ? { ...prev, systemHealth: data.health } : null);
      }
      await fetchLogs();
      await fetchSchedules();
      showNotification('success', 'Background worker heartbeat recorded. System health refreshed.');
    } catch (err: any) {
      showNotification('error', `Failed to ping background worker: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const resetWorker = async () => {
    setActionLoading('reset_worker');
    try {
      const res = await apiFetch('/api/system/health/reset', { method: 'POST' });
      const data = await res.json();
      if (data.health) {
        setDashboardStats(prev => prev ? { ...prev, systemHealth: data.health } : null);
      }
      await fetchLogs();
      showNotification('info', 'Worker concurrency lock reset successfully.');
    } catch (err: any) {
      showNotification('error', `Failed to reset worker lock: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const clearSystemApiError = async () => {
    try {
      const res = await apiFetch('/api/system/health/clear-error', { method: 'POST' });
      const data = await res.json();
      if (data.health) {
        setDashboardStats(prev => prev ? { ...prev, systemHealth: data.health } : null);
      }
      showNotification('info', 'API error notice cleared.');
    } catch (err: any) {
      console.error('Failed to clear error notice:', err);
    }
  };

  // Google Drive Actions
  const handleConnectManualFolder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!manualFolderInput.trim()) {
      showNotification('error', 'Please enter a Google Drive folder URL or ID.');
      return;
    }
    let folderId = manualFolderInput.trim();
    // Extract ID if URL was pasted
    const match = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      folderId = match[1];
    }
    await connectDriveFolder(folderId, 'Selected Drive Folder');
    setManualFolderInput('');
  };

  const connectDriveFolder = async (folderId: string, folderName?: string) => {
    let name = folderName;
    if (!name) {
      const matchedFolder = folders.find(f => f.id === folderId);
      name = matchedFolder ? matchedFolder.name : 'Selected Folder';
    }

    setActionLoading('connect_folder');
    try {
      const res = await apiFetch('/api/drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, folderName: name })
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', `Connected folder: ${name}`);
        const newDriveConfig = {
          selectedFolderId: folderId,
          selectedFolderName: name,
          lastSyncedAt: Date.now()
        };
        setDriveConfig(newDriveConfig);
        localStorage.setItem('reelpilot_cached_drive_config', JSON.stringify(newDriveConfig));
        if (data.videos) {
          setSyncedVideos(data.videos);
          localStorage.setItem('reelpilot_cached_videos', JSON.stringify(data.videos));
        }
        loadAllData();
      } else {
        showNotification('error', data.error || 'Failed to connect folder.');
      }
    } catch (err) {
      showNotification('error', 'Connection timed out.');
    } finally {
      setActionLoading(null);
    }
  };

  const openGooglePicker = async () => {
    setActionLoading('opening_picker');
    try {
      let tokenRes = await apiFetch('/api/auth/token');
      
      // If token endpoint failed (e.g. session missing or expired), try syncing Firebase session first
      if (!tokenRes.ok) {
        const firebaseUser = auth.currentUser;
        if (firebaseUser) {
          try {
            const fbRes = await apiFetch('/api/auth/firebase-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL
              })
            });
            const fbData = await fbRes.json();
            if (fbData.sessionId) {
              localStorage.setItem('reelpilot_session_id', fbData.sessionId);
              tokenRes = await apiFetch('/api/auth/token');
            }
          } catch (e) {
            console.error('Failed to re-sync session in openGooglePicker:', e);
          }
        }
      }

      if (!tokenRes.ok) {
        if (googleAuthUrl) {
          const width = 600;
          const height = 700;
          const left = window.screen.width / 2 - width / 2;
          const top = window.screen.height / 2 - height / 2;
          window.open(
            googleAuthUrl,
            'google_oauth_popup',
            `width=${width},height=${height},left=${left},top=${top},status=0,menubar=0,toolbar=0`
          );
          showNotification('error', 'Google Drive authorization required. Please authorize Google Drive in the popup window.');
          return;
        }
        throw new Error('Failed to fetch a fresh Google Access Token. Please log in again.');
      }
      const { accessToken } = await tokenRes.json();
      if (!accessToken) {
        if (googleAuthUrl) {
          const width = 600;
          const height = 700;
          const left = window.screen.width / 2 - width / 2;
          const top = window.screen.height / 2 - height / 2;
          window.open(
            googleAuthUrl,
            'google_oauth_popup',
            `width=${width},height=${height},left=${left},top=${top},status=0,menubar=0,toolbar=0`
          );
          showNotification('error', 'Google Drive authorization required. Please authorize Google Drive in the popup window.');
          return;
        }
        throw new Error('Access token not found. Please connect Google Drive first.');
      }

      if (!(window as any).gapi || !(window as any).google || !(window as any).google.picker) {
        throw new Error('Google Picker library is still loading. Please try again in a moment.');
      }

      const pickerOrigin =
        window.location.ancestorOrigins &&
        window.location.ancestorOrigins.length > 0
          ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
          : window.location.origin;

      const google = (window as any).google;
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMimeTypes('application/vnd.google-apps.folder')
        .setSelectFolderEnabled(true);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs[0];
            const folderId = doc.id;
            const folderName = doc.name;
            connectDriveFolder(folderId, folderName);
          }
        })
        .setOrigin(pickerOrigin)
        .setTitle('Select Google Drive folder for ReelPilot')
        .build();

      picker.setVisible(true);
      showNotification('success', 'Google Picker opened! Select a folder.');
    } catch (err: any) {
      console.error('Failed to open Google Picker:', err);
      showNotification('error', err.message || 'Failed to open Google Picker.');
    } finally {
      setActionLoading(null);
    }
  };

  const syncFolderFiles = async (showToast = true) => {
    setActionLoading('sync_files');
    try {
      const res = await apiFetch('/api/drive/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDriveAuthExpired(false);
        let msg = `Synchronized ${data.videos?.length || 0} videos.`;
        if (data.healedCount && data.healedCount > 0) {
          msg += ` Auto-repaired ${data.healedCount} scheduled post(s)!`;
        }
        if (showToast) showNotification('success', msg);
        const videosList = data.videos || [];
        setSyncedVideos(videosList);
        localStorage.setItem('reelpilot_cached_videos', JSON.stringify(videosList));
        fetchSchedules();
        fetchLogs();
        fetchDashboardStats();
      } else {
        if (res.status === 401 || data.needsReauth || data.error?.includes('expired') || data.error?.includes('unauthorized')) {
          setDriveAuthExpired(true);
        }
        if (showToast) showNotification('error', data.error || 'Failed to sync folder.');
      }
    } catch (err: any) {
      if (showToast) showNotification('error', 'Sync failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const retryAllFailed = async () => {
    setActionLoading('retry_failed');
    try {
      const res = await apiFetch('/api/schedules/retry-all-failed', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', data.message || `Re-queued ${data.count || 0} post(s) for immediate publishing.`);
        fetchSchedules();
        fetchLogs();
        fetchDashboardStats();
      } else {
        showNotification('error', data.error || 'Failed to retry posts.');
      }
    } catch (err) {
      showNotification('error', 'Retry request failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const retrySingleSchedule = async (scheduleId: string) => {
    setActionLoading(`retry_${scheduleId}`);
    try {
      const res = await apiFetch(`/api/schedules/${scheduleId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Post re-queued for immediate publishing!');
        fetchSchedules();
        fetchLogs();
        fetchDashboardStats();
        if (selectedScheduleDetail?.id === scheduleId) {
          setSelectedScheduleDetail(prev => prev ? { ...prev, status: 'pending', retryCount: 0, errorMessage: undefined } : null);
        }
      } else {
        showNotification('error', data.error || 'Failed to retry schedule.');
      }
    } catch (err) {
      showNotification('error', 'Retry request failed.');
    } finally {
      setActionLoading(null);
    }
  };

  // Meta Actions
  const saveMetaSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('save_meta');
    try {
      const res = await apiFetch('/api/meta/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaForm)
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Meta configuration saved and encrypted safely.');
        setMetaConfigured(true);
        fetchMetaConfig();
        fetchDashboardStats();
      } else {
        showNotification('error', data.error || 'Failed to save settings.');
      }
    } catch (err) {
      showNotification('error', 'Failed to connect.');
    } finally {
      setActionLoading(null);
    }
  };

  const verifyMeta = async () => {
    setActionLoading('verify_meta');
    setMetaVerifyResult(null);
    try {
      const res = await apiFetch('/api/meta/verify', { method: 'POST' });
      const data = await res.json();
      setMetaVerifyResult(data);
      if (data.success) {
        showNotification('success', `Verification successful! Connected to @${data.username}`);
      } else {
        showNotification('error', 'Meta verification failed. Inspect the API details below.');
      }
    } catch (err) {
      showNotification('error', 'Verification API failure.');
    } finally {
      setActionLoading(null);
    }
  };

  const refreshToken = async () => {
    setActionLoading('refresh_meta_token');
    try {
      const res = await apiFetch('/api/meta/refresh-token', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Long-lived access token refreshed.');
        fetchMetaConfig();
      } else {
        showNotification('error', data.error || 'Token refresh failed.');
      }
    } catch (err) {
      showNotification('error', 'Token exchange broke.');
    } finally {
      setActionLoading(null);
    }
  };

  // Scheduling Actions
  const createSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVideoForSchedule || !scheduleDate || !scheduleTime) {
      showNotification('error', 'Please provide date and time.');
      return;
    }

    // Parse date and time in timezone context
    const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}:00`);
    if (isNaN(scheduledDateTime.getTime())) {
      showNotification('error', 'Invalid date/time provided.');
      return;
    }

    if (scheduledDateTime.getTime() < Date.now()) {
      showNotification('error', 'Cannot schedule in the past.');
      return;
    }

    setActionLoading('create_schedule');
    try {
      const payload = {
        videoFileId: selectedVideoForSchedule.id,
        videoFileName: selectedVideoForSchedule.name,
        captionFileId: selectedVideoForSchedule.captionFileId,
        captionFileName: selectedVideoForSchedule.captionFileName,
        captionText: customCaption || selectedVideoForSchedule.captionText || '',
        scheduledTime: scheduledDateTime.getTime(),
        timezone: DEFAULT_TIMEZONE,
        recurrence: scheduleRecurrence
      };

      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        if (data.schedule) {
          setSchedules(prev => {
            const nextList = [...prev.filter(s => s.id !== data.schedule.id), data.schedule];
            try { localStorage.setItem('reelpilot_cached_schedules', JSON.stringify(nextList)); } catch (e) {}
            return nextList;
          });
          setCurrentCalendarDate(new Date(payload.scheduledTime));
        }
        // Instantly refresh state from backend
        fetchSchedules();
        fetchDashboardStats();

        // Trigger high-quality multi-directional confetti bursts
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 }
        });
        setTimeout(() => {
          confetti({
            particleCount: 40,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.6 }
          });
        }, 150);
        setTimeout(() => {
          confetti({
            particleCount: 40,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.6 }
          });
        }, 300);

        setScheduleSuccess(true);
        showNotification('success', `Successfully scheduled reel: ${payload.videoFileName}`);
        
        // Retain checkmark state on button for 1.8s, then reset form
        setTimeout(() => {
          setSelectedVideoForSchedule(null);
          setScheduleDate('');
          setScheduleTime('');
          setScheduleRecurrence('single');
          setCustomCaption('');
          setScheduleSuccess(false);
        }, 1800);
      } else {
        showNotification('error', data.error || 'Failed to create schedule.');
      }
    } catch (err) {
      showNotification('error', 'Failed to communicate with schedule API.');
    } finally {
      setActionLoading(null);
    }
  };

  // Bulk Scheduling Action
  const createBulkSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVideoIds.length === 0) {
      showNotification('error', 'No videos selected for bulk scheduling.');
      return;
    }
    if (!bulkDate || !bulkTime) {
      showNotification('error', 'Please provide bulk start date and time.');
      return;
    }

    const baseDateTime = new Date(`${bulkDate}T${bulkTime}:00`);
    if (isNaN(baseDateTime.getTime())) {
      showNotification('error', 'Invalid date/time provided.');
      return;
    }

    if (baseDateTime.getTime() < Date.now()) {
      showNotification('error', 'Cannot schedule in the past.');
      return;
    }

    setActionLoading('bulk_schedule');
    let successCount = 0;
    let failureCount = 0;

    try {
      // Create a copy of the selected IDs so we don't mutate while processing
      const idsToProcess = [...selectedVideoIds];
      
      for (let i = 0; i < idsToProcess.length; i++) {
        const id = idsToProcess[i];
        const video = syncedVideos.find(v => v.id === id);
        if (!video) continue;

        // Calculate time spacing
        let itemTime = baseDateTime.getTime();
        if (bulkSpacing === 'space_out') {
          itemTime += i * (bulkSpacingHours * 60 * 60 * 1000);
        }

        const payload = {
          videoFileId: video.id,
          videoFileName: video.name,
          captionFileId: video.captionFileId,
          captionFileName: video.captionFileName,
          captionText: video.captionText || '',
          scheduledTime: itemTime,
          timezone: DEFAULT_TIMEZONE,
          recurrence: bulkRecurrence
        };

        const res = await apiFetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          successCount++;
        } else {
          failureCount++;
        }
      }

      if (successCount > 0) {
        showNotification('success', `Bulk scheduled ${successCount} reels successfully!${failureCount > 0 ? ` (${failureCount} failed)` : ''}`);
        setSelectedVideoIds([]);
        setBulkDate('');
        setBulkTime('');
        fetchSchedules();
        fetchDashboardStats();
      } else {
        showNotification('error', 'Failed to schedule any of the selected reels.');
      }
    } catch (err) {
      showNotification('error', 'Error occurred during bulk scheduling.');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleSelectVideo = (id: string) => {
    setSelectedVideoIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (syncedVideos.length === 0) return;
    if (selectedVideoIds.length === syncedVideos.length) {
      setSelectedVideoIds([]);
    } else {
      setSelectedVideoIds(syncedVideos.map(v => v.id));
    }
  };

  const handleStartEditCaption = (videoId: string, currentText: string) => {
    setEditingCaptionVideoId(videoId);
    setEditingCaptionText(currentText);
  };

  const handleSaveCaption = (videoId: string) => {
    setSyncedVideos(prev => prev.map(video => {
      if (video.id === videoId) {
        return {
          ...video,
          captionText: editingCaptionText,
          isTweaked: true
        };
      }
      return video;
    }));
    setEditingCaptionVideoId(null);
    setEditingCaptionText('');
    showNotification('success', 'Caption updated successfully!');
  };

  const handleGenerateCaptionWithAI = async (videoName: string) => {
    setIsGeneratingCaption(true);
    try {
      const res = await apiFetch('/api/ai/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoName })
      });
      const data = await res.json();
      if (res.ok && data.caption) {
        setEditingCaptionText(data.caption);
        showNotification('success', 'AI Caption generated successfully!');
      } else {
        showNotification('error', data.error || 'Failed to generate AI caption.');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'An error occurred during AI caption generation.');
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleUpdateScheduleTime = async (id: string, newTimeMs: number) => {
    try {
      const res = await apiFetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledTime: newTimeMs })
      });
      if (res.ok) {
        showNotification('success', 'Post rescheduled successfully.');
        fetchSchedules();
        fetchDashboardStats();
        if (selectedScheduleDetail?.id === id) {
          setSelectedScheduleDetail(prev => prev ? { ...prev, scheduledTime: newTimeMs } : null);
        }
      } else {
        const data = await res.json();
        showNotification('error', data.error || 'Reschedule failed.');
      }
    } catch (err) {
      showNotification('error', 'Failed to reschedule.');
    }
  };

  // Helper to find pending schedule conflicts (exact same time/minute)
  const findConflict = (targetTimeMs: number, excludeScheduleId?: string, list: Schedule[] = schedules): Schedule | null => {
    if (!targetTimeMs || isNaN(targetTimeMs)) return null;
    return list.find(s => 
      s.id !== excludeScheduleId && 
      s.status === 'pending' && 
      Math.abs(s.scheduledTime - targetTimeMs) < 60 * 1000 // same minute
    ) || null;
  };

  // Helper to compute next open 1-hour buffered timestamp
  const getSuggestedBufferedTime = (targetTimeMs: number, excludeScheduleId?: string, list: Schedule[] = schedules): number => {
    let candidate = targetTimeMs + 60 * 60 * 1000; // +1 hour buffer (3,600,000 ms)
    // If candidate also clashes with another scheduled reel, keep spacing out by 1 hour
    while (list.some(s => s.id !== excludeScheduleId && s.status === 'pending' && Math.abs(s.scheduledTime - candidate) < 60 * 1000)) {
      candidate += 60 * 60 * 1000;
    }
    return candidate;
  };

  // Find all conflicting pending schedules
  const getConflictingSchedules = (list: Schedule[] = schedules): Schedule[] => {
    const pending = list.filter(s => s.status === 'pending');
    const conflicts: Schedule[] = [];
    for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        if (Math.abs(pending[i].scheduledTime - pending[j].scheduledTime) < 60 * 1000) {
          if (!conflicts.some(c => c.id === pending[j].id)) {
            conflicts.push(pending[j]);
          }
        }
      }
    }
    return conflicts;
  };

  // One-click Auto-Reschedule with 1-hour buffer for an existing schedule
  const handleAutoRescheduleConflict = async (scheduleId: string, currentScheduledTime: number) => {
    const newTimeMs = getSuggestedBufferedTime(currentScheduledTime, scheduleId);
    setActionLoading(`auto_reschedule_${scheduleId}`);
    try {
      const res = await apiFetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledTime: newTimeMs })
      });
      if (res.ok) {
        showNotification(
          'success',
          `Auto-rescheduled with 1-hour buffer to ${new Date(newTimeMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
        );
        fetchSchedules();
        fetchDashboardStats();
        if (selectedScheduleDetail?.id === scheduleId) {
          setSelectedScheduleDetail(prev => prev ? { ...prev, scheduledTime: newTimeMs } : null);
        }
      } else {
        const data = await res.json();
        showNotification('error', data.error || 'Failed to auto-reschedule.');
      }
    } catch (err) {
      showNotification('error', 'Error auto-rescheduling.');
    } finally {
      setActionLoading(null);
    }
  };

  // One-click Auto-Resolve all pending conflicts
  const handleAutoResolveAllConflicts = async () => {
    const conflicts = getConflictingSchedules();
    if (conflicts.length === 0) {
      showNotification('info', 'No schedule conflicts found.');
      return;
    }

    setActionLoading('auto_resolve_all');
    let resolvedCount = 0;
    try {
      for (const item of conflicts) {
        const newTimeMs = getSuggestedBufferedTime(item.scheduledTime, item.id);
        const res = await apiFetch(`/api/schedules/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledTime: newTimeMs })
        });
        if (res.ok) {
          resolvedCount++;
        }
      }
      showNotification('success', `Resolved ${resolvedCount} conflicting schedule(s) with 1-hour buffers!`);
      fetchSchedules();
      fetchDashboardStats();
    } catch (err) {
      showNotification('error', 'Failed to resolve all conflicts.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetToPending = async (id: string) => {
    setActionLoading('reset_pending');
    try {
      const res = await apiFetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' })
      });
      if (res.ok) {
        showNotification('success', 'Reset scheduled reel status to pending.');
        fetchSchedules();
        fetchDashboardStats();
        if (selectedScheduleDetail?.id === id) {
          setSelectedScheduleDetail(prev => prev ? { ...prev, status: 'pending', retryCount: 0 } : null);
        }
      } else {
        showNotification('error', 'Failed to reset.');
      }
    } catch (err) {
      showNotification('error', 'Server error during reset.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateScheduleCaption = async (id: string, caption: string) => {
    try {
      const res = await apiFetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captionText: caption })
      });
      if (res.ok) {
        showNotification('success', 'Caption updated successfully.');
        fetchSchedules();
        fetchDashboardStats();
      } else {
        const data = await res.json();
        showNotification('error', data.error || 'Failed to update caption.');
      }
    } catch (err) {
      showNotification('error', 'Failed to update caption.');
    }
  };

  const handleQuickScheduleVideoFromCalendar = async (video: DriveVideoItem, scheduledTimeMs: number, caption: string) => {
    if (scheduledTimeMs < Date.now()) {
      showNotification('error', 'Cannot schedule in the past.');
      return;
    }

    setActionLoading('create_schedule');
    try {
      const payload = {
        videoFileId: video.id,
        videoFileName: video.name,
        captionFileId: video.captionFileId,
        captionFileName: video.captionFileName,
        captionText: caption || video.captionText || '',
        scheduledTime: scheduledTimeMs,
        timezone: DEFAULT_TIMEZONE,
        recurrence: 'single' as const
      };

      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        if (data.schedule) {
          setSchedules(prev => {
            const nextList = [...prev.filter(s => s.id !== data.schedule.id), data.schedule];
            try { localStorage.setItem('reelpilot_cached_schedules', JSON.stringify(nextList)); } catch (e) {}
            return nextList;
          });
          setCurrentCalendarDate(new Date(scheduledTimeMs));
        }
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
        showNotification('success', `Successfully scheduled reel: ${payload.videoFileName}`);
        fetchSchedules();
        fetchDashboardStats();
      } else {
        showNotification('error', data.error || 'Failed to schedule reel.');
      }
    } catch (err) {
      showNotification('error', 'Error scheduling reel.');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteScheduledPost = async (id: string, bypassConfirm = false) => {
    if (!bypassConfirm) {
      setDeletingScheduleId(id);
      return;
    }
    setActionLoading('delete_schedule');
    try {
      const res = await apiFetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotification('success', 'Scheduled post cancelled and removed.');
        setSelectedScheduleDetail(null);
        setDeletingScheduleId(null);
        fetchSchedules();
        fetchDashboardStats();
      } else {
        showNotification('error', 'Failed to delete schedule.');
      }
    } catch (err) {
      showNotification('error', 'Failed to remove scheduled post.');
    } finally {
      setActionLoading(null);
    }
  };

  const clearAllLogs = async (bypassConfirm = false) => {
    if (!bypassConfirm) {
      setConfirmClearLogs(true);
      return;
    }
    setConfirmClearLogs(false);
    setActionLoading('clear_logs');
    try {
      const res = await apiFetch('/api/logs', { method: 'DELETE' });
      if (res.ok) {
        showNotification('success', 'Logs cleared successfully.');
        fetchLogs();
      } else {
        showNotification('error', 'Failed to clear logs.');
      }
    } catch (err) {
      showNotification('error', 'Server connection error.');
    } finally {
      setActionLoading(null);
    }
  };

  // Calendar drag-and-drop helpers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnDate = (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;

    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;

    if (schedule.status === 'published' || schedule.status === 'publishing') {
      showNotification('error', 'Cannot reschedule already published or publishing reels.');
      return;
    }

    const currentSchTime = new Date(schedule.scheduledTime);
    // Retain original scheduled hour/minute/second
    const newDateTime = new Date(targetDate);
    newDateTime.setHours(currentSchTime.getHours(), currentSchTime.getMinutes(), currentSchTime.getSeconds());

    if (newDateTime.getTime() < Date.now()) {
      showNotification('error', 'Cannot drag schedule to a past date.');
      return;
    }

    const conflict = findConflict(newDateTime.getTime(), id);
    if (conflict) {
      const bufferedTime = getSuggestedBufferedTime(newDateTime.getTime(), id);
      showNotification('info', `Conflict with "${conflict.videoFileName}" detected. Auto-rescheduled with 1-hour buffer.`);
      handleUpdateScheduleTime(id, bufferedTime);
      return;
    }

    handleUpdateScheduleTime(id, newDateTime.getTime());
  };

  // Helper to render calendar days
  const getMonthDays = (baseDate: Date) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    
    // Previous month padding
    const prevMonthTotalDays = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthTotalDays - i),
        isCurrentMonth: false
      });
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }

    // Next month padding to fill grid
    const totalCells = 42; // 6 rows of 7 days
    const nextMonthPadding = totalCells - days.length;
    for (let i = 1; i <= nextMonthPadding; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }

    return days;
  };

  const formatYMD = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const formatReadableDateTime = (dateStr: string, timeStr: string): string => {
    if (!dateStr || !timeStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const date = new Date(y, m - 1, d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[date.getMonth()];
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    const minStr = String(min).padStart(2, '0');
    return `${monthName} ${d}, ${y} at ${h12}:${minStr} ${ampm}`;
  };

  const getCustomPickerDays = (baseDate: Date) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    
    // Day index of first day of the month (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const firstDayIndex = new Date(year, month, 1).getDay();
    // Adjust so Monday is 0, Sunday is 6
    const mondayFirstIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    
    // Previous month padding
    const prevMonthTotalDays = new Date(year, month, 0).getDate();
    for (let i = mondayFirstIndex - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthTotalDays - i),
        isCurrentMonth: false
      });
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }

    // Next month padding to fill a clean grid (42 cells)
    const totalCells = 42;
    const nextMonthPadding = totalCells - days.length;
    for (let i = 1; i <= nextMonthPadding; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }

    return days;
  };

  const hasSchedulesOnDate = (date: Date) => {
    const ymd = formatYMD(date);
    return schedules.some(s => {
      const schDate = new Date(s.scheduledTime);
      return formatYMD(schDate) === ymd;
    });
  };

  const getFormattedBottomLabel = (dateStr: string, timeStr: string): string => {
    if (!dateStr || !timeStr) return 'Select Date & Time';
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const date = new Date(y, m - 1, d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[date.getMonth()];
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    const minStr = String(min).padStart(2, '0');
    return `${monthName} ${d}, ${y} ${h12}:${minStr} ${ampm}`;
  };

  const handlePickerMonthChange = (direction: number) => {
    setPickerYearMonth(prev => {
      const copy = new Date(prev);
      copy.setMonth(copy.getMonth() + direction);
      return copy;
    });
  };

  // Initial Session Verification Screen (prevents flash of login card if already authenticated)
  if (authLoading && !currentUser) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 relative" id="auth_verifying_screen">
        <div className="w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-5 animate-pulse">
          <Instagram className="w-7 h-7 text-white" />
        </div>
        <div className="flex items-center gap-2 text-zinc-400 text-xs font-mono">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
          Verifying session...
        </div>
      </div>
    );
  }

  // Onboarding Layout if not authenticated (ReelPilot sign-in design)
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 relative" id="onboarding_layout">
        {/* Abstract Background Accents */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.98, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-[450px] w-full bg-[#151518] border border-zinc-800/80 p-10 rounded-2xl relative z-10 shadow-2xl flex flex-col items-center text-center"
          id="reelpilot_login_card"
        >
          {/* ReelPilot Logo */}
          <div className="w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-6">
            <Instagram className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-3xl font-display font-bold text-zinc-100 tracking-tight mb-1">
            ReelPilot
          </h1>
          <p className="text-xs font-mono tracking-widest text-blue-500 uppercase font-semibold mb-6">
            Instagram Reels Scheduler
          </p>

          <p className="text-sm text-zinc-400 leading-relaxed mb-8 max-w-[340px] font-sans">
            Automatically organize, sync, and schedule your video files and captions from Google Drive straight to Instagram Reels.
          </p>

          <div className="w-full space-y-4">
            <button
              type="button"
              disabled={authLoading}
              onClick={() => loginWithGoogle()}
              className={`w-full py-3.5 px-4 bg-white hover:bg-zinc-100 text-zinc-950 text-sm font-semibold rounded-xl transition duration-200 cursor-pointer flex items-center justify-center gap-3 shadow-md hover:shadow-lg hover:shadow-white/5 active:scale-[0.99] font-sans ${
                authLoading ? 'opacity-85 cursor-not-allowed' : ''
              }`}
            >
              {authLoading ? (
                <RefreshCw className="w-4 h-4 text-zinc-950 animate-spin shrink-0" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
              )}
              {authLoading ? 'Connecting to Google Auth...' : 'Continue with Google'}
            </button>

            {authLoading && (
              <div className="flex items-center justify-between px-3 py-2 bg-blue-950/20 border border-blue-900/30 rounded-lg text-left" id="popup_status_bar">
                <span className="text-[11px] text-zinc-400 font-sans flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />
                  Waiting for Google popup...
                </span>
                <button
                  type="button"
                  onClick={() => setAuthLoading(false)}
                  className="text-[11px] text-red-400 hover:text-red-300 font-semibold font-sans cursor-pointer hover:underline"
                >
                  Cancel / Reset
                </button>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 pt-1">
              <span className="text-[11px] text-zinc-500 font-sans">
                Secure single sign-on with Google Drive permissions
              </span>
            </div>

            {/* Google OAuth Verification & 403 Access Guide */}
            <div className="text-left bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mt-6 space-y-3" id="google_unverified_guide">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-amber-300 font-sans mb-1">
                    Encountering "403: Access Denied / Not authorized"?
                  </h4>
                  <p className="text-[11px] text-zinc-400 leading-normal font-sans">
                    Because your Google Cloud OAuth Consent Screen is in <strong>Testing mode</strong>, Google blocks accounts that haven't been added to the test users list.
                  </p>
                  <div className="mt-2 text-[11px] text-zinc-300 bg-black/40 p-2.5 rounded-lg border border-amber-500/20 space-y-1 font-sans">
                    <p className="font-medium text-amber-200">How to allow your email:</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-zinc-400">
                      <li>Go to <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">Google Cloud Console &gt; OAuth consent screen</a></li>
                      <li>Scroll down to <strong>"Test users"</strong> and click <strong>"+ ADD USERS"</strong></li>
                      <li>Add your Google account email (e.g. <code>{gmailEmail || 'your-email@gmail.com'}</code>) and click <strong>Save</strong></li>
                      <li>Or switch your app Publishing status to <strong>"In Production"</strong> to let any Google account sign in.</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-amber-500/10 text-[11px] text-zinc-400">
                <span className="text-amber-300 font-medium block mb-0.5">Google "Unverified App" Warning?</span>
                Click <span className="text-zinc-200 font-medium">Advanced</span> &gt; <span className="text-zinc-200 font-medium">Go to project (unsafe)</span> to approve Google Drive access.
              </div>
            </div>
          </div>

          {/* Footer of card */}
          <div className="w-full mt-10 pt-6 border-t border-zinc-800/60 flex items-center justify-between text-zinc-500 text-[11px] font-sans">
            <span className="cursor-pointer hover:text-zinc-400">English (United States)</span>
            <div className="flex gap-4">
              <span className="cursor-pointer hover:text-zinc-400">Help</span>
              <span className="cursor-pointer hover:text-zinc-400">Privacy</span>
              <span className="cursor-pointer hover:text-zinc-400">Terms</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex" id="main_layout">
      {/* Dynamic Floating Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            key={`toast-${notification.type}-${notification.message}`}
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl border shadow-2xl ${
              notification.type === 'success' 
                ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300' 
                : 'bg-red-950/80 border-red-500/30 text-red-300'
            }`}
            id="toast_notification"
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SIDEBAR NAVIGATION */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col justify-between shrink-0" id="sidebar">
        <div className="p-6">
          {/* Logo / Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Instagram className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-zinc-100 text-md tracking-tight">ReelPilot</h2>
              <p className="text-[9px] font-mono tracking-widest text-blue-500 uppercase font-semibold">Instagram scheduler</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="space-y-1">
            <button
              onClick={() => handleTabChange('dashboard')}
              className={`w-full py-2 px-3 rounded-md flex items-center gap-3 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'dashboard' 
                  ? 'bg-zinc-900 text-white' 
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <LayoutDashboard className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-blue-500' : 'text-zinc-400'}`} />
              Dashboard
            </button>
            <button
              onClick={() => handleTabChange('calendar')}
              className={`w-full py-2 px-3 rounded-md flex items-center gap-3 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'calendar' 
                  ? 'bg-zinc-900 text-white' 
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <CalendarIcon className={`w-4 h-4 ${activeTab === 'calendar' ? 'text-blue-500' : 'text-zinc-400'}`} />
              Calendar
            </button>
            <button
              onClick={() => handleTabChange('drive')}
              className={`w-full py-2 px-3 rounded-md flex items-center gap-3 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'drive' 
                  ? 'bg-zinc-900 text-white' 
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <HardDrive className={`w-4 h-4 ${activeTab === 'drive' ? 'text-blue-500' : 'text-zinc-400'}`} />
              Google Drive
            </button>
            <button
              onClick={() => handleTabChange('meta')}
              className={`w-full py-2 px-3 rounded-md flex items-center gap-3 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'meta' 
                  ? 'bg-zinc-900 text-white' 
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <Settings className={`w-4 h-4 ${activeTab === 'meta' ? 'text-blue-500' : 'text-zinc-400'}`} />
              Meta Settings
            </button>
            <button
              onClick={() => handleTabChange('logs')}
              className={`w-full py-2 px-3 rounded-md flex items-center gap-3 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'logs' 
                  ? 'bg-zinc-900 text-white' 
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <History className={`w-4 h-4 ${activeTab === 'logs' ? 'text-blue-500' : 'text-zinc-400'}`} />
              Logs
            </button>
          </nav>
        </div>

        {/* User Info / Profile card */}
        <div className="p-4 border-t border-zinc-800 bg-[#09090b]">
          <div className="flex items-center gap-3 mb-3">
            {currentUser.picture ? (
              <img src={currentUser.picture} alt={currentUser.name} className="w-8 h-8 rounded-full border border-zinc-800" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-zinc-400" />
              </div>
            )}
            <div className="overflow-hidden">
              <h4 className="text-xs font-semibold text-zinc-100 truncate">{currentUser.name}</h4>
              <p className="text-[10px] text-zinc-500 truncate">Pro Plan</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full py-1.5 px-3 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer font-medium"
            id="btn_logout"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect Google
          </button>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0" id="main_content">
        {/* Dynamic Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-950/50 backdrop-blur-md" id="header">
          <div className="flex items-center gap-3">
            <span className="text-zinc-300 text-xs font-mono uppercase bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800 font-semibold flex items-center gap-1.5 shadow-sm">
              <span className="text-amber-500 font-bold">🇮🇳 IST:</span>
              <span className="text-zinc-100 font-bold tracking-wide">
                {now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </span>
            </span>
            <span className="text-zinc-600 text-xs font-mono">•</span>
            <span className="text-zinc-400 text-xs font-mono flex items-center gap-1">
              <span>IST Date:</span>
              <span className="text-zinc-200 font-semibold">
                {now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </span>
          </div>

          {/* Quick status dots */}
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-full text-[10px] uppercase tracking-wider font-bold ${
              driveConfig 
                ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                : 'bg-red-500/10 border-red-500/20 text-red-500'
            }`}>
              <div className={`w-2 h-2 rounded-full ${driveConfig ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span>Drive: {driveConfig ? 'Connected' : 'Unconnected'}</span>
            </div>

            <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-full text-[10px] uppercase tracking-wider font-bold ${
              metaConfigured 
                ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                : 'bg-red-500/10 border-red-500/20 text-red-500'
            }`}>
              <div className={`w-2 h-2 rounded-full ${metaConfigured ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span>Meta Graph: {metaConfigured ? 'Connected' : 'Unconfigured'}</span>
            </div>
            
            <button
              onClick={() => loadAllData()}
              disabled={actionLoading !== null}
              className="p-1.5 text-zinc-400 hover:text-blue-500 rounded-lg hover:bg-zinc-900 border border-zinc-800/80 transition duration-200 disabled:opacity-50 cursor-pointer"
              title="Refresh all records"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading === 'loading_all' ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* Workspace views content */}
        <div className="flex-1 overflow-y-auto p-8" id="view_container">
          <AnimatePresence mode="wait">
            
            {/* 1. DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-8"
              >
                {/* Google Drive Re-auth Notice if token expired */}
                {driveAuthExpired && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4" id="dashboard_drive_reauth_alert">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-amber-200">Google Drive Session Requires Authorization</h4>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Your Google Drive access token expired or needs fresh permissions to sync videos and captions.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={reconnectGoogleDrive}
                      disabled={authLoading}
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-xl transition duration-150 flex items-center gap-2 shrink-0 cursor-pointer shadow-md active:scale-95"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${authLoading ? 'animate-spin' : ''}`} />
                      {authLoading ? 'Authorizing...' : '⚡ Re-authenticate Google Drive'}
                    </button>
                  </div>
                )}

                {/* Onboarding Banner if setup is missing */}
                {(!driveConfig || !metaConfigured) && (
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/20 via-zinc-900 to-blue-950/10 border border-blue-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="font-display font-semibold text-blue-400 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 shrink-0" /> Let's pilot your first Instagram Reel
                      </h3>
                      <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
                        To get up and running, select your target folder in the <strong>Drive Sync</strong> menu, and input your encrypted Meta developer credentials in the <strong>Meta Settings</strong> menu.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!driveConfig && (
                        <button
                          onClick={() => handleTabChange('drive')}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-semibold rounded-lg transition cursor-pointer"
                        >
                          Select Drive Folder
                        </button>
                      )}
                      {!metaConfigured && (
                        <button
                          onClick={() => handleTabChange('meta')}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                        >
                          Configure Meta API
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Dashboard Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Drive Folder Status</p>
                    <h3 className="text-2xl font-light text-zinc-100 mt-1.5 truncate flex items-center gap-1.5" title={driveConfig?.selectedFolderName || 'None selected'}>
                      <Folder className="w-5 h-5 text-zinc-500 shrink-0" />
                      {driveConfig ? driveConfig.selectedFolderName : 'None Connected'}
                    </h3>
                    <p className="text-[10px] text-zinc-500 mt-2 font-medium">
                      Available: <span className="text-blue-500">{dashboardStats?.videosAvailableCount || 0} videos</span>
                    </p>
                  </div>

                  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Pending Reels</p>
                    <p className="text-3xl font-light text-zinc-100 mt-1">{dashboardStats?.scheduledCount || 0}</p>
                    <p className="text-[10px] text-zinc-500 mt-2 font-medium">Monitoring /Reels/ folder</p>
                  </div>

                  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Published Today</p>
                    <p className="text-3xl font-light text-zinc-100 mt-1">{dashboardStats?.publishedTodayCount || 0}</p>
                    <p className="text-[10px] text-green-500 mt-2 font-medium">
                      +This week: {dashboardStats?.publishedThisWeekCount || 0}
                    </p>
                  </div>

                  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Failure Rate</p>
                      <p className="text-3xl font-light text-red-400 mt-1">
                        {dashboardStats?.failedCount && dashboardStats.failedCount > 0 ? `${dashboardStats.failedCount} Errors` : '0%'}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-2 font-medium">
                        {dashboardStats?.failedCount && dashboardStats.failedCount > 0 ? 'Posts require attention' : 'Healthy pipeline status'}
                      </p>
                    </div>
                    {dashboardStats?.failedCount && dashboardStats.failedCount > 0 ? (
                      <button
                        onClick={retryAllFailed}
                        disabled={actionLoading === 'retry_failed'}
                        className="mt-3 w-full py-1.5 px-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 hover:text-red-200 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'retry_failed' ? 'animate-spin' : ''}`} />
                        Retry All Failed
                      </button>
                    ) : null}
                  </div>

                  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                        <Gauge className="w-3.5 h-3.5 text-zinc-400" />
                        Meta Rate Limits
                      </p>
                      
                      {dashboardStats?.rateLimits ? (
                        <div className="mt-2.5 space-y-2">
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-zinc-400 font-medium">Business Write Usage</span>
                              <span className={`font-mono text-[10px] font-semibold ${dashboardStats.rateLimits.businessCallCount > 80 ? 'text-red-400' : 'text-zinc-200'}`}>
                                {dashboardStats.rateLimits.businessCallCount}%
                              </span>
                            </div>
                            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-500 ${dashboardStats.rateLimits.businessCallCount > 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(100, Math.max(2, dashboardStats.rateLimits.businessCallCount))}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-[10px] text-zinc-500">
                            <span>App Call Usage:</span>
                            <span className="font-mono">{dashboardStats.rateLimits.appCallCount}%</span>
                          </div>

                          {dashboardStats.rateLimits.estimatedTimeToRegainAccess > 0 && (
                            <p className="text-[10px] text-yellow-500 font-semibold animate-pulse">
                              Wait: {dashboardStats.rateLimits.estimatedTimeToRegainAccess} min
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2.5">
                          <p className="text-2xl font-light text-zinc-400">100%</p>
                          <p className="text-[10px] text-zinc-500 mt-1">Available capacity (no usage logs)</p>
                        </div>
                      )}
                    </div>
                    {dashboardStats?.rateLimits && (
                      <p className="text-[9px] text-zinc-600 mt-2 text-right">
                        Refreshed: {new Date(dashboardStats.rateLimits.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    )}
                  </div>
                </div>

                {/* System Health & Background Worker Diagnostic Widget */}
                <SystemHealthWidget
                  systemHealth={dashboardStats?.systemHealth}
                  onPingWorker={pingWorker}
                  onResetWorker={resetWorker}
                  onClearError={clearSystemApiError}
                  onViewLogs={() => {
                    setActiveTab('logs');
                    setLogFilter('WORKER_HEALTH');
                  }}
                  onRetryFailed={retryAllFailed}
                  isActionLoading={actionLoading}
                />

                {/* Main section: quick schedule + upcoming list */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: Quick Schedule Panel */}
                  <div className="lg:col-span-5 space-y-6">
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-semibold text-lg text-zinc-100 flex items-center gap-2 mb-4">
                          <Sliders className="w-5 h-5 text-blue-500" /> Pilot a New Reel
                        </h3>
                        
                        {syncedVideos.length === 0 ? (
                          <div className="py-8 px-4 rounded-xl border border-dashed border-zinc-800 text-center space-y-3">
                            <Video className="w-8 h-8 text-zinc-600 mx-auto" />
                            <p className="text-xs text-zinc-400">No synchronized videos available to pilot.</p>
                            <button
                              onClick={() => {
                                if (driveConfig) syncFolderFiles();
                                else setActiveTab('drive');
                              }}
                              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs rounded-lg transition"
                            >
                              Sync Folder Now
                            </button>
                          </div>
                        ) : (
                          <form onSubmit={createSchedule} className="space-y-4">
                            <div>
                              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Select Video Asset</label>
                              <select
                                value={selectedVideoForSchedule ? selectedVideoForSchedule.id : ''}
                                onChange={(e) => {
                                  const vid = syncedVideos.find(v => v.id === e.target.value);
                                  setSelectedVideoForSchedule(vid || null);
                                  setCustomCaption(vid?.captionText || '');
                                }}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50"
                                required
                              >
                                <option value="">-- Choose video file --</option>
                                {syncedVideos.map((video, idx) => (
                                  <option key={`${video.id}-${idx}`} value={video.id}>{video.name}</option>
                                ))}
                              </select>

                              {selectedVideoForSchedule && (
                                <div className="mt-2.5 p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <VideoThumbnail
                                      video={selectedVideoForSchedule}
                                      onPreviewClick={(v) => setPreviewVideoModal(v)}
                                      size="sm"
                                    />
                                    <div className="min-w-0">
                                      <span className="text-xs font-semibold text-zinc-200 truncate block font-mono">
                                        {selectedVideoForSchedule.name}
                                      </span>
                                      <span className="text-[10px] text-zinc-500 font-mono">
                                        Click thumbnail to inspect video
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewVideoModal(selectedVideoForSchedule)}
                                    className="text-[11px] font-mono text-blue-400 hover:text-blue-300 font-semibold px-2 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20 shrink-0 cursor-pointer"
                                  >
                                    Preview
                                  </button>
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5 flex justify-between items-center">
                                <span>Launch Schedule</span>
                                {scheduleDate && scheduleTime && (
                                  <span className="text-[10px] text-zinc-500 font-mono font-semibold">
                                    GMT-7 Pacific
                                  </span>
                                )}
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const initialDate = scheduleDate ? new Date(scheduleDate + 'T00:00:00') : new Date();
                                  setPickerYearMonth(initialDate);
                                  setTempSelectedDate(scheduleDate || formatYMD(new Date()));
                                  setTempSelectedTime(scheduleTime || '10:00');
                                  setPickerTarget('single');
                                  setIsCustomPickerOpen(true);
                                }}
                                className="w-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 rounded-xl py-3 px-4 text-xs text-left flex items-center justify-between transition-all duration-200 cursor-pointer text-zinc-200 group"
                              >
                                <div className="flex items-center gap-2.5">
                                  <CalendarIcon className="w-4 h-4 text-blue-500 group-hover:text-blue-400 transition" />
                                  <span className="font-semibold tracking-wide">
                                    {scheduleDate && scheduleTime 
                                      ? formatReadableDateTime(scheduleDate, scheduleTime) 
                                      : 'Select date and time to go live...'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400 transition font-mono uppercase font-semibold border border-zinc-800 group-hover:border-zinc-700 px-2 py-0.5 rounded">
                                  Setup
                                </div>
                              </button>

                              {/* Auto-Reschedule Conflict Prompt */}
                              {(() => {
                                if (!scheduleDate || !scheduleTime) return null;
                                const currentFormTimeMs = new Date(`${scheduleDate}T${scheduleTime}:00`).getTime();
                                if (isNaN(currentFormTimeMs)) return null;
                                const formConflict = findConflict(currentFormTimeMs);
                                if (!formConflict) return null;
                                const formSuggestedBufferedTimeMs = getSuggestedBufferedTime(currentFormTimeMs);
                                const bufferedDate = new Date(formSuggestedBufferedTimeMs);
                                const bufferedDateStr = formatYMD(bufferedDate);
                                const bufferedTimeStr = `${String(bufferedDate.getHours()).padStart(2, '0')}:${String(bufferedDate.getMinutes()).padStart(2, '0')}`;

                                return (
                                  <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2.5 shadow-sm mt-2"
                                  >
                                    <div className="flex items-start gap-2.5">
                                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                      <div className="space-y-0.5 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-amber-300">Schedule Collision Detected</span>
                                          <span className="text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded uppercase">Conflict</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                                          Reel <strong className="text-amber-200">{formConflict.videoFileName}</strong> is already scheduled for this exact time ({formatReadableDateTime(scheduleDate, scheduleTime)}).
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-amber-500/20">
                                      <div className="text-[11px] text-zinc-400 font-mono">
                                        Suggested: <strong className="text-amber-300">{formatReadableDateTime(bufferedDateStr, bufferedTimeStr)}</strong> (+1h)
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setScheduleDate(bufferedDateStr);
                                          setScheduleTime(bufferedTimeStr);
                                          showNotification('success', 'Auto-rescheduled with 1-hour buffer (+1 hr)!');
                                        }}
                                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] rounded-lg transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                        Apply 1-Hour Buffer
                                      </button>
                                    </div>
                                  </motion.div>
                                );
                              })()}
                            </div>

                            <div>
                              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5">Launch Recurrence</label>
                              <select
                                value={scheduleRecurrence}
                                onChange={(e) => setScheduleRecurrence(e.target.value as any)}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50"
                              >
                                <option value="single">Single Launch</option>
                                <option value="daily">Daily Loop</option>
                                <option value="weekly">Weekly Loop</option>
                                <option value="monthly">Monthly Loop</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-mono uppercase text-zinc-400 mb-1.5 flex justify-between">
                                <span>Instagram Caption</span>
                                {selectedVideoForSchedule?.captionFileName && (
                                  <span className="text-[10px] text-blue-400 flex items-center gap-1 font-semibold">
                                    <FileText className="w-3 h-3" /> Auto-loaded from Drive txt
                                  </span>
                                )}
                              </label>
                              <textarea
                                value={customCaption}
                                onChange={(e) => setCustomCaption(e.target.value)}
                                rows={3}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50 leading-relaxed placeholder:text-zinc-600"
                                placeholder="Write description or edit loaded caption..."
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={actionLoading === 'create_schedule' || scheduleSuccess}
                              className={`w-full py-2.5 px-4 font-semibold rounded-lg transition-all duration-300 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                                scheduleSuccess
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 scale-[1.01]'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
                              }`}
                            >
                              {actionLoading === 'create_schedule' ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : scheduleSuccess ? (
                                <motion.span
                                  initial={{ scale: 0.8, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                  className="flex items-center justify-center gap-1.5"
                                >
                                  <Check className="w-4 h-4 text-white stroke-[3px]" />
                                  <span>Scheduled Successfully!</span>
                                </motion.span>
                              ) : (
                                <motion.span
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="flex items-center justify-center gap-1.5"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Launch and Schedule Reel</span>
                                </motion.span>
                              )}
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Upcoming Schedules List */}
                  <div className="lg:col-span-7 space-y-6">
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-display font-semibold text-zinc-100 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-blue-500" /> Upcoming Launch Schedule
                          </h3>
                          <button
                            onClick={() => setActiveTab('calendar')}
                            className="text-blue-400 hover:text-blue-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            Full Calendar View <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {dashboardStats?.upcomingSchedules && dashboardStats.upcomingSchedules.length === 0 ? (
                          <div className="py-12 text-center text-zinc-500 text-sm">
                            No upcoming schedules planned. Use the "Pilot a New Reel" form to map your reels.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {dashboardStats?.upcomingSchedules.map((item, idx) => {
                              const conflict = item.status === 'pending' ? findConflict(item.scheduledTime, item.id) : null;
                              return (
                                <div
                                  key={`${item.id}-${idx}`}
                                  className={`p-4 rounded-xl border transition flex flex-col gap-2.5 ${
                                    conflict 
                                      ? 'border-amber-500/40 bg-amber-500/5' 
                                      : 'border-zinc-800/80 bg-zinc-950/40'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="space-y-1.5 min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <Video className="w-4 h-4 text-blue-400 shrink-0" />
                                        <span className="text-xs font-mono text-zinc-300 truncate block font-semibold">{item.videoFileName}</span>
                                        {conflict && (
                                          <span className="text-[9px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                                            <AlertTriangle className="w-2.5 h-2.5" /> Conflict
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-zinc-500 truncate italic">
                                        "{item.captionText || 'No description'}"
                                      </p>
                                      <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
                                        <span className="flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> {new Date(item.scheduledTime).toLocaleString()}
                                        </span>
                                        <span>•</span>
                                        <span className="uppercase text-blue-400 bg-blue-500/10 px-1.5 py-0.2 rounded border border-blue-500/20 font-bold text-[9px]">{item.recurrence}</span>
                                        {item.status === 'failed' && (
                                          <>
                                            <span>•</span>
                                            <span className="uppercase text-red-400 bg-red-500/10 px-1.5 py-0.2 rounded border border-red-500/20 font-bold text-[9px]">Failed</span>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {item.status === 'failed' && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            retrySingleSchedule(item.id);
                                          }}
                                          disabled={actionLoading === `retry_${item.id}`}
                                          className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg border border-blue-500/30 transition shrink-0 cursor-pointer text-[10px] font-semibold flex items-center gap-1"
                                          title="Retry schedule"
                                        >
                                          <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === `retry_${item.id}` ? 'animate-spin' : ''}`} />
                                          <span className="hidden sm:inline">Retry</span>
                                        </button>
                                      )}

                                      {deletingScheduleId === item.id ? (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteScheduledPost(item.id, true);
                                            }}
                                            className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-500 rounded-lg transition cursor-pointer border border-red-500/30"
                                          >
                                            Confirm?
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setDeletingScheduleId(null);
                                            }}
                                            className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 bg-zinc-900 rounded-lg transition cursor-pointer border border-zinc-800"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteScheduledPost(item.id);
                                          }}
                                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-zinc-800/80 hover:border-red-500/30 transition shrink-0 cursor-pointer"
                                          title="Cancel scheduled post"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Inline conflict resolution prompt */}
                                  {conflict && (
                                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                                      <div className="text-[11px] text-amber-200 leading-snug">
                                        Conflicts with <strong className="text-amber-300">{conflict.videoFileName}</strong> at exact same time.
                                      </div>
                                      <button
                                        type="button"
                                        disabled={actionLoading === `auto_reschedule_${item.id}`}
                                        onClick={() => handleAutoRescheduleConflict(item.id, item.scheduledTime)}
                                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] rounded-md transition flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
                                      >
                                        {actionLoading === `auto_reschedule_${item.id}` ? (
                                          <RefreshCw className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Clock className="w-3 h-3" />
                                        )}
                                        Auto-Reschedule (+1 hr)
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 2. CALENDAR VIEW */}
            {activeTab === 'calendar' && (
              <CalendarTab
                schedules={schedules}
                driveVideos={syncedVideos}
                currentDate={currentCalendarDate}
                onDateChange={setCurrentCalendarDate}
                onUpdateScheduleTime={handleUpdateScheduleTime}
                onUpdateScheduleCaption={handleUpdateScheduleCaption}
                onResetToPending={handleResetToPending}
                onRetrySingleSchedule={retrySingleSchedule}
                onDeleteSchedule={deleteScheduledPost}
                onAutoResolveAllConflicts={handleAutoResolveAllConflicts}
                onAutoRescheduleConflict={handleAutoRescheduleConflict}
                onQuickScheduleVideo={handleQuickScheduleVideoFromCalendar}
                onPreviewVideo={setPreviewVideoModal}
                findConflict={findConflict}
                getSuggestedBufferedTime={getSuggestedBufferedTime}
                getConflictingSchedules={getConflictingSchedules}
                actionLoading={actionLoading}
                timezone={DEFAULT_TIMEZONE}
              />
            )}

            {/* 3. DRIVE SYNC TAB */}
            {activeTab === 'drive' && (
              <motion.div
                key="drive"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left panel: Folder Sync config */}
                  <div className="lg:col-span-4 space-y-6">
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                      <h3 className="font-display font-semibold text-lg text-zinc-100 flex items-center gap-2 mb-4">
                        <Folder className="w-5 h-5 text-blue-500" /> Folder Association
                      </h3>

                      <div className="space-y-4">
                        {driveAuthExpired && (
                          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <div className="text-xs text-amber-200">
                                <span className="font-semibold block mb-0.5">Google Drive Session Expired</span>
                                <span className="text-[11px] text-zinc-400">
                                  Your Google Drive authorization has expired or requires refreshed permissions.
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => reconnectGoogleDrive()}
                              disabled={authLoading}
                              className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${authLoading ? 'animate-spin' : ''}`} />
                              {authLoading ? 'Reconnecting...' : '⚡ Re-authenticate Google Drive'}
                            </button>
                          </div>
                        )}

                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Pilot reads files dynamically. Select the target folder inside your Google Drive. We'll scan and auto-pair matching video (e.g. <code>.mp4</code>) and caption (<code>.txt</code>) file couples.
                        </p>

                        {/* Token Diagnostics & Scopes Indicator */}
                        <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold flex items-center gap-1.5">
                              <ShieldCheck className="w-3 h-3 text-blue-400" /> OAuth Scopes & Token
                            </span>
                            <button
                              type="button"
                              onClick={fetchGoogleTokenInfo}
                              disabled={isCheckingTokenInfo}
                              className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className={`w-2.5 h-2.5 ${isCheckingTokenInfo ? 'animate-spin' : ''}`} /> Verify
                            </button>
                          </div>

                          {googleTokenInfo ? (
                            <div className="space-y-1.5 text-[11px]">
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-400 font-mono">Drive Access:</span>
                                {googleTokenInfo.hasDriveScope ? (
                                  <span className="text-emerald-400 font-bold font-mono flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Enabled (Full/Readonly)
                                  </span>
                                ) : (
                                  <span className="text-amber-400 font-bold font-mono flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> Missing Drive Scope
                                  </span>
                                )}
                              </div>
                              {googleTokenInfo.scopes && googleTokenInfo.scopes.length > 0 && (
                                <div className="pt-1">
                                  <span className="text-[9px] font-mono text-zinc-500 uppercase block mb-1">Active Scopes:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {googleTokenInfo.scopes.map((s, idx) => {
                                      const shortScope = s.replace('https://www.googleapis.com/auth/', '');
                                      return (
                                        <span key={idx} className="text-[9px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                                          {shortScope}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-[11px] text-zinc-500 font-mono">
                              Click Verify to inspect granted token permissions.
                            </p>
                          )}
                        </div>

                        <div className="pt-2 space-y-3">
                          <button
                            onClick={openGooglePicker}
                            disabled={actionLoading === 'opening_picker'}
                            className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-500/10 border border-blue-400/20"
                          >
                            <Sparkles className="w-4 h-4 text-blue-200 shrink-0" />
                            {actionLoading === 'opening_picker' ? 'Opening Picker...' : 'Browse with Google Picker'}
                          </button>

                          {/* Quick Connect by Folder Link or ID */}
                          <form onSubmit={handleConnectManualFolder} className="p-3 bg-zinc-950/50 border border-zinc-800/80 rounded-xl space-y-2">
                            <label className="block text-[10px] font-mono uppercase text-zinc-400 font-bold">
                              Or Paste Drive Folder Link / ID
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={manualFolderInput}
                                onChange={(e) => setManualFolderInput(e.target.value)}
                                placeholder="https://drive.google.com/drive/folders/... or Folder ID"
                                className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                type="submit"
                                disabled={!manualFolderInput.trim() || actionLoading === 'connect_folder'}
                                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition shrink-0 cursor-pointer"
                              >
                                Connect
                              </button>
                            </div>
                          </form>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-2.5">
                            <label className="block text-xs font-mono uppercase text-zinc-500">Your Google Drive Folders</label>
                            <button 
                              onClick={fetchGoogleFolders}
                              disabled={actionLoading === 'connect_folder'}
                              className="text-[10px] text-blue-400 hover:text-blue-300 transition font-mono uppercase flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Refresh Folders
                            </button>
                          </div>
                          {folders.length === 0 ? (
                            <div className="text-xs text-zinc-500 py-6 font-mono text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-950/20">
                              No folders returned. Ensure folders exist at your Drive root directory.
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                              {folders.map((fold, idx) => {
                                const isSelected = selectedFolder === fold.id;
                                return (
                                  <button
                                    key={`${fold.id}-${idx}`}
                                    onClick={() => {
                                      setSelectedFolder(fold.id);
                                      connectDriveFolder(fold.id);
                                    }}
                                    className={`w-full text-left p-3.5 rounded-xl border flex items-center justify-between transition-all duration-200 cursor-pointer group ${
                                      isSelected 
                                        ? 'bg-blue-600/10 border-blue-500 text-blue-200' 
                                        : 'bg-zinc-950/40 border-zinc-800/80 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-950/80'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <Folder className={`w-4.5 h-4.5 shrink-0 ${isSelected ? 'text-blue-400 animate-pulse' : 'text-zinc-500 group-hover:text-blue-400 transition-colors'}`} />
                                      <span className="text-sm font-medium truncate">{fold.name}</span>
                                    </div>
                                    {isSelected ? (
                                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-md border border-blue-500/30 font-bold">
                                        Connected
                                      </span>
                                    ) : (
                                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-zinc-900 text-zinc-500 rounded-md border border-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity">
                                        Select
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {driveConfig && (
                          <div className="p-4 bg-zinc-950/40 border border-zinc-800 rounded-xl space-y-2">
                            <span className="text-[10px] font-mono text-zinc-500 uppercase block">CONNECTED TARGET</span>
                            <h4 className="text-sm font-semibold text-zinc-200">{driveConfig.selectedFolderName}</h4>
                            <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                              <span>Last Synced:</span>
                              <span>{driveConfig.lastSyncedAt ? new Date(driveConfig.lastSyncedAt).toLocaleString() : 'Never'}</span>
                            </div>

                            <button
                              onClick={() => syncFolderFiles()}
                              disabled={actionLoading === 'sync_files'}
                              className="w-full mt-2 py-2 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-850 text-zinc-200 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'sync_files' ? 'animate-spin' : ''}`} />
                              Manually Sync Drive Now
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right panel: Synced Couples List */}
                  <div className="lg:col-span-8 space-y-6">
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 pb-4 border-b border-zinc-800">
                        <h3 className="font-display font-semibold text-lg text-zinc-100 flex items-center gap-2">
                          <HardDrive className="w-5 h-5 text-blue-500" /> Synced Reel Couples ({syncedVideos.length})
                        </h3>
                        {syncedVideos.length > 0 && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={toggleSelectAll}
                              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-[11px] rounded-lg transition flex items-center gap-1.5 cursor-pointer border border-zinc-700 font-sans"
                            >
                              {selectedVideoIds.length === syncedVideos.length ? (
                                <>Deselect All</>
                              ) : (
                                <>Select All ({syncedVideos.length})</>
                              )}
                            </button>
                            {selectedVideoIds.length > 0 && (
                              <span className="text-xs text-blue-400 font-semibold bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-md font-sans">
                                {selectedVideoIds.length} Selected
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Bulk Scheduling Config Panel */}
                      <AnimatePresence>
                        {selectedVideoIds.length > 0 && (
                          <motion.div
                            key="bulk-schedule-panel"
                            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                            animate={{ height: 'auto', opacity: 1, marginBottom: 24 }}
                            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                            className="overflow-hidden"
                          >
                            <form onSubmit={createBulkSchedule} className="p-5 rounded-xl border border-blue-500/30 bg-blue-950/10 space-y-4">
                              <div className="flex justify-between items-center pb-2 border-b border-blue-900/30">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-4 h-4 text-blue-400" />
                                  <h4 className="text-sm font-semibold text-zinc-100 font-sans">
                                    Bulk Schedule Selected ({selectedVideoIds.length} Reels)
                                  </h4>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedVideoIds([])}
                                  className="text-[11px] text-zinc-400 hover:text-zinc-200 font-sans font-medium cursor-pointer"
                                >
                                  Cancel Selection
                                </button>
                              </div>

                              <div className="col-span-1 md:col-span-2">
                                <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1.5 font-semibold flex justify-between items-center">
                                  <span>Bulk Launch Start Schedule</span>
                                  {bulkDate && bulkTime && (
                                    <span className="text-[10px] text-zinc-500 font-mono font-semibold">
                                      GMT-7 Pacific
                                    </span>
                                  )}
                                </label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const initialDate = bulkDate ? new Date(bulkDate + 'T00:00:00') : new Date();
                                    setPickerYearMonth(initialDate);
                                    setTempSelectedDate(bulkDate || formatYMD(new Date()));
                                    setTempSelectedTime(bulkTime || '10:00');
                                    setPickerTarget('bulk');
                                    setIsCustomPickerOpen(true);
                                  }}
                                  className="w-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-750 rounded-xl py-2.5 px-4 text-xs text-left flex items-center justify-between transition-all duration-200 cursor-pointer text-zinc-200 group"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <CalendarIcon className="w-4 h-4 text-blue-400 group-hover:text-blue-300 transition" />
                                    <span className="font-semibold tracking-wide">
                                      {bulkDate && bulkTime 
                                        ? formatReadableDateTime(bulkDate, bulkTime) 
                                        : 'Select start date and time to run bulk queue...'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400 transition font-mono uppercase font-semibold border border-zinc-800 group-hover:border-zinc-700 px-2 py-0.5 rounded">
                                    Setup
                                  </div>
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-sans">
                                <div>
                                  <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1.5 font-semibold">Recurrence</label>
                                  <select
                                    value={bulkRecurrence}
                                    onChange={(e: any) => setBulkRecurrence(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50 text-zinc-100 font-sans cursor-pointer"
                                  >
                                    <option value="single">Single Run</option>
                                    <option value="daily">Daily Run</option>
                                    <option value="weekly">Weekly Run</option>
                                    <option value="monthly">Monthly Run</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1.5 font-semibold">Schedule Spacing</label>
                                  <select
                                    value={bulkSpacing}
                                    onChange={(e: any) => setBulkSpacing(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50 text-zinc-100 font-sans cursor-pointer"
                                  >
                                    <option value="space_out">Space them out (sequential)</option>
                                    <option value="same_time">Same time (simultaneous)</option>
                                  </select>
                                </div>

                                {bulkSpacing === 'space_out' && (
                                  <div>
                                    <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1.5 font-semibold">Interval (Spacing)</label>
                                    <select
                                      value={bulkSpacingHours}
                                      onChange={(e) => setBulkSpacingHours(Number(e.target.value))}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50 text-zinc-100 font-sans cursor-pointer"
                                    >
                                      <option value={1}>Every 1 Hour</option>
                                      <option value={2}>Every 2 Hours</option>
                                      <option value={3}>Every 3 Hours</option>
                                      <option value={4}>Every 4 Hours</option>
                                      <option value={6}>Every 6 Hours</option>
                                      <option value={12}>Every 12 Hours</option>
                                      <option value={24}>Every 24 Hours (1 Day)</option>
                                      <option value={48}>Every 48 Hours (2 Days)</option>
                                      <option value={72}>Every 72 Hours (3 Days)</option>
                                      <option value={168}>Every 168 Hours (1 Week)</option>
                                    </select>
                                  </div>
                                )}
                              </div>

                              {bulkSpacing === 'space_out' && bulkDate && bulkTime && (
                                <div className="text-[11px] text-blue-400 bg-blue-950/30 border border-blue-900/30 rounded p-2.5 font-mono">
                                  <strong className="block mb-1.5 text-blue-300">Planned Queue Schedule:</strong>
                                  <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1">
                                    {selectedVideoIds.map((id, index) => {
                                      const vid = syncedVideos.find(v => v.id === id);
                                      if (!vid) return null;
                                      const time = new Date(new Date(`${bulkDate}T${bulkTime}:00`).getTime() + index * (bulkSpacingHours * 60 * 60 * 1000));
                                      return (
                                        <div key={`${id}-${index}`} className="flex justify-between items-center gap-2">
                                          <span className="truncate max-w-[65%]">{vid.name}</span>
                                          <span className="text-zinc-400 shrink-0">{time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <button
                                type="submit"
                                disabled={actionLoading === 'bulk_schedule'}
                                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 font-sans"
                              >
                                {actionLoading === 'bulk_schedule' ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5" />
                                )}
                                Confirm & Bulk Schedule {selectedVideoIds.length} Reels
                              </button>
                            </form>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {syncedVideos.length === 0 ? (
                        <div className="py-16 text-center text-zinc-500 text-sm font-sans">
                          {driveConfig ? 'Target folder selected, but no valid media pairs discovered.' : 'Please connect a Drive folder on the left panel to scan files.'}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {syncedVideos.map((video, idx) => (
                            <div
                              key={`${video.id}-${idx}`}
                              className={`p-5 rounded-xl border transition-all duration-200 bg-zinc-950/40 space-y-3 group ${
                                selectedVideoIds.includes(video.id)
                                  ? 'border-blue-500/60 bg-blue-950/10'
                                  : 'border-zinc-800/80 hover:border-zinc-700/80'
                              }`}
                            >
                              <div className="flex justify-between items-start gap-4">
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  {/* Custom Checkbox */}
                                  <button
                                    type="button"
                                    onClick={() => toggleSelectVideo(video.id)}
                                    className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition shrink-0 mt-3 ${
                                      selectedVideoIds.includes(video.id)
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'
                                    }`}
                                  >
                                    {selectedVideoIds.includes(video.id) && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                  </button>

                                  {/* Video Thumbnail Preview from Google Drive API */}
                                  <VideoThumbnail
                                    video={video}
                                    onPreviewClick={(vid) => setPreviewVideoModal(vid)}
                                    size="md"
                                  />

                                  <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <h4 
                                        onClick={() => setPreviewVideoModal(video)}
                                        className="text-xs font-semibold font-mono text-zinc-200 flex items-center gap-1.5 truncate cursor-pointer hover:text-blue-400 transition-colors"
                                      >
                                        <Video className="w-4 h-4 text-blue-400 shrink-0" /> {video.name}
                                      </h4>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                      <span>Drive ID: {video.id}</span>
                                      {video.size && (
                                        <>
                                          <span>•</span>
                                          <span>{(Number(video.size) / (1024 * 1024)).toFixed(1)} MB</span>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setPreviewVideoModal(video)}
                                        className="text-blue-400/80 hover:text-blue-300 ml-1 underline cursor-pointer"
                                      >
                                        View details
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedVideoForSchedule(video);
                                    setCustomCaption(video.captionText || '');
                                    setActiveTab('dashboard');
                                  }}
                                  className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-[11px] rounded-lg transition flex items-center gap-1 shrink-0 cursor-pointer border border-zinc-700"
                                >
                                  <Plus className="w-3 h-3" /> Schedule Reel
                                </button>
                              </div>

                              <div className="border-t border-zinc-850 pt-2.5 pl-8 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1 uppercase font-semibold">
                                    <FileText className="w-3.5 h-3.5 text-zinc-400" /> Caption Block: {video.captionFileName || 'Missing .txt file (Fallback: Blank)'}
                                    {video.isTweaked && (
                                      <span className="ml-2 text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30 uppercase tracking-wider animate-pulse">
                                        Tweaked
                                      </span>
                                    )}
                                  </span>
                                  {editingCaptionVideoId !== video.id && (
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditCaption(video.id, video.captionText || '')}
                                      className="text-[10px] font-mono text-zinc-400 hover:text-blue-400 flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-none py-0.5 px-1.5 rounded hover:bg-zinc-800/40"
                                      title="Tweak caption inline"
                                    >
                                      <Edit2 className="w-3 h-3" /> Tweak Caption
                                    </button>
                                  )}
                                </div>
                                
                                {editingCaptionVideoId === video.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={editingCaptionText}
                                      onChange={(e) => setEditingCaptionText(e.target.value)}
                                      placeholder="Enter your custom caption here..."
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-100 font-sans leading-relaxed focus:outline-none focus:border-blue-500/50 resize-y min-h-[100px]"
                                      autoFocus
                                    />
                                    <div className="flex justify-between items-center text-xs">
                                      <button
                                        type="button"
                                        disabled={isGeneratingCaption}
                                        onClick={() => handleGenerateCaptionWithAI(video.name)}
                                        className="py-1 px-3 bg-indigo-600/15 hover:bg-indigo-600/20 text-indigo-400 font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer text-[11px] border border-indigo-500/30 disabled:opacity-50"
                                      >
                                        {isGeneratingCaption ? (
                                          <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                            <span>Generating...</span>
                                          </>
                                        ) : (
                                          <>
                                            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                            <span>Generate with AI</span>
                                          </>
                                        )}
                                      </button>
                                      
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCaptionVideoId(null);
                                            setEditingCaptionText('');
                                          }}
                                          className="py-1 px-2.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded-lg transition flex items-center gap-1 cursor-pointer text-[11px] border border-zinc-800"
                                        >
                                          <X className="w-3.5 h-3.5" /> Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveCaption(video.id)}
                                          className="py-1 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition flex items-center gap-1 font-semibold cursor-pointer text-[11px] border border-blue-500/20 shadow-sm"
                                        >
                                          <Check className="w-3.5 h-3.5" /> Save Tweaks
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="bg-zinc-950 p-2.5 rounded border border-zinc-900 text-xs text-zinc-300 leading-relaxed font-sans max-h-[80px] overflow-y-auto whitespace-pre-wrap">
                                    {video.captionText || <span className="text-zinc-600 italic">No matching txt caption file detected. Create one with name matching your video.</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 4. META & INTEGRATION SETTINGS TAB */}
            {activeTab === 'meta' && (
              <motion.div
                key="meta"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                {/* Google Cloud Console Credentials Settings Card */}
                <form onSubmit={saveGoogleOAuthSettings} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 space-y-4" id="google_oauth_credentials_form">
                  <div className="border-b border-zinc-800/80 pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                          <HardDrive className="w-3 h-3 text-blue-400" />
                        </div>
                        <h3 className="font-display font-semibold text-base text-zinc-100">Google Cloud OAuth Credentials</h3>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Manage the Google Cloud Client ID & Secret used for Drive API syncing and login.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {googleOAuthStatus?.isCustom ? (
                        <span className="text-[10px] font-mono text-emerald-400 uppercase bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-bold">
                          Custom Saved in DB
                        </span>
                      ) : googleOAuthStatus?.configured ? (
                        <span className="text-[10px] font-mono text-blue-400 uppercase bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20 font-bold">
                          Default / Env Active
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-amber-400 uppercase bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20 font-bold">
                          Needs Configuration
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Google Client ID</label>
                      <input
                        type="text"
                        value={googleOAuthForm.clientId}
                        onChange={(e) => setGoogleOAuthForm({ ...googleOAuthForm, clientId: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-blue-500/50 text-zinc-200"
                        placeholder="e.g. 1060377033502-xxx.apps.googleusercontent.com"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Google Client Secret</label>
                      <input
                        type="password"
                        value={googleOAuthForm.clientSecret}
                        onChange={(e) => setGoogleOAuthForm({ ...googleOAuthForm, clientSecret: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-blue-500/50 text-zinc-200"
                        placeholder={googleOAuthStatus?.clientSecretMasked ? `Current: ${googleOAuthStatus.clientSecretMasked}` : 'e.g. GOCSPX-xxx'}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-1">
                    <p className="text-[11px] text-zinc-500">
                      From Google Cloud Console &rarr; <strong>APIs & Services</strong> &rarr; <strong>Credentials</strong> &rarr; OAuth 2.0 Client IDs.
                    </p>
                    <button
                      type="submit"
                      disabled={isSavingGoogleOAuth}
                      className="py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-lg transition disabled:opacity-40 cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0"
                    >
                      {isSavingGoogleOAuth ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Save Google Credentials
                    </button>
                  </div>
                </form>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: Config inputs */}
                  <div className="lg:col-span-7 space-y-6">
                    <form onSubmit={saveMetaSettings} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 space-y-4">
                      <div className="border-b border-zinc-800/80 pb-3 flex justify-between items-center">
                        <div>
                          <h3 className="font-display font-semibold text-lg text-zinc-100">Meta Graph Connection</h3>
                          <p className="text-xs text-zinc-400">Configure your official Meta Developers App secrets manually.</p>
                        </div>
                        <span className="text-[10px] font-mono text-blue-400 uppercase bg-blue-400/10 px-2 py-0.5 rounded border border-blue-500/20 font-bold">NO OAUTH NEEDED</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Meta App ID</label>
                          <input
                            type="text"
                            value={metaForm.appId}
                            onChange={(e) => setMetaForm({ ...metaForm, appId: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Meta App Secret</label>
                          <input
                            type="password"
                            value={metaForm.appSecret}
                            onChange={(e) => setMetaForm({ ...metaForm, appSecret: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500/50"
                            placeholder={metaForm.appSecret ? '••••••••••••••••' : ''}
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Long-lived Access Token</label>
                        <textarea
                          rows={2}
                          value={metaForm.accessToken}
                          onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50 placeholder:text-zinc-700"
                          placeholder="Your official system-user long lived page access token..."
                          required
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Instagram Business Account ID</label>
                          <input
                            type="text"
                            value={metaForm.instagramBusinessAccountId}
                            onChange={(e) => setMetaForm({ ...metaForm, instagramBusinessAccountId: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Facebook Page ID</label>
                          <input
                            type="text"
                            value={metaForm.facebookPageId}
                            onChange={(e) => setMetaForm({ ...metaForm, facebookPageId: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Graph API Version</label>
                          <input
                            type="text"
                            value={metaForm.graphApiVersion}
                            onChange={(e) => setMetaForm({ ...metaForm, graphApiVersion: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Business Portfolio ID (Optional)</label>
                          <input
                            type="text"
                            value={metaForm.businessPortfolioId}
                            onChange={(e) => setMetaForm({ ...metaForm, businessPortfolioId: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Webhook Verify Token (Optional)</label>
                          <input
                            type="text"
                            value={metaForm.webhookVerifyToken}
                            onChange={(e) => setMetaForm({ ...metaForm, webhookVerifyToken: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">App Mode</label>
                            <select
                              value={metaForm.appMode}
                              onChange={(e) => setMetaForm({ ...metaForm, appMode: e.target.value as any })}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none"
                            >
                              <option value="sandbox">Sandbox</option>
                              <option value="live">Live</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Environment</label>
                            <select
                              value={metaForm.environment}
                              onChange={(e) => setMetaForm({ ...metaForm, environment: e.target.value as any })}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none"
                            >
                              <option value="development">Dev</option>
                              <option value="production">Prod</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-mono uppercase text-zinc-400 mb-1">Video Source</label>
                            <select
                              value={metaForm.videoDeliveryMode}
                              onChange={(e) => setMetaForm({ ...metaForm, videoDeliveryMode: e.target.value as any })}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 px-3 text-sm focus:outline-none font-semibold text-blue-400"
                            >
                              <option value="proxy">Direct Stream (Proxy)</option>
                              <option value="litterbox">Litterbox CDN</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-zinc-800 flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={actionLoading === 'save_meta'}
                          className="flex-1 min-w-[120px] py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {actionLoading === 'save_meta' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Save Settings
                        </button>

                        <button
                          type="button"
                          onClick={verifyMeta}
                          disabled={!metaConfigured || actionLoading !== null}
                          className="flex-1 min-w-[120px] py-2.5 px-4 border border-zinc-800 hover:bg-zinc-900 text-zinc-200 font-semibold text-xs rounded-lg transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {actionLoading === 'verify_meta' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5 text-zinc-400" />}
                          Verify Connection
                        </button>

                        <button
                          type="button"
                          onClick={refreshToken}
                          disabled={!metaConfigured || actionLoading !== null}
                          className="flex-1 min-w-[120px] py-2.5 px-4 border border-zinc-800 hover:bg-zinc-900 text-zinc-200 font-semibold text-xs rounded-lg transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                          title="Refresh to generate 60-day token"
                        >
                          {actionLoading === 'refresh_meta_token' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />}
                          Refresh Token
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Right Column: Verification logs & instructions */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Verification output */}
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 space-y-4">
                      <h3 className="font-display font-semibold text-zinc-100">Meta Connection State</h3>

                      {actionLoading === 'verify_meta' ? (
                        <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                          <span>Polling Meta Graph endpoints...</span>
                        </div>
                      ) : metaVerifyResult ? (
                        metaVerifyResult.success ? (
                          <div className="space-y-4">
                            <div className="p-4 bg-green-950/20 border border-green-500/20 text-green-300 rounded-xl flex items-center gap-3">
                              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                              <div className="text-xs">
                                <p className="font-bold">Verified Connected!</p>
                                <p className="text-green-400/80">Meta Graph API verified and returned successfully.</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 p-3 bg-zinc-950/40 rounded-xl border border-zinc-800">
                              {metaVerifyResult.profilePictureUrl ? (
                                <img src={metaVerifyResult.profilePictureUrl} alt={metaVerifyResult.name} className="w-12 h-12 rounded-full border border-zinc-800" />
                              ) : (
                                <div className="w-12 h-12 bg-zinc-850 rounded-full flex items-center justify-center">
                                  <Instagram className="w-6 h-6 text-zinc-500" />
                                </div>
                              )}
                              <div>
                                <h4 className="text-sm font-semibold text-zinc-200">{metaVerifyResult.name}</h4>
                                <p className="text-xs text-blue-400 font-mono">@{metaVerifyResult.username}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="p-4 bg-red-950/20 border border-red-500/20 text-red-300 rounded-xl flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                              <div className="text-xs">
                                <p className="font-bold">Meta API Handshake Failed</p>
                                <p className="text-red-400/80 leading-relaxed mt-1">{metaVerifyResult.error}</p>
                              </div>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="py-12 text-center text-zinc-500 text-xs italic font-mono">
                          Click "Verify Connection" on the form to check credentials. No mock feedback provided.
                        </div>
                      )}
                    </div>

                    {/* Meta developers instruction box */}
                    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/10 text-xs text-zinc-400 space-y-2 leading-relaxed">
                      <h4 className="font-semibold text-zinc-300 flex items-center gap-1.5">
                        <Sliders className="w-4 h-4 text-blue-500" /> Meta Developer Manual Credentials
                      </h4>
                      <p>To acquire valid secrets, follow these official Meta configurations:</p>
                      <ul className="list-decimal list-inside space-y-1.5 pl-1 text-zinc-400 mt-2">
                        <li>Register a Meta Developer App as type <strong>Business</strong>.</li>
                        <li>Integrate the <strong>Instagram Graph API</strong> product.</li>
                        <li>Acquire a long-lived page access token with <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>pages_show_list</code>, and <code>pages_read_engagement</code>.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 5. LOGS TAB */}
            {activeTab === 'logs' && (
              <motion.div
                key="logs"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-4 mb-4">
                    <div>
                      <h3 className="font-display font-semibold text-lg text-zinc-100">Background Worker Audit Logs</h3>
                      <p className="text-xs text-zinc-400">Track raw API handshakes, sync schedules, and direct publisher feedback loop.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await pingWorker();
                        }}
                        disabled={actionLoading === 'ping_worker'}
                        className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 hover:text-white font-semibold text-xs rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'ping_worker' ? 'animate-spin text-blue-400' : ''}`} />
                        Ping Worker
                      </button>

                      <button
                        onClick={async () => {
                          await syncFolderFiles(false);
                          await retryAllFailed();
                        }}
                        disabled={actionLoading === 'sync_files' || actionLoading === 'retry_failed'}
                        className="py-1.5 px-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 hover:text-blue-200 font-semibold text-xs rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'sync_files' || actionLoading === 'retry_failed' ? 'animate-spin' : ''}`} />
                        Re-Sync Drive & Retry
                      </button>

                      {confirmClearLogs ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => clearAllLogs(true)}
                            className="py-1.5 px-3 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded-lg transition cursor-pointer"
                          >
                            Confirm Clear
                          </button>
                          <button
                            onClick={() => setConfirmClearLogs(false)}
                            className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-xs rounded-lg transition cursor-pointer border border-zinc-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => clearAllLogs(false)}
                          disabled={logs.length === 0 || actionLoading === 'clear_logs'}
                          className="py-1.5 px-3 border border-red-500/30 hover:bg-red-500/10 text-red-400 hover:text-red-300 font-semibold text-xs rounded-lg transition disabled:opacity-40 cursor-pointer"
                        >
                          Clear Audit History
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Log Category Filters */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-3 border-b border-zinc-800/60 text-xs">
                    <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[10px] shrink-0 mr-1">Filter:</span>
                    {[
                      { id: 'all', label: 'All Logs', count: logs.length },
                      { id: 'WORKER_HEALTH', label: 'System Health', count: logs.filter(l => l.action === 'WORKER_HEALTH').length },
                      { id: 'PUBLISH_REEL', label: 'Reel Publishing', count: logs.filter(l => l.action.includes('PUBLISH') || l.action.includes('CONTAINER') || l.action.includes('SCHEDULER')).length },
                      { id: 'SYNC_DRIVE', label: 'Drive Sync', count: logs.filter(l => l.action.includes('DRIVE') || l.action.includes('SYNC')).length },
                      { id: 'META_VERIFY', label: 'Meta API', count: logs.filter(l => l.action.includes('META')).length },
                      { id: 'errors', label: 'Errors Only', count: logs.filter(l => l.status === 'error').length }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setLogFilter(f.id as any)}
                        className={`px-2.5 py-1 rounded-lg font-medium text-xs transition shrink-0 flex items-center gap-1.5 cursor-pointer ${
                          logFilter === f.id
                            ? 'bg-blue-600/30 border border-blue-500/50 text-blue-200'
                            : 'bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <span>{f.label}</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                          logFilter === f.id ? 'bg-blue-500/40 text-blue-100' : 'bg-zinc-700/60 text-zinc-400'
                        }`}>
                          {f.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {logs.length === 0 ? (
                    <div className="py-16 text-center text-zinc-500 text-sm font-mono">
                      Audit history is clean. Run Drive syncs or schedules to populate logs.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                      {logs
                        .filter(log => {
                          if (logFilter === 'all') return true;
                          if (logFilter === 'errors') return log.status === 'error';
                          if (logFilter === 'WORKER_HEALTH') return log.action === 'WORKER_HEALTH';
                          if (logFilter === 'PUBLISH_REEL') return log.action.includes('PUBLISH') || log.action.includes('CONTAINER') || log.action.includes('SCHEDULER');
                          if (logFilter === 'SYNC_DRIVE') return log.action.includes('DRIVE') || log.action.includes('SYNC');
                          if (logFilter === 'META_VERIFY') return log.action.includes('META');
                          return true;
                        })
                        .map((log, idx) => {
                          const isErr = log.status === 'error';
                          const isSucc = log.status === 'success';
                          const isHealth = log.action === 'WORKER_HEALTH';

                          return (
                            <div
                              key={`${log.id}-${idx}`}
                              className={`p-4 rounded-xl border text-xs space-y-2 transition duration-150 ${
                                isErr 
                                  ? 'bg-red-950/10 border-red-500/15 text-red-200' 
                                  : isHealth
                                    ? 'bg-blue-950/10 border-blue-500/20 text-blue-200'
                                    : isSucc 
                                      ? 'bg-green-950/10 border-green-500/15 text-green-200' 
                                      : 'bg-zinc-950/40 border-zinc-850 text-zinc-300'
                              }`}
                            >
                              <div className="flex flex-wrap justify-between gap-2 items-center font-mono text-[10px] text-zinc-400">
                                <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 flex items-center gap-1.5 font-semibold">
                                  {isErr ? (
                                    <XCircle className="w-3 h-3 text-red-400" />
                                  ) : isHealth ? (
                                    <Activity className="w-3 h-3 text-blue-400" />
                                  ) : isSucc ? (
                                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                                  ) : (
                                    <Clock className="w-3 h-3 text-zinc-500" />
                                  )}
                                  {log.action}
                                </span>
                                <span>{new Date(log.timestamp).toLocaleString()}</span>
                              </div>

                              {log.videoFileName && (
                                <p className="font-semibold text-zinc-200 flex items-center gap-1 font-mono text-[11px]">
                                  <Video className="w-3.5 h-3.5 text-blue-400" /> {log.videoFileName}
                                </p>
                              )}

                              {log.apiRequest && (
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono text-zinc-500 block">RAW API REQUEST:</span>
                                  <pre className="p-2 bg-zinc-950 rounded border border-zinc-900 overflow-x-auto text-[10px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap">
                                    {log.apiRequest}
                                  </pre>
                                </div>
                              )}

                              {log.apiResponse && (
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono text-zinc-500 block">
                                    {isHealth ? 'SYSTEM HEALTH TELEMETRY / HEARTBEAT:' : 'RAW API RESPONSE / PAYLOAD:'}
                                  </span>
                                  <pre className="p-2.5 bg-zinc-950 rounded border border-zinc-900 overflow-x-auto text-[11px] leading-relaxed text-zinc-200 font-mono whitespace-pre-wrap">
                                    {log.apiResponse}
                                  </pre>
                                </div>
                              )}

                              {log.errorMessage && (
                                <div className="p-2.5 bg-red-950/30 border border-red-500/20 text-red-300 rounded-lg text-[11px] font-mono whitespace-pre-wrap leading-relaxed space-y-2">
                                  <div>{log.errorMessage}</div>
                                  <div className="pt-1 flex items-center gap-2 font-sans">
                                    <button
                                      onClick={async () => {
                                        await syncFolderFiles(false);
                                        await retryAllFailed();
                                      }}
                                      className="px-2.5 py-1 bg-red-600/30 hover:bg-red-600/40 border border-red-500/40 text-red-200 text-[10px] font-semibold rounded-md transition flex items-center gap-1 cursor-pointer"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      Re-Sync Drive & Retry Post
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Custom low-effort Date & Time Picker Modal */}
        <AnimatePresence>
          {isCustomPickerOpen && (
            <motion.div
              key="custom-picker-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.95, y: 15 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 15 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-[620px] w-full shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans"
                >
                  {/* Side-by-side Calendar & Time Columns */}
                  <div className="flex flex-col sm:flex-row h-[420px] sm:h-[400px]">
                    {/* Calendar Area (Left Column) */}
                    <div className="flex-1 p-5 border-b sm:border-b-0 sm:border-r border-zinc-800 flex flex-col justify-between">
                      <div>
                        {/* Month Year Header */}
                        <div className="flex items-center justify-between mb-4 px-1">
                          <button
                            type="button"
                            onClick={() => handlePickerMonthChange(-1)}
                            className="w-8 h-8 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center transition cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4 text-zinc-400 hover:text-zinc-200" />
                          </button>
                          
                          <span className="font-display font-semibold text-zinc-200 text-sm tracking-wide">
                            {PICKER_MONTHS[pickerYearMonth.getMonth()]} {pickerYearMonth.getFullYear()}
                          </span>
                          
                          <button
                            type="button"
                            onClick={() => handlePickerMonthChange(1)}
                            className="w-8 h-8 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center transition cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4 text-zinc-400 hover:text-zinc-200" />
                          </button>
                        </div>

                        {/* Weekday Labels (Monday First) */}
                        <div className="grid grid-cols-7 gap-1 text-center font-mono text-[11px] text-zinc-500 font-bold mb-2">
                          <span>Mo</span>
                          <span>Tu</span>
                          <span>We</span>
                          <span>Th</span>
                          <span>Fr</span>
                          <span>Sa</span>
                          <span>Su</span>
                        </div>

                        {/* Days Grid */}
                        <div className="grid grid-cols-7 gap-1">
                          {getCustomPickerDays(pickerYearMonth).map((day, idx) => {
                            const ymd = formatYMD(day.date);
                            const isSelected = tempSelectedDate === ymd;
                            const isCurrMonth = day.isCurrentMonth;
                            const hasPost = hasSchedulesOnDate(day.date);
                            
                            return (
                              <button
                                key={`${ymd}-${idx}`}
                                type="button"
                                onClick={() => setTempSelectedDate(ymd)}
                                className={`relative aspect-square flex flex-col items-center justify-center text-xs rounded-xl transition-all duration-150 cursor-pointer ${
                                  isSelected 
                                    ? 'bg-zinc-100 text-zinc-950 font-bold scale-[1.05] shadow-md border border-zinc-100'
                                    : isCurrMonth
                                      ? 'text-zinc-200 hover:bg-zinc-850 hover:text-white'
                                      : 'text-zinc-600 hover:bg-zinc-850/50'
                                }`}
                              >
                                <span>{day.date.getDate()}</span>
                                {hasPost && !isSelected && (
                                  <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Scrollable Time Area (Right Column) */}
                    <div className="w-full sm:w-56 p-5 flex flex-col justify-between">
                      <div className="flex flex-col h-full">
                        <div className="text-[10px] font-mono font-bold tracking-widest text-zinc-500 uppercase mb-2.5 text-center sm:text-left flex items-center justify-between">
                          <span>SELECT TIME</span>
                          <span className="text-[10px] text-blue-400 font-mono font-semibold">CUSTOM / PRESETS</span>
                        </div>

                        {/* Custom Exact Time Input Box */}
                        <div className="mb-3 bg-zinc-950 border border-zinc-800 focus-within:border-blue-500/80 rounded-xl p-2.5 transition-colors shadow-inner">
                          <label className="text-[10px] font-mono uppercase text-zinc-400 block mb-1 font-semibold">
                            Custom Exact Time
                          </label>
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                            <input
                              type="time"
                              value={tempSelectedTime || '10:00'}
                              onChange={(e) => setTempSelectedTime(e.target.value)}
                              className="bg-transparent text-zinc-100 text-xs font-mono font-bold outline-none w-full cursor-pointer [color-scheme:dark]"
                            />
                            {tempSelectedTime && (
                              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 shrink-0">
                                {(() => {
                                  const [h, m] = (tempSelectedTime || '10:00').split(':').map(Number);
                                  if (isNaN(h)) return '';
                                  const h12 = h % 12 === 0 ? 12 : h % 12;
                                  const ampm = h < 12 ? 'AM' : 'PM';
                                  const mStr = String(isNaN(m) ? 0 : m).padStart(2, '0');
                                  return `${h12}:${mStr} ${ampm}`;
                                })()}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] font-mono font-semibold text-zinc-500 uppercase mb-1.5 px-0.5">
                          Quick Presets
                        </div>

                        <div 
                          className="flex-1 overflow-y-auto max-h-[170px] sm:max-h-[180px] pr-1 space-y-1 scrollbar-thin scrollbar-thumb-zinc-800" 
                          id="custom-time-picker-scroll"
                        >
                          {(() => {
                            const slots = [];
                            for (let h = 0; h < 24; h++) {
                              for (const m of [0, 15, 30, 45]) {
                                const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                                
                                const hour12 = h % 12 === 0 ? 12 : h % 12;
                                const ampm = h < 12 ? 'AM' : 'PM';
                                const mStr = String(m).padStart(2, '0');
                                const lbl = `${hour12}:${mStr} ${ampm}`;
                                
                                slots.push({ val, lbl });
                              }
                            }
                            return slots.map(({ val, lbl }, sIdx) => {
                              const isSelected = tempSelectedTime === val;
                              return (
                                <button
                                  key={`slot-${val}-${sIdx}`}
                                  type="button"
                                  onClick={() => setTempSelectedTime(val)}
                                  className={`w-full text-center py-1.5 text-xs font-medium rounded-lg transition-all duration-150 cursor-pointer ${
                                    isSelected
                                      ? 'bg-zinc-100 text-zinc-950 font-bold shadow-md border border-zinc-100 scale-[1.02]'
                                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                                  }`}
                                >
                                  {lbl}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Conflict detection prompt inside Custom DateTime Picker */}
                  {(() => {
                    if (!tempSelectedDate || !tempSelectedTime) return null;
                    const pickerTimeMs = new Date(`${tempSelectedDate}T${tempSelectedTime}:00`).getTime();
                    if (isNaN(pickerTimeMs)) return null;
                    const conflict = findConflict(pickerTimeMs);
                    if (!conflict) return null;
                    const suggestedTimeMs = getSuggestedBufferedTime(pickerTimeMs);
                    const suggestedDate = new Date(suggestedTimeMs);
                    const suggestedDateStr = formatYMD(suggestedDate);
                    const suggestedTimeStr = `${String(suggestedDate.getHours()).padStart(2, '0')}:${String(suggestedDate.getMinutes()).padStart(2, '0')}`;

                    return (
                      <div className="bg-amber-950/40 border-t border-amber-500/30 px-4 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-sans">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="text-amber-200 text-[11px] truncate">
                            Conflicts with <strong className="text-amber-300">{conflict.videoFileName}</strong> at this exact time.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTempSelectedDate(suggestedDateStr);
                            setTempSelectedTime(suggestedTimeStr);
                            showNotification('success', 'Applied 1-hour buffer (+1h)!');
                          }}
                          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] rounded-lg transition flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Clock className="w-3 h-3" /> Apply 1-Hour Buffer (+1h)
                        </button>
                      </div>
                    );
                  })()}

                  {/* Footer Bar (Cancel, Formatted Date/Time display, Schedule button) */}
                  <div className="bg-zinc-950/60 border-t border-zinc-800/80 p-4 flex items-center justify-between gap-4 font-sans">
                    <button
                      type="button"
                      onClick={() => setIsCustomPickerOpen(false)}
                      className="py-2 px-4 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 rounded-xl transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    
                    <div className="px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950 text-xs font-medium text-zinc-200 tracking-wide shadow-inner flex items-center gap-1.5 font-sans">
                      <Clock className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{getFormattedBottomLabel(tempSelectedDate, tempSelectedTime)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (pickerTarget === 'single') {
                          setScheduleDate(tempSelectedDate);
                          setScheduleTime(tempSelectedTime);
                        } else {
                          setBulkDate(tempSelectedDate);
                          setBulkTime(tempSelectedTime);
                        }
                        setIsCustomPickerOpen(false);
                        showNotification('success', 'Launch schedule updated.');
                      }}
                      className="py-2 px-5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-900/10 active:scale-95 transition cursor-pointer"
                    >
                      Schedule
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Video Thumbnail Preview & Details Modal */}
          <AnimatePresence>
            {previewVideoModal && (
              <VideoPreviewModal
                key={`preview-modal-${previewVideoModal.id}`}
                video={previewVideoModal}
                onClose={() => setPreviewVideoModal(null)}
                onScheduleClick={(vid) => {
                  setSelectedVideoForSchedule(vid);
                  setCustomCaption(vid.captionText || '');
                  setActiveTab('dashboard');
                }}
              />
            )}
          </AnimatePresence>
      </main>
    </div>
  );
}

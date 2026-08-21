export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiry: number; // timestamp in ms
  createdAt: number;
}

export interface MetaConfig {
  appId: string;
  appSecret: string;
  accessToken: string; // Long-lived access token
  instagramBusinessAccountId: string;
  facebookPageId: string;
  graphApiVersion: string;
  businessPortfolioId?: string;
  webhookVerifyToken?: string;
  appMode: 'sandbox' | 'live';
  environment: 'development' | 'production';
  videoDeliveryMode?: 'litterbox' | 'proxy' | 'auto';
  updatedAt: number;
}

export interface DriveFolderConfig {
  selectedFolderId: string;
  selectedFolderName: string;
  lastSyncedAt?: number;
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

export interface Schedule {
  id: string;
  videoFileId: string;
  videoFileName: string;
  captionFileId?: string;
  captionFileName?: string;
  captionText: string;
  scheduledTime: number; // timestamp in ms
  timezone: string;
  recurrence: 'single' | 'daily' | 'weekly' | 'monthly';
  status: 'pending' | 'published' | 'failed' | 'publishing';
  retryCount: number;
  errorMessage?: string;
  instagramPostId?: string;
  createdAt: number;
  publishedAt?: number;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  videoFileName?: string;
  instagramAccount?: string;
  action: string; // e.g. "SYNC_DRIVE", "META_VERIFY", "PUBLISH_REEL", "SCHEDULER_RUN"
  status: 'info' | 'success' | 'error';
  statusCode?: number;
  apiRequest?: string; // summary of API requests
  apiResponse?: string; // summary of API response or error
  errorMessage?: string;
}

export interface MetaRateLimitInfo {
  appCallCount: number;
  appCpuTime: number;
  appTotalTime: number;
  businessCallCount: number;
  businessCpuTime: number;
  businessTotalTime: number;
  estimatedTimeToRegainAccess: number;
  updatedAt: number;
}

export interface SystemHealth {
  lastCheckedAt: number | null;
  lastCheckedStatus: 'healthy' | 'error' | 'idle' | 'running';
  lastApiError: {
    message: string;
    timestamp: number;
    action?: string;
    statusCode?: number;
    details?: string;
  } | null;
  isWorkerRunning: boolean;
  runningSince: number | null;
  workerIntervalSeconds: number;
  metaConnected: boolean;
  googleConnected: boolean;
  healthStatus: 'healthy' | 'warning' | 'error' | 'idle';
  pendingDueCount: number;
  totalPending: number;
  totalPublished: number;
  totalFailed: number;
  lastSuccessfulPublishAt: number | null;
}

export interface DashboardStats {
  googleConnected: boolean;
  metaConnected: boolean;
  selectedFolderName: string;
  videosAvailableCount: number;
  scheduledCount: number;
  publishedTodayCount: number;
  publishedThisWeekCount: number;
  failedCount: number;
  upcomingSchedules: Schedule[];
  rateLimits?: MetaRateLimitInfo | null;
  systemHealth?: SystemHealth;
}

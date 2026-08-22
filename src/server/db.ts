import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { User, MetaConfig, DriveFolderConfig, Schedule, AuditLog, MetaRateLimitInfo, SystemHealth } from '../types.js';

const DB_FILE = path.join(process.cwd(), 'db.json');
const ALGORITHM = 'aes-256-cbc';
// Generate a secure 32-byte key from our encryption secret
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'reelpilot-default-secret-key-2026-saas-platform';
const SECRET_KEY = crypto.scryptSync(ENCRYPTION_SECRET, 'reelpilot-salt', 32);
const IV_LENGTH = 16;

// Encryption helpers
export function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(text: string): string {
  if (!text) return '';
  try {
    const parts = text.split(':');
    if (parts.length < 2) return '';
    const iv = Buffer.from(parts.shift() || '', 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(encryptedText).toString('utf8');
    decrypted += decipher.final().toString('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed, returning raw string or empty:', err);
    return text; // fallback
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  updatedAt: number;
}

interface DatabaseSchema {
  users: User[];
  metaConfig: MetaConfig | null;
  googleOAuthConfig?: GoogleOAuthConfig | null;
  driveFolderConfig: DriveFolderConfig | null;
  schedules: Schedule[];
  logs: AuditLog[];
  appUrl?: string | null;
  rateLimits?: MetaRateLimitInfo | null;
  systemHealth?: Partial<SystemHealth> | null;
}

const defaultDb: DatabaseSchema = {
  users: [],
  metaConfig: null,
  googleOAuthConfig: null,
  driveFolderConfig: null,
  schedules: [],
  logs: [],
  appUrl: null,
  rateLimits: null,
  systemHealth: null
};

// Low-level read/write
function getDbFilePath(): string {
  if (process.env.VERCEL) {
    const tmpPath = path.join('/tmp', 'db.json');
    if (!fs.existsSync(tmpPath)) {
      const rootPath = path.join(process.cwd(), 'db.json');
      if (fs.existsSync(rootPath)) {
        try {
          fs.copyFileSync(rootPath, tmpPath);
        } catch (e) {
          console.error('Failed to copy root db.json to /tmp:', e);
        }
      }
    }
    return tmpPath;
  }
  return DB_FILE;
}

function readDb(): DatabaseSchema {
  try {
    const dbFile = getDbFilePath();
    if (!fs.existsSync(dbFile)) {
      try {
        fs.writeFileSync(dbFile, JSON.stringify(defaultDb, null, 2), 'utf8');
      } catch (writeErr) {
        console.error('ReadOnly DB file system, using defaultDb in memory:', writeErr);
      }
      return defaultDb;
    }
    const raw = fs.readFileSync(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultDb, ...parsed };
  } catch (err) {
    console.error('Failed to read db.json, returning defaults:', err);
    return defaultDb;
  }
}

function writeDb(data: DatabaseSchema) {
  try {
    const dbFile = getDbFilePath();
    const tempFile = `${dbFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, dbFile);
  } catch (err) {
    console.error('Failed to write db.json:', err);
    // Fallback: try writing directly without atomic temp file rename if temp file failed
    try {
      const dbFile = getDbFilePath();
      fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (directErr) {
      console.error('Direct writeDb fallback failed:', directErr);
    }
  }
}

// User CRUD
export function getUsers(): User[] {
  const db = readDb();
  return db.users.map(u => ({
    ...u,
    googleAccessToken: decrypt(u.googleAccessToken),
    googleRefreshToken: decrypt(u.googleRefreshToken)
  }));
}

export function saveUser(user: User): void {
  const db = readDb();
  const encryptedUser = {
    ...user,
    googleAccessToken: encrypt(user.googleAccessToken),
    googleRefreshToken: encrypt(user.googleRefreshToken)
  };
  const idx = db.users.findIndex(u => u.id === user.id);
  if (idx >= 0) {
    db.users[idx] = encryptedUser;
  } else {
    db.users.push(encryptedUser);
  }
  writeDb(db);
}

export function getAllGoogleUsers(): User[] {
  const users = getUsers();
  return users.filter(u => !!u.googleRefreshToken || !!u.googleAccessToken);
}

export function getFirstUser(): User | null {
  const users = getUsers();
  if (users.length === 0) return null;
  
  const db = readDb();
  // 1. If driveFolderConfig has a specific userId attached, prioritize that user
  if (db.driveFolderConfig && (db.driveFolderConfig as any).userId) {
    const matched = users.find(u => u.id === (db.driveFolderConfig as any).userId && (!!u.googleRefreshToken || !!u.googleAccessToken));
    if (matched) return matched;
  }

  // 2. Prioritize user with refresh token, ordered by newest created or token expiry
  const withRefreshToken = users
    .filter(u => !!u.googleRefreshToken)
    .sort((a, b) => (b.createdAt || b.googleTokenExpiry || 0) - (a.createdAt || a.googleTokenExpiry || 0));

  if (withRefreshToken.length > 0) return withRefreshToken[0];

  const withAccessToken = users
    .filter(u => !!u.googleAccessToken)
    .sort((a, b) => (b.createdAt || b.googleTokenExpiry || 0) - (a.createdAt || a.googleTokenExpiry || 0));

  if (withAccessToken.length > 0) return withAccessToken[0];

  return users[0];
}

// MetaConfig CRUD
export function getMetaConfig(): MetaConfig | null {
  const db = readDb();
  if (!db.metaConfig) return null;
  return {
    ...db.metaConfig,
    appId: decrypt(db.metaConfig.appId),
    appSecret: decrypt(db.metaConfig.appSecret),
    accessToken: decrypt(db.metaConfig.accessToken)
  };
}

export function saveMetaConfig(config: MetaConfig): void {
  const db = readDb();
  db.metaConfig = {
    ...config,
    appId: encrypt(config.appId),
    appSecret: encrypt(config.appSecret),
    accessToken: encrypt(config.accessToken)
  };
  writeDb(db);
}

// GoogleOAuthConfig CRUD
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const db = readDb();
  if (!db.googleOAuthConfig) return null;
  return {
    ...db.googleOAuthConfig,
    clientId: decrypt(db.googleOAuthConfig.clientId),
    clientSecret: decrypt(db.googleOAuthConfig.clientSecret)
  };
}

export function saveGoogleOAuthConfig(config: GoogleOAuthConfig): void {
  const db = readDb();
  const cleanId = (config.clientId || '').trim().replace(/^["']|["']$/g, '');
  const cleanSecret = (config.clientSecret || '').trim().replace(/^["']|["']$/g, '');
  db.googleOAuthConfig = {
    ...config,
    clientId: encrypt(cleanId),
    clientSecret: encrypt(cleanSecret)
  };
  writeDb(db);
}

// DriveFolderConfig CRUD
export function getDriveFolderConfig(): DriveFolderConfig | null {
  const db = readDb();
  return db.driveFolderConfig;
}

export function saveDriveFolderConfig(config: DriveFolderConfig): void {
  const db = readDb();
  db.driveFolderConfig = config;
  writeDb(db);
}

// Schedules CRUD
export function getSchedules(): Schedule[] {
  const db = readDb();
  return db.schedules || [];
}

export function saveSchedule(schedule: Schedule): void {
  const db = readDb();
  const idx = db.schedules.findIndex(s => s.id === schedule.id);
  if (idx >= 0) {
    db.schedules[idx] = schedule;
  } else {
    db.schedules.push(schedule);
  }
  writeDb(db);
}

export function deleteSchedule(id: string): boolean {
  const db = readDb();
  const initialLength = db.schedules.length;
  db.schedules = db.schedules.filter(s => s.id !== id);
  if (db.schedules.length !== initialLength) {
    writeDb(db);
    return true;
  }
  return false;
}

// Logs CRUD
export function addLog(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
  const db = readDb();
  const newLog: AuditLog = {
    ...log,
    id: crypto.randomUUID(),
    timestamp: Date.now()
  };
  db.logs = db.logs || [];
  db.logs.unshift(newLog); // newer first
  // Cap logs at 500 to save space
  if (db.logs.length > 500) {
    db.logs = db.logs.slice(0, 500);
  }
  writeDb(db);
  return newLog;
}

export function getLogs(): AuditLog[] {
  const db = readDb();
  return db.logs || [];
}

export function clearLogs(): void {
  const db = readDb();
  db.logs = [];
  writeDb(db);
}

export function getAppUrl(): string | null {
  const db = readDb();
  return db.appUrl || null;
}

export function saveAppUrl(url: string): void {
  const db = readDb();
  db.appUrl = url;
  writeDb(db);
}

export function getRateLimits(): MetaRateLimitInfo | null {
  const db = readDb();
  return db.rateLimits || null;
}

export function saveRateLimits(rateLimits: MetaRateLimitInfo): void {
  const db = readDb();
  db.rateLimits = rateLimits;
  writeDb(db);
}

export function getSystemHealthRecord(): Partial<SystemHealth> {
  const db = readDb();
  return db.systemHealth || {};
}

export function saveSystemHealthRecord(health: Partial<SystemHealth>): void {
  const db = readDb();
  db.systemHealth = {
    ...(db.systemHealth || {}),
    ...health
  };
  writeDb(db);
}

export function recordApiError(errData: {
  message: string;
  action?: string;
  statusCode?: number;
  details?: string;
}): void {
  const db = readDb();
  const errorObj = {
    message: errData.message,
    timestamp: Date.now(),
    action: errData.action,
    statusCode: errData.statusCode,
    details: errData.details
  };
  
  db.systemHealth = {
    ...(db.systemHealth || {}),
    lastApiError: errorObj,
    healthStatus: 'error'
  };
  writeDb(db);
}

export function clearApiError(): void {
  const db = readDb();
  if (db.systemHealth) {
    db.systemHealth.lastApiError = null;
    db.systemHealth.healthStatus = 'healthy';
    writeDb(db);
  }
}


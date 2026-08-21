import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RotateCcw, 
  History, 
  RefreshCw, 
  Clock, 
  Server, 
  ShieldCheck, 
  ShieldAlert,
  Zap,
  Info,
  Check,
  X
} from 'lucide-react';
import { SystemHealth } from '../types.js';

interface SystemHealthWidgetProps {
  systemHealth?: SystemHealth | null;
  onPingWorker: () => Promise<void>;
  onResetWorker: () => Promise<void>;
  onClearError: () => Promise<void>;
  onViewLogs: () => void;
  onRetryFailed: () => Promise<void>;
  isActionLoading: string | null;
}

export function SystemHealthWidget({
  systemHealth,
  onPingWorker,
  onResetWorker,
  onClearError,
  onViewLogs,
  onRetryFailed,
  isActionLoading
}: SystemHealthWidgetProps) {
  const [now, setNow] = useState<number>(Date.now());

  // Update relative timestamps every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const formatRelativeTime = (timestamp?: number | null) => {
    if (!timestamp) return 'Never';
    const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const isRunning = !!systemHealth?.isWorkerRunning;
  const lastCheckedAt = systemHealth?.lastCheckedAt;
  const lastApiError = systemHealth?.lastApiError;
  const healthStatus = systemHealth?.healthStatus || 'healthy';

  const getStatusBadge = () => {
    switch (healthStatus) {
      case 'healthy':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-semibold rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            System Healthy & Active
          </div>
        );
      case 'warning':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-semibold rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Warning / Retries Active
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs font-semibold rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            API Error Flagged
          </div>
        );
      case 'idle':
      default:
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-xs font-semibold rounded-full">
            <span className="w-2 h-2 rounded-full bg-zinc-500" />
            Standby Mode
          </div>
        );
    }
  };

  return (
    <div id="system-health-widget" className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-xs p-5 sm:p-6 space-y-5 transition-all">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Activity className="w-4 h-4" />
            </div>
            <h3 className="font-display font-semibold text-base sm:text-lg text-zinc-100 flex items-center gap-2">
              System Health & Background Worker
            </h3>
            {getStatusBadge()}
          </div>
          <p className="text-xs text-zinc-400">
            Real-time telemetry, Meta Graph API status, and background scheduling monitor.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap self-stretch sm:self-auto justify-end">
          <button
            id="btn-ping-worker"
            onClick={onPingWorker}
            disabled={isActionLoading === 'ping_worker'}
            className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 hover:text-blue-200 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Trigger an instant check and record a health heartbeat"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isActionLoading === 'ping_worker' ? 'animate-spin text-blue-400' : ''}`} />
            <span>Ping Worker</span>
          </button>

          {isRunning && (
            <button
              id="btn-reset-worker"
              onClick={onResetWorker}
              disabled={isActionLoading === 'reset_worker'}
              className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 hover:text-amber-200 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Reset background worker concurrency lock"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isActionLoading === 'reset_worker' ? 'animate-spin' : ''}`} />
              <span>Reset Lock</span>
            </button>
          )}

          <button
            id="btn-view-health-logs"
            onClick={onViewLogs}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs font-medium rounded-lg transition flex items-center gap-1.5 cursor-pointer"
          >
            <History className="w-3.5 h-3.5 text-zinc-400" />
            <span>View Logs</span>
          </button>
        </div>
      </div>

      {/* Main Diagnostic Telemetry Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Last Checked & Worker State */}
        <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-850 space-y-2.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-400 font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              Last Checked At
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              {formatRelativeTime(lastCheckedAt)}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-lg font-mono font-semibold text-zinc-100">
              {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never checked'}
            </span>
          </div>

          <div className="pt-1 text-[11px] text-zinc-400 flex items-center gap-1.5 border-t border-zinc-800/60">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-blue-400 animate-pulse' : 'bg-emerald-400'}`} />
            <span>
              {isRunning 
                ? `Worker actively publishing (PID running)` 
                : `Worker idle (runs automatically every 60s)`}
            </span>
          </div>
        </div>

        {/* Card 2: Integration Connections */}
        <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-850 space-y-2.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-400 font-medium flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              API Connectivity
            </span>
            <span className="text-[10px] uppercase font-mono text-zinc-500 font-semibold">
              Live Status
            </span>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Google Drive:</span>
              <span className={`font-medium flex items-center gap-1 ${systemHealth?.googleConnected ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {systemHealth?.googleConnected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {systemHealth?.googleConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Meta Graph API:</span>
              <span className={`font-medium flex items-center gap-1 ${systemHealth?.metaConnected ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {systemHealth?.metaConnected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {systemHealth?.metaConnected ? 'Configured' : 'Not Configured'}
              </span>
            </div>
          </div>

          <div className="pt-1 text-[11px] text-zinc-500 flex items-center gap-1.5 border-t border-zinc-800/60">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Direct Binary Resumable Upload Enabled</span>
          </div>
        </div>

        {/* Card 3: Queue & Hang Prevention */}
        <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-850 space-y-2.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-400 font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Queue & Publication
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              {systemHealth?.pendingDueCount || 0} Due Now
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-lg font-mono font-semibold text-zinc-100">
              {systemHealth?.totalPublished || 0}
            </span>
            <span className="text-xs text-zinc-500">total published</span>
            {systemHealth?.totalFailed && systemHealth.totalFailed > 0 ? (
              <span className="text-xs text-rose-400 ml-auto font-mono">
                ({systemHealth.totalFailed} errors)
              </span>
            ) : null}
          </div>

          <div className="pt-1 text-[11px] text-zinc-400 flex items-center gap-1.5 border-t border-zinc-800/60 truncate">
            <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="truncate">
              Last Publish: {formatRelativeTime(systemHealth?.lastSuccessfulPublishAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Last API Error Banner (if error exists) */}
      {lastApiError ? (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/30 text-rose-200 space-y-2 transition-all">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-rose-300">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Last API Error</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-900/40 border border-rose-500/30 text-rose-300">
                {lastApiError.action}
              </span>
              <span className="text-[11px] font-mono text-rose-400/80">
                • {formatRelativeTime(lastApiError.timestamp)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onRetryFailed}
                disabled={isActionLoading === 'retry_failed'}
                className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/40 border border-rose-500/40 text-rose-100 text-[11px] font-semibold rounded-md transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isActionLoading === 'retry_failed' ? 'animate-spin' : ''}`} />
                Retry Due Reels
              </button>
              <button
                onClick={onClearError}
                className="p-1 text-rose-400 hover:text-rose-200 rounded hover:bg-rose-900/30 transition cursor-pointer"
                title="Dismiss error notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="text-xs font-mono bg-rose-950/40 border border-rose-900/40 p-2.5 rounded-lg text-rose-300 leading-relaxed break-words">
            {lastApiError.message}
          </div>

          {lastApiError.details && (
            <p className="text-[11px] text-rose-400/80 font-mono">
              Target: {lastApiError.details}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-zinc-950/30 border border-zinc-850/60 text-zinc-400 text-xs font-mono">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Meta Graph API & Google Drive background handshakes are clear. No pending exceptions.</span>
          </div>
          <span className="text-[10px] text-zinc-600 hidden sm:inline">
            Watchdog loop interval: 60s
          </span>
        </div>
      )}
    </div>
  );
}

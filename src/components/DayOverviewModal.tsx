import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Edit2,
  Trash2,
  Plus,
  Play,
  X,
  ExternalLink,
  ChevronRight,
  Filter,
  Flame,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Schedule, DriveVideoItem } from '../types.js';
import { VideoThumbnail } from './VideoThumbnail.js';

interface DayOverviewModalProps {
  date: Date | null;
  schedules: Schedule[];
  driveVideos: DriveVideoItem[];
  isOpen?: boolean;
  onClose: () => void;
  onOpenScheduleDetail: (schedule: Schedule) => void;
  onOpenQuickSchedule: (date: Date) => void;
  onPreviewVideo?: (video: DriveVideoItem) => void;
  onAutoRescheduleConflict: (id: string, currentScheduledTime: number) => Promise<void>;
  onResetToPending?: (id: string) => Promise<void>;
  onRetrySingleSchedule: (id: string) => Promise<void>;
  onDeleteSchedule: (id: string, confirmed?: boolean) => Promise<void>;
  findConflict: (targetTimeMs: number, excludeId?: string) => Schedule | null;
  getSuggestedBufferedTime?: (targetTimeMs: number, excludeId?: string) => number;
  actionLoading: string | null;
  timezone?: string;
}

export function DayOverviewModal({
  date,
  schedules,
  driveVideos,
  isOpen = Boolean(date),
  onClose,
  onOpenScheduleDetail,
  onOpenQuickSchedule,
  onPreviewVideo,
  onAutoRescheduleConflict,
  onResetToPending,
  onRetrySingleSchedule,
  onDeleteSchedule,
  findConflict,
  getSuggestedBufferedTime,
  actionLoading,
  timezone = 'America/New_York'
}: DayOverviewModalProps) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'published' | 'failed' | 'conflict'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen || !date) return null;

  const cellDateStr = date.toDateString();
  const todayStr = new Date().toDateString();
  const isToday = cellDateStr === todayStr;

  // Filter schedules for this specific day
  const daySchedules = schedules
    .filter(s => new Date(s.scheduledTime).toDateString() === cellDateStr)
    .sort((a, b) => a.scheduledTime - b.scheduledTime);

  const publishedCount = daySchedules.filter(s => s.status === 'published').length;
  const pendingCount = daySchedules.filter(s => s.status === 'pending' || s.status === 'publishing').length;
  const failedCount = daySchedules.filter(s => s.status === 'failed').length;
  const conflictCount = daySchedules.filter(s => s.status === 'pending' && findConflict(s.scheduledTime, s.id) !== null).length;

  const displayedSchedules = daySchedules.filter(s => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'published') return s.status === 'published';
    if (filterStatus === 'pending') return s.status === 'pending' || s.status === 'publishing';
    if (filterStatus === 'failed') return s.status === 'failed';
    if (filterStatus === 'conflict') return s.status === 'pending' && findConflict(s.scheduledTime, s.id) !== null;
    return true;
  });

  const formattedFullDate = date.toLocaleDateString('default', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/85 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="max-w-2xl w-full max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/40 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-semibold uppercase px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                <CalendarIcon className="w-3 h-3" />
                Day Breakdown
              </span>
              {isToday && (
                <span className="text-xs font-mono font-bold uppercase px-2.5 py-0.5 rounded-full bg-blue-600 text-white shadow-xs">
                  Today
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-display font-bold text-zinc-100">
              {formattedFullDate}
            </h2>
            <p className="text-xs text-zinc-400 font-mono">
              Total of <strong className="text-zinc-200">{daySchedules.length}</strong> {daySchedules.length === 1 ? 'reel' : 'reels'} scheduled for this date
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenQuickSchedule(date)}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Schedule a new reel for this day"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Schedule Reel</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 bg-zinc-950 border-b border-zinc-850">
          <button
            onClick={() => setFilterStatus(filterStatus === 'all' ? 'all' : 'all')}
            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-zinc-900 border-zinc-700 text-zinc-100'
                : 'bg-zinc-950 border-zinc-850/80 text-zinc-400 hover:bg-zinc-900/50'
            }`}
          >
            <span className="text-[10px] font-mono uppercase text-zinc-500 block">Total Scheduled</span>
            <div className="text-lg font-bold font-mono text-zinc-100 mt-0.5">{daySchedules.length}</div>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === 'published' ? 'all' : 'published')}
            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
              filterStatus === 'published'
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                : 'bg-zinc-950 border-zinc-850/80 text-zinc-400 hover:bg-zinc-900/50'
            }`}
          >
            <span className="text-[10px] font-mono uppercase text-emerald-400/80 block">Published</span>
            <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">{publishedCount}</div>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending')}
            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
              filterStatus === 'pending'
                ? 'bg-blue-950/40 border-blue-500/50 text-blue-200'
                : 'bg-zinc-950 border-zinc-850/80 text-zinc-400 hover:bg-zinc-900/50'
            }`}
          >
            <span className="text-[10px] font-mono uppercase text-blue-400/80 block">Upcoming / Pending</span>
            <div className="text-lg font-bold font-mono text-blue-400 mt-0.5">{pendingCount}</div>
          </button>

          <button
            onClick={() => setFilterStatus(filterStatus === 'failed' ? 'all' : 'failed')}
            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
              filterStatus === 'failed'
                ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                : 'bg-zinc-950 border-zinc-850/80 text-zinc-400 hover:bg-zinc-900/50'
            }`}
          >
            <span className="text-[10px] font-mono uppercase text-rose-400/80 block">Failed / Retry</span>
            <div className="text-lg font-bold font-mono text-rose-400 mt-0.5">{failedCount}</div>
          </button>
        </div>

        {/* Scrollable Scheduled Video Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          {displayedSchedules.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800/80 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mx-auto text-zinc-500">
                <Video className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">
                  {daySchedules.length === 0
                    ? `No reels scheduled for ${formattedFullDate}`
                    : `No reels match the selected filter (${filterStatus})`}
                </h4>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                  {daySchedules.length === 0
                    ? 'Pick any video from your synchronized Drive library to queue up an Instagram Reel for this date.'
                    : 'Switch your filter tab above to view all scheduled items for this date.'}
                </p>
              </div>
              {daySchedules.length === 0 && (
                <button
                  onClick={() => onOpenQuickSchedule(date)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow inline-flex items-center gap-1.5 cursor-pointer mt-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Schedule First Reel for this Day</span>
                </button>
              )}
            </div>
          ) : (
            displayedSchedules.map((sch) => {
              const isPub = sch.status === 'published';
              const isFailed = sch.status === 'failed';
              const isPubing = sch.status === 'publishing';
              const hasConflict = sch.status === 'pending' && findConflict(sch.scheduledTime, sch.id) !== null;
              const matchingDriveVideo = driveVideos.find(v => v.id === sch.videoFileId || v.name === sch.videoFileName);

              return (
                <div
                  key={`day-overview-${sch.id}`}
                  className={`p-4 rounded-2xl border transition-all space-y-3 ${
                    hasConflict
                      ? 'bg-amber-950/20 border-amber-500/40'
                      : isPub
                        ? 'bg-emerald-950/15 border-emerald-500/30'
                        : isFailed
                          ? 'bg-rose-950/20 border-rose-500/30'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  {/* Top Bar: Time, Status, Recurrence */}
                  <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 font-mono font-bold text-xs flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(sch.scheduledTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      <span className="text-[10px] font-mono uppercase text-zinc-500">
                        ({sch.recurrence})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasConflict && (
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Clashing Time
                        </span>
                      )}
                      <span className={`text-[10px] font-mono font-semibold uppercase px-2.5 py-0.5 rounded-md border ${
                        isPub
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : isFailed
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                            : isPubing
                              ? 'bg-amber-500/20 border-amber-500/30 text-amber-300 animate-pulse'
                              : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                      }`}>
                        {sch.status}
                      </span>
                    </div>
                  </div>

                  {/* Video & Thumbnail Details */}
                  <div className="flex items-start gap-3.5">
                    {matchingDriveVideo ? (
                      <VideoThumbnail
                        video={matchingDriveVideo}
                        onPreviewClick={onPreviewVideo}
                        size="md"
                      />
                    ) : (
                      <div className="w-16 h-12 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
                        <Video className="w-5 h-5 text-zinc-500" />
                      </div>
                    )}

                    <div className="space-y-1 min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-zinc-100 font-mono truncate">
                        {sch.videoFileName}
                      </h4>
                      {sch.captionText ? (
                        <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed bg-zinc-950/50 p-2 rounded-xl border border-zinc-850">
                          {sch.captionText}
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-500 italic">No caption provided.</p>
                      )}

                      {sch.errorMessage && (
                        <div className="p-2.5 bg-rose-950/30 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span className="font-mono text-[11px] leading-relaxed">{sch.errorMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons Toolbar */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/60 flex-wrap">
                    {hasConflict && (
                      <button
                        onClick={() => onAutoRescheduleConflict(sch.id, sch.scheduledTime)}
                        disabled={actionLoading === `auto_reschedule_${sch.id}`}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        title="Shift time by 1 hour"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Buffer +1h</span>
                      </button>
                    )}

                    {isFailed && (
                      <button
                        onClick={() => onRetrySingleSchedule(sch.id)}
                        disabled={actionLoading === `retry_${sch.id}`}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === `retry_${sch.id}` ? 'animate-spin' : ''}`} />
                        <span>Retry</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        onClose();
                        onOpenScheduleDetail(sch);
                      }}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer border border-zinc-700"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Edit / Reschedule</span>
                    </button>

                    {deletingId === sch.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            onDeleteSchedule(sch.id, true);
                            setDeletingId(null);
                          }}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-2.5 py-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs rounded-xl cursor-pointer"
                        >
                          Back
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(sch.id)}
                        className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
                        title="Cancel this schedule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-900/50 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-mono">
            Timezone: {timezone}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition cursor-pointer border border-zinc-700"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}

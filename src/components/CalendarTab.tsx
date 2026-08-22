import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Video,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  Grid,
  Columns,
  ListFilter,
  ExternalLink,
  Edit2,
  Trash2,
  Play,
  Share2,
  CalendarDays,
  Flame,
  Check,
  X,
  Layers,
  ArrowRight,
  Eye
} from 'lucide-react';
import { Schedule, DriveVideoItem } from '../types.js';
import { VideoThumbnail } from './VideoThumbnail.js';
import { DayOverviewModal } from './DayOverviewModal.js';

interface CalendarTabProps {
  schedules: Schedule[];
  driveVideos: DriveVideoItem[];
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onUpdateScheduleTime: (id: string, newTimeMs: number) => Promise<void>;
  onUpdateScheduleCaption?: (id: string, caption: string) => Promise<void>;
  onResetToPending: (id: string) => Promise<void>;
  onRetrySingleSchedule: (id: string) => Promise<void>;
  onDeleteSchedule: (id: string, confirmed?: boolean) => Promise<void>;
  onAutoResolveAllConflicts: () => Promise<void>;
  onAutoRescheduleConflict: (id: string, currentScheduledTime: number) => Promise<void>;
  onQuickScheduleVideo: (video: DriveVideoItem, scheduledTimeMs: number, caption: string) => Promise<void>;
  onPreviewVideo: (video: DriveVideoItem) => void;
  findConflict: (targetTimeMs: number, excludeId?: string) => Schedule | null;
  getSuggestedBufferedTime: (targetTimeMs: number, excludeId?: string) => number;
  getConflictingSchedules: () => Schedule[];
  actionLoading: string | null;
  timezone?: string;
}

type CalendarViewMode = 'month' | 'week' | 'agenda';
type StatusFilter = 'all' | 'pending' | 'published' | 'failed' | 'conflict';

export function CalendarTab({
  schedules,
  driveVideos,
  currentDate,
  onDateChange,
  onUpdateScheduleTime,
  onUpdateScheduleCaption,
  onResetToPending,
  onRetrySingleSchedule,
  onDeleteSchedule,
  onAutoResolveAllConflicts,
  onAutoRescheduleConflict,
  onQuickScheduleVideo,
  onPreviewVideo,
  findConflict,
  getSuggestedBufferedTime,
  getConflictingSchedules,
  actionLoading,
  timezone = 'America/New_York'
}: CalendarTabProps) {
  // Calendar View Mode
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selected Detail Modal
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [editDateStr, setEditDateStr] = useState('');
  const [editTimeStr, setEditTimeStr] = useState('');
  const [editCaption, setEditCaption] = useState('');

  // Selected Day Breakdown Modal
  const [selectedDayOverview, setSelectedDayOverview] = useState<Date | null>(null);

  // Quick Schedule Modal for a specific date cell
  const [quickScheduleDate, setQuickScheduleDate] = useState<Date | null>(null);
  const [quickSelectedVideo, setQuickSelectedVideo] = useState<DriveVideoItem | null>(null);
  const [quickScheduleTime, setQuickScheduleTime] = useState('10:00');
  const [quickCaption, setQuickCaption] = useState('');
  const [quickVideoSearch, setQuickVideoSearch] = useState('');

  // Drag and drop state
  const [draggedScheduleId, setDraggedScheduleId] = useState<string | null>(null);
  const [dragOverDateStr, setDragOverDateStr] = useState<string | null>(null);

  // Deletion confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Selected schedule detail sync
  const handleOpenDetail = (sch: Schedule) => {
    setSelectedSchedule(sch);
    setIsEditingSchedule(false);
    setConfirmDeleteId(null);
    const d = new Date(sch.scheduledTime);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    setEditDateStr(`${y}-${m}-${day}`);
    setEditTimeStr(`${hh}:${mm}`);
    setEditCaption(sch.captionText || '');
  };

  // Filtered schedules based on search and status
  const filteredSchedules = useMemo(() => {
    return schedules.filter(sch => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = sch.videoFileName?.toLowerCase().includes(q);
        const matchCap = sch.captionText?.toLowerCase().includes(q);
        const matchId = sch.instagramPostId?.toLowerCase().includes(q);
        if (!matchName && !matchCap && !matchId) return false;
      }

      // Status filter
      if (statusFilter === 'all') return true;
      if (statusFilter === 'published') return sch.status === 'published';
      if (statusFilter === 'failed') return sch.status === 'failed';
      if (statusFilter === 'pending') return sch.status === 'pending';
      if (statusFilter === 'conflict') {
        return sch.status === 'pending' && findConflict(sch.scheduledTime, sch.id) !== null;
      }
      return true;
    });
  }, [schedules, searchQuery, statusFilter, findConflict]);

  // Calendar Conflicts
  const pendingConflicts = useMemo(() => getConflictingSchedules(), [schedules, getConflictingSchedules]);

  // Navigation handlers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setMonth(next.getMonth() - 1);
    }
    onDateChange(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    onDateChange(next);
  };

  const handleToday = () => {
    onDateChange(new Date());
  };

  // Month days computation (Sunday through Saturday)
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
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

    // Next month padding to fill 35 or 42 cells cleanly
    const totalCells = days.length <= 35 ? 35 : 42;
    const nextMonthPadding = totalCells - days.length;
    for (let i = 1; i <= nextMonthPadding; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }

    return days;
  }, [currentDate]);

  // Week days computation (7 days centered around currentDate)
  const weekDays = useMemo(() => {
    const d = new Date(currentDate);
    const dayOfWeek = d.getDay(); // 0 is Sunday
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(startOfWeek);
      dayDate.setDate(startOfWeek.getDate() + i);
      days.push(dayDate);
    }
    return days;
  }, [currentDate]);

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggedScheduleId(id);
  };

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDateStr(dateStr);
  };

  const handleDragLeave = () => {
    setDragOverDateStr(null);
  };

  const handleDropOnDate = async (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    setDragOverDateStr(null);
    const id = e.dataTransfer.getData('text/plain') || draggedScheduleId;
    setDraggedScheduleId(null);
    if (!id) return;

    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;
    if (schedule.status === 'published' || schedule.status === 'publishing') return;

    const origDate = new Date(schedule.scheduledTime);
    const newDateTime = new Date(targetDate);
    newDateTime.setHours(origDate.getHours(), origDate.getMinutes(), 0, 0);

    // Apply conflict check & update
    const conflict = findConflict(newDateTime.getTime(), id);
    if (conflict) {
      const buffered = getSuggestedBufferedTime(newDateTime.getTime(), id);
      await onUpdateScheduleTime(id, buffered);
    } else {
      await onUpdateScheduleTime(id, newDateTime.getTime());
    }
  };

  // Quick Schedule Form Submit
  const handleQuickScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSelectedVideo || !quickScheduleDate || !quickScheduleTime) return;

    const [hh, mm] = quickScheduleTime.split(':').map(Number);
    const targetDate = new Date(quickScheduleDate);
    targetDate.setHours(hh || 10, mm || 0, 0, 0);

    await onQuickScheduleVideo(
      quickSelectedVideo,
      targetDate.getTime(),
      quickCaption || quickSelectedVideo.captionText || ''
    );

    setQuickScheduleDate(null);
    setQuickSelectedVideo(null);
    setQuickCaption('');
  };

  // Edit Schedule Submit inside Detail Modal
  const handleSaveEditSchedule = async () => {
    if (!selectedSchedule || !editDateStr || !editTimeStr) return;

    const [y, m, d] = editDateStr.split('-').map(Number);
    const [hh, mm] = editTimeStr.split(':').map(Number);
    const targetDate = new Date(y, m - 1, d, hh, mm, 0, 0);

    if (isNaN(targetDate.getTime())) return;

    await onUpdateScheduleTime(selectedSchedule.id, targetDate.getTime());
    if (onUpdateScheduleCaption && editCaption !== selectedSchedule.captionText) {
      await onUpdateScheduleCaption(selectedSchedule.id, editCaption);
    }

    setIsEditingSchedule(false);
    setSelectedSchedule(prev => prev ? {
      ...prev,
      scheduledTime: targetDate.getTime(),
      captionText: editCaption
    } : null);
  };

  const isToday = (d: Date) => {
    const today = new Date();
    return d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
  };

  return (
    <motion.div
      key="calendar-tab-root"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="space-y-6"
    >
      {/* 1. Global Calendar Conflicts Banner */}
      {pendingConflicts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                Launch Collision Detected
                <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                  {pendingConflicts.length} {pendingConflicts.length === 1 ? 'reel' : 'reels'} with overlapping times
                </span>
              </h4>
              <p className="text-xs text-zinc-300 mt-0.5">
                Multiple pending reels share the exact same scheduled timestamp. Space them out with recommended 1-hour buffers.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={actionLoading === 'auto_resolve_all'}
            onClick={onAutoResolveAllConflicts}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 disabled:opacity-50 text-zinc-950 font-bold text-xs rounded-xl transition shadow flex items-center gap-2 cursor-pointer shrink-0"
          >
            {actionLoading === 'auto_resolve_all' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Auto-Resolve All with 1-Hour Buffer
          </button>
        </motion.div>
      )}

      {/* 2. Top Controls & View Mode Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 bg-zinc-900/60 border border-zinc-800/80 p-4 sm:p-5 rounded-2xl backdrop-blur-xs">
        {/* Left: Date Navigation & Title */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <h2 className="text-lg sm:text-xl font-display font-semibold text-zinc-100 min-w-[180px]">
              {viewMode === 'week' ? (
                <span>
                  {weekDays[0].toLocaleDateString('default', { month: 'short', day: 'numeric' })} –{' '}
                  {weekDays[6].toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              ) : (
                currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })
              )}
            </h2>
          </div>

          <div className="flex items-center gap-1 border border-zinc-800 bg-zinc-950 p-1 rounded-xl shadow-inner">
            <button
              onClick={handlePrev}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-900 transition cursor-pointer"
              title="Previous period"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleToday}
              className="px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 rounded-lg font-medium transition font-mono cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-900 transition cursor-pointer"
              title="Next period"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Today Quick Schedule Peek Button */}
          {(() => {
            const todayStr = new Date().toDateString();
            const todayCount = schedules.filter(s => new Date(s.scheduledTime).toDateString() === todayStr).length;
            const nextPending = schedules
              .filter(s => s.status === 'pending' || s.status === 'failed')
              .sort((a, b) => a.scheduledTime - b.scheduledTime)[0];

            return (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleToday();
                    setSelectedDayOverview(new Date());
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:text-blue-200 text-xs font-mono transition cursor-pointer"
                  title="Click to view all reels scheduled for Today"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="font-semibold">Today:</span>
                  <span>{todayCount} {todayCount === 1 ? 'reel' : 'reels'}</span>
                </button>

                {nextPending && (
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(nextPending.scheduledTime);
                      onDateChange(d);
                      setSelectedDayOverview(d);
                    }}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 text-xs font-mono transition cursor-pointer"
                    title={`Jump to next scheduled reel on ${new Date(nextPending.scheduledTime).toLocaleDateString()}`}
                  >
                    <Sparkles className="w-3 h-3 text-purple-400" />
                    <span>Focus Next Reel</span>
                  </button>
                )}
              </div>
            );
          })()}

          {/* Timezone Chip */}
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950/80 border border-zinc-800 text-zinc-400 text-xs font-mono">
            <Clock className="w-3 h-3 text-blue-400" />
            <span>{timezone.split('/')[1]?.replace('_', ' ') || timezone}</span>
          </div>
        </div>

        {/* Right: View Switcher, Search & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2.5 justify-between lg:justify-end">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-48 lg:w-44">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reels..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-hidden focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* View Mode Toggle Buttons */}
          <div className="flex items-center p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'month'
                  ? 'bg-blue-600/30 border border-blue-500/40 text-blue-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Month</span>
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-blue-600/30 border border-blue-500/40 text-blue-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Week</span>
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'agenda'
                  ? 'bg-blue-600/30 border border-blue-500/40 text-blue-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Agenda</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Status Filter Badges Strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[10px] shrink-0 mr-1 flex items-center gap-1">
          <Filter className="w-3 h-3" /> Status:
        </span>
        {[
          { id: 'all', label: 'All Reels', count: schedules.length, dot: 'bg-zinc-400' },
          { id: 'pending', label: 'Scheduled', count: schedules.filter(s => s.status === 'pending').length, dot: 'bg-blue-500' },
          { id: 'published', label: 'Published', count: schedules.filter(s => s.status === 'published').length, dot: 'bg-emerald-500' },
          { id: 'failed', label: 'Failed / Retrying', count: schedules.filter(s => s.status === 'failed').length, dot: 'bg-rose-500' },
          { id: 'conflict', label: 'Collisions', count: pendingConflicts.length, dot: 'bg-amber-400' }
        ].map(filter => (
          <button
            key={filter.id}
            onClick={() => setStatusFilter(filter.id as StatusFilter)}
            className={`px-3 py-1.5 rounded-xl font-medium text-xs transition shrink-0 flex items-center gap-2 cursor-pointer ${
              statusFilter === filter.id
                ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 shadow-xs'
                : 'bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${filter.dot}`} />
            <span>{filter.label}</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              statusFilter === filter.id ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-850 text-zinc-500'
            }`}>
              {filter.count}
            </span>
          </button>
        ))}
      </div>

      {/* 4. MAIN CALENDAR VIEWS */}

      {/* VIEW A: MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="grid grid-cols-7 gap-px bg-zinc-800 rounded-2xl overflow-hidden border border-zinc-800 shadow-xl">
          {/* Weekday headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dIdx) => (
            <div key={`weekday-${day}-${dIdx}`} className="bg-zinc-950 p-3 text-center text-xs font-semibold text-zinc-400 font-mono">
              {day}
            </div>
          ))}

          {/* Day cells */}
          {monthDays.map(({ date, isCurrentMonth }, idx) => {
            const cellDateStr = date.toDateString();
            const isTodayCell = isToday(date);
            const isDropTarget = dragOverDateStr === cellDateStr;

            // Find matching schedules
            const daySchedules = filteredSchedules.filter(s => {
              const sDate = new Date(s.scheduledTime);
              return sDate.toDateString() === cellDateStr;
            });

            return (
              <div
                key={`cal-cell-${date.getTime()}-${idx}`}
                onDragOver={(e) => handleDragOver(e, cellDateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnDate(e, date)}
                onClick={() => setSelectedDayOverview(date)}
                className={`group min-h-[125px] p-2 flex flex-col justify-between transition-all relative cursor-pointer select-none ${
                  isDropTarget
                    ? 'bg-blue-950/40 ring-2 ring-blue-500 ring-inset'
                    : isCurrentMonth
                      ? 'bg-[#0e0e12] hover:bg-zinc-900/70 hover:ring-1 hover:ring-zinc-700/50'
                      : 'bg-[#08080a] opacity-40 hover:opacity-75'
                }`}
              >
                {/* Cell Header: Day Number & Quick Add */}
                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDayOverview(date);
                    }}
                    className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded-md transition hover:scale-105 cursor-pointer ${
                      isTodayCell
                        ? 'bg-blue-600 text-white shadow-xs'
                        : isCurrentMonth ? 'text-zinc-300 hover:text-white hover:bg-zinc-800' : 'text-zinc-600'
                    }`}
                    title={`Click to view all reels scheduled on ${date.toLocaleDateString()}`}
                  >
                    {date.getDate()}
                  </button>

                  <div className="flex items-center gap-1">
                    {daySchedules.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDayOverview(date);
                        }}
                        className="text-[10px] bg-zinc-800/90 hover:bg-blue-600 text-zinc-300 hover:text-white font-mono px-1.5 py-0.5 rounded-md border border-zinc-700/60 hover:border-blue-500 transition cursor-pointer font-semibold shadow-xs"
                        title={`Click to inspect ${daySchedules.length} scheduled reels on this day`}
                      >
                        {daySchedules.length}
                      </button>
                    )}
                    {/* Quick Add Button on Hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickScheduleDate(date);
                        setQuickSelectedVideo(driveVideos[0] || null);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-blue-600/30 text-blue-400 rounded-md transition cursor-pointer"
                      title={`Schedule reel on ${date.toLocaleDateString()}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Day Reels List (Shows up to 2 items + "+X more" button) */}
                <div className="mt-2 space-y-1 overflow-hidden pr-0.5">
                  {daySchedules.slice(0, 2).map((sch, sIdx) => {
                    const isFailed = sch.status === 'failed';
                    const isPub = sch.status === 'published';
                    const isPubing = sch.status === 'publishing';
                    const hasConflict = sch.status === 'pending' && findConflict(sch.scheduledTime, sch.id) !== null;

                    const colorClass = hasConflict
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
                      : isPub 
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20' 
                        : isFailed 
                          ? 'bg-rose-500/10 border-rose-500/25 text-rose-300 hover:bg-rose-500/20' 
                          : isPubing 
                            ? 'bg-amber-500/15 border-amber-500/30 text-amber-200 animate-pulse'
                            : 'bg-blue-500/10 border-blue-500/25 text-blue-300 hover:bg-blue-500/20';

                    return (
                      <div
                        key={`day-sch-${sch.id}-${sIdx}`}
                        draggable={sch.status !== 'published' && sch.status !== 'publishing'}
                        onDragStart={(e) => handleDragStart(e, sch.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(sch);
                        }}
                        className={`text-[10px] p-1.5 rounded-lg border ${colorClass} cursor-pointer truncate font-mono select-none flex items-center justify-between gap-1.5 shadow-xs transition-transform active:scale-95`}
                        title={`${hasConflict ? '[CONFLICT OVERLAP] ' : ''}${sch.videoFileName} (${new Date(sch.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-[9px] opacity-80 shrink-0">
                            {new Date(sch.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="truncate">{sch.videoFileName}</span>
                        </div>

                        {hasConflict && (
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 animate-bounce" />
                        )}
                        {isPub && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        )}
                        {isFailed && (
                          <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                        )}
                      </div>
                    );
                  })}

                  {/* If more than 2 reels are scheduled, render clean "+X more" inspection pill */}
                  {daySchedules.length > 2 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDayOverview(date);
                      }}
                      className="w-full text-[10px] font-mono py-1 px-1.5 rounded-lg bg-zinc-800/90 hover:bg-blue-600/30 text-zinc-300 hover:text-blue-200 border border-zinc-700/60 hover:border-blue-500/40 text-center transition flex items-center justify-center gap-1 cursor-pointer font-semibold shadow-xs"
                      title={`Click to view all ${daySchedules.length} reels on ${date.toLocaleDateString()}`}
                    >
                      <Eye className="w-3 h-3 text-blue-400 shrink-0" />
                      <span>+{daySchedules.length - 2} more</span>
                      <span className="opacity-70 text-[9px]">({daySchedules.length} total)</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW B: WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((dayDate, dayIdx) => {
            const cellDateStr = dayDate.toDateString();
            const isTodayCell = isToday(dayDate);
            const isDropTarget = dragOverDateStr === cellDateStr;

            const daySchedules = filteredSchedules
              .filter(s => new Date(s.scheduledTime).toDateString() === cellDateStr)
              .sort((a, b) => a.scheduledTime - b.scheduledTime);

            return (
              <div
                key={`week-col-${dayIdx}`}
                onDragOver={(e) => handleDragOver(e, cellDateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnDate(e, dayDate)}
                className={`p-3 rounded-2xl border flex flex-col justify-between transition-all min-h-[350px] ${
                  isDropTarget
                    ? 'bg-blue-950/40 border-blue-500 ring-2 ring-blue-500'
                    : isTodayCell
                      ? 'bg-zinc-900/80 border-blue-500/40 shadow-lg'
                      : 'bg-zinc-900/40 border-zinc-800/80'
                }`}
              >
                {/* Column Header */}
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/60">
                    <button
                      type="button"
                      onClick={() => setSelectedDayOverview(dayDate)}
                      className="text-left cursor-pointer hover:opacity-80 transition group"
                      title="Click to inspect this day"
                    >
                      <span className="text-[11px] font-mono uppercase text-zinc-400 font-semibold block group-hover:text-blue-400 transition">
                        {dayDate.toLocaleDateString('default', { weekday: 'short' })}
                      </span>
                      <span className={`text-base font-display font-bold ${isTodayCell ? 'text-blue-400' : 'text-zinc-200 group-hover:text-white'}`}>
                        {dayDate.toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setQuickScheduleDate(dayDate);
                        setQuickSelectedVideo(driveVideos[0] || null);
                      }}
                      className="p-1 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
                      title="Add reel to this day"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Scheduled Items in this Week Day */}
                  <div className="space-y-2.5">
                    {daySchedules.length === 0 ? (
                      <div
                        onClick={() => setSelectedDayOverview(dayDate)}
                        className="py-12 text-center text-zinc-600 hover:text-zinc-400 text-xs font-mono cursor-pointer transition"
                        title="Click to inspect or schedule"
                      >
                        No reels scheduled
                      </div>
                    ) : (
                      daySchedules.map((sch) => {
                        const isPub = sch.status === 'published';
                        const isFailed = sch.status === 'failed';
                        const hasConflict = sch.status === 'pending' && findConflict(sch.scheduledTime, sch.id) !== null;

                        return (
                          <div
                            key={`week-card-${sch.id}`}
                            draggable={sch.status !== 'published'}
                            onDragStart={(e) => handleDragStart(e, sch.id)}
                            onClick={() => handleOpenDetail(sch)}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all space-y-1.5 shadow-xs hover:scale-[1.02] ${
                              hasConflict
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                                : isPub
                                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                                  : isFailed
                                    ? 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                                    : 'bg-zinc-950/60 border-zinc-800 text-zinc-200 hover:border-zinc-700'
                            }`}
                          >
                            <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400">
                              <span className="font-semibold text-blue-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(sch.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {hasConflict ? (
                                <span className="text-amber-400 flex items-center gap-0.5 font-bold">
                                  <AlertTriangle className="w-3 h-3" /> Clashing
                                </span>
                              ) : (
                                <span className={`capitalize ${isPub ? 'text-emerald-400' : isFailed ? 'text-rose-400' : 'text-zinc-500'}`}>
                                  {sch.status}
                                </span>
                              )}
                            </div>

                            <p className="font-semibold font-mono text-xs text-zinc-100 truncate flex items-center gap-1.5">
                              <Video className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              <span className="truncate">{sch.videoFileName}</span>
                            </p>

                            {sch.captionText && (
                              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                                {sch.captionText}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Day Summary Footer */}
                <button
                  type="button"
                  onClick={() => setSelectedDayOverview(dayDate)}
                  className="pt-2 text-[10px] font-mono text-zinc-500 hover:text-blue-400 border-t border-zinc-800/60 flex justify-between w-full cursor-pointer transition"
                  title="Click to inspect all reels on this day"
                >
                  <span className="font-semibold">{daySchedules.length} reels</span>
                  <span>{daySchedules.filter(s => s.status === 'published').length} live</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW C: AGENDA / LIST VIEW */}
      {viewMode === 'agenda' && (
        <div className="space-y-4">
          {filteredSchedules.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800 space-y-2">
              <CalendarDays className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm font-semibold text-zinc-300">No scheduled reels found matching criteria</p>
              <p className="text-xs text-zinc-500">Try adjusting your search filters or schedule new reels from the Drive tab.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSchedules
                .sort((a, b) => a.scheduledTime - b.scheduledTime)
                .map((sch) => {
                  const isPub = sch.status === 'published';
                  const isFailed = sch.status === 'failed';
                  const hasConflict = sch.status === 'pending' && findConflict(sch.scheduledTime, sch.id) !== null;
                  const matchingDriveVideo = driveVideos.find(v => v.id === sch.videoFileId || v.name === sch.videoFileName);

                  return (
                    <div
                      key={`agenda-item-${sch.id}`}
                      className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
                        hasConflict
                          ? 'bg-amber-950/20 border-amber-500/40'
                          : isPub
                            ? 'bg-emerald-950/15 border-emerald-500/25'
                            : isFailed
                              ? 'bg-rose-950/20 border-rose-500/30'
                              : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {/* Left: Video Info & Thumbnail */}
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-sm text-zinc-100 truncate font-mono">
                              {sch.videoFileName}
                            </h4>
                            <span className={`text-[10px] font-semibold font-mono uppercase px-2 py-0.5 rounded-full border ${
                              isPub
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                : isFailed
                                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                            }`}>
                              {sch.status}
                            </span>
                            {hasConflict && (
                              <span className="text-[10px] font-semibold font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Time Collision
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono">
                            <span className="flex items-center gap-1 text-blue-400">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(sch.scheduledTime).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="text-zinc-500 uppercase">
                              • {sch.recurrence}
                            </span>
                          </div>

                          {sch.captionText && (
                            <p className="text-xs text-zinc-300 line-clamp-1 leading-relaxed">
                              {sch.captionText}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                        {hasConflict && (
                          <button
                            onClick={() => onAutoRescheduleConflict(sch.id, sch.scheduledTime)}
                            disabled={actionLoading === `auto_reschedule_${sch.id}`}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Shift this reel by +1 hour"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Buffer +1h</span>
                          </button>
                        )}

                        {isFailed && (
                          <button
                            onClick={() => onRetrySingleSchedule(sch.id)}
                            disabled={actionLoading === `retry_${sch.id}`}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === `retry_${sch.id}` ? 'animate-spin' : ''}`} />
                            <span>Retry</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleOpenDetail(sch)}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer border border-zinc-700"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Inspect / Edit</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* 5. QUICK SCHEDULE MODAL ON DATE CELL CLICK */}
      <AnimatePresence>
        {quickScheduleDate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-lg w-full bg-zinc-950 border border-zinc-800 p-6 rounded-2xl relative shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <CalendarDays className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    Schedule Reel on {quickScheduleDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </h3>
                </div>
                <button
                  onClick={() => setQuickScheduleDate(null)}
                  className="p-1 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-900 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleQuickScheduleSubmit} className="space-y-4">
                {/* Select Video from synchronized list */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    1. Select Video ({driveVideos.length} Available in Drive)
                  </label>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 border border-zinc-800 p-2 rounded-xl bg-zinc-900/40">
                    {driveVideos.length === 0 ? (
                      <p className="text-xs text-zinc-500 p-3 text-center">No Drive videos synced yet.</p>
                    ) : (
                      driveVideos.map(vid => (
                        <div
                          key={vid.id}
                          onClick={() => {
                            setQuickSelectedVideo(vid);
                            if (!quickCaption && vid.captionText) {
                              setQuickCaption(vid.captionText);
                            }
                          }}
                          className={`p-2 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition ${
                            quickSelectedVideo?.id === vid.id
                              ? 'bg-blue-600/20 border-blue-500/60 text-blue-200 font-semibold'
                              : 'bg-zinc-950/60 border-zinc-850 text-zinc-300 hover:bg-zinc-900'
                          }`}
                        >
                          <span className="truncate font-mono">{vid.name}</span>
                          {quickSelectedVideo?.id === vid.id && (
                            <Check className="w-4 h-4 text-blue-400 shrink-0" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Time Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    2. Launch Time
                  </label>
                  <input
                    type="time"
                    value={quickScheduleTime}
                    onChange={(e) => setQuickScheduleTime(e.target.value)}
                    required
                    className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-mono text-zinc-100 focus:outline-hidden focus:border-blue-500"
                  />
                </div>

                {/* Caption Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    3. Reel Caption (Optional)
                  </label>
                  <textarea
                    value={quickCaption}
                    onChange={(e) => setQuickCaption(e.target.value)}
                    placeholder="Enter hashtags and description..."
                    rows={3}
                    className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-hidden focus:border-blue-500"
                  />
                </div>

                <div className="flex gap-2 pt-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setQuickScheduleDate(null)}
                    className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!quickSelectedVideo || actionLoading === 'create_schedule'}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition shadow flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {actionLoading === 'create_schedule' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Schedule Reel</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. SCHEDULE DETAIL & EDIT MODAL */}
      <AnimatePresence>
        {selectedSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-md w-full bg-zinc-950 border border-zinc-800 p-6 rounded-2xl relative shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Video className="w-4 h-4 text-blue-400" />
                  <span>Instagram Reel Details</span>
                </h3>
                <button
                  onClick={() => setSelectedSchedule(null)}
                  className="p-1 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-900 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Video Info Header */}
              <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono text-zinc-500 uppercase block">Video Target</span>
                <p className="text-sm font-semibold font-mono text-zinc-200 truncate">
                  {selectedSchedule.videoFileName}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                    selectedSchedule.status === 'published'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : selectedSchedule.status === 'failed'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                  }`}>
                    {selectedSchedule.status}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    ({selectedSchedule.retryCount}/3 attempts)
                  </span>
                </div>
              </div>

              {/* Collision Warning if clashing */}
              {(() => {
                if (selectedSchedule.status !== 'pending') return null;
                const conflict = findConflict(selectedSchedule.scheduledTime, selectedSchedule.id);
                if (!conflict) return null;
                const suggested = getSuggestedBufferedTime(selectedSchedule.scheduledTime, selectedSchedule.id);
                return (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-300">Launch Collision</span>
                        <p className="text-[11px] text-zinc-300 mt-0.5">
                          Shares exact launch slot with <strong className="text-amber-200">{conflict.videoFileName}</strong>.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-amber-500/20">
                      <span className="text-[11px] text-zinc-400 font-mono">
                        Buffer (+1h): <strong className="text-amber-300">{new Date(suggested).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => onAutoRescheduleConflict(selectedSchedule.id, selectedSchedule.scheduledTime)}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg transition flex items-center gap-1 cursor-pointer"
                      >
                        <Clock className="w-3 h-3" />
                        Apply Buffer
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Editable Fields or Static View */}
              {isEditingSchedule ? (
                <div className="space-y-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-zinc-500 uppercase">Date</label>
                      <input
                        type="date"
                        value={editDateStr}
                        onChange={(e) => setEditDateStr(e.target.value)}
                        className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-zinc-500 uppercase">Time</label>
                      <input
                        type="time"
                        value={editTimeStr}
                        onChange={(e) => setEditTimeStr(e.target.value)}
                        className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-zinc-500 uppercase">Caption</label>
                    <textarea
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      rows={3}
                      className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingSchedule(false)}
                      className="flex-1 py-1.5 bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditSchedule}
                      className="flex-1 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-4 p-3 rounded-xl bg-zinc-900/30 border border-zinc-850">
                    <div>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase block">Scheduled Launch</span>
                      <p className="text-xs text-zinc-200 font-mono font-semibold mt-0.5">
                        {new Date(selectedSchedule.scheduledTime).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase block">Recurrence</span>
                      <p className="text-xs text-blue-400 font-mono uppercase font-semibold mt-0.5">
                        {selectedSchedule.recurrence}
                      </p>
                    </div>
                  </div>

                  {selectedSchedule.captionText && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase block">Caption</span>
                      <div className="p-3 bg-zinc-900/40 border border-zinc-850 rounded-xl text-zinc-300 text-xs leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">
                        {selectedSchedule.captionText}
                      </div>
                    </div>
                  )}

                  {selectedSchedule.errorMessage && (
                    <div className="p-3 bg-rose-950/20 border border-rose-500/30 text-rose-300 rounded-xl text-xs space-y-1">
                      <span className="font-semibold block">Failure Notice:</span>
                      <p className="font-mono text-[11px]">{selectedSchedule.errorMessage}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons Bar */}
              <div className="flex flex-col gap-2 pt-3 border-t border-zinc-800">
                {!isEditingSchedule && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsEditingSchedule(true)}
                      className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer border border-zinc-700"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Reschedule / Edit</span>
                    </button>

                    {selectedSchedule.status === 'failed' && (
                      <button
                        onClick={() => onResetToPending(selectedSchedule.id)}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition cursor-pointer"
                      >
                        Retry Pipeline
                      </button>
                    )}
                  </div>
                )}

                {/* Cancel / Deletion confirmation */}
                {confirmDeleteId === selectedSchedule.id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onDeleteSchedule(selectedSchedule.id, true)}
                      className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl transition cursor-pointer"
                    >
                      Confirm Cancel
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-4 py-2 bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl border border-zinc-700 cursor-pointer"
                    >
                      Back
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(selectedSchedule.id)}
                    className="w-full py-2 border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 font-semibold text-xs rounded-xl transition cursor-pointer"
                  >
                    Cancel Scheduled Reel
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 7. DAY OVERVIEW & BREAKDOWN MODAL (ON CLICKING TODAY OR ANY DAY) */}
      <DayOverviewModal
        date={selectedDayOverview}
        onClose={() => setSelectedDayOverview(null)}
        schedules={schedules}
        driveVideos={driveVideos}
        onOpenScheduleDetail={handleOpenDetail}
        onOpenQuickSchedule={(date) => {
          setQuickScheduleDate(date);
          setQuickSelectedVideo(driveVideos[0] || null);
        }}
        onAutoRescheduleConflict={onAutoRescheduleConflict}
        onResetToPending={onResetToPending}
        onRetrySingleSchedule={onRetrySingleSchedule}
        onDeleteSchedule={onDeleteSchedule}
        actionLoading={actionLoading}
        findConflict={findConflict}
        timezone={timezone}
      />
    </motion.div>
  );
}

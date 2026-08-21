import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Video, 
  Clock, 
  HardDrive, 
  FileText, 
  ExternalLink, 
  Plus, 
  Copy, 
  Check, 
  Play, 
  Maximize2,
  Sparkles
} from 'lucide-react';
import { DriveVideoItem } from '../types.js';
import { formatDuration, formatFileSize } from './VideoThumbnail.js';

interface VideoPreviewModalProps {
  video: DriveVideoItem | null;
  onClose: () => void;
  onScheduleClick: (video: DriveVideoItem) => void;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  video,
  onClose,
  onScheduleClick
}) => {
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [imageError, setImageError] = useState(false);

  if (!video) return null;

  const durationStr = formatDuration(video.videoMediaMetadata?.durationMillis);
  const fileSizeStr = formatFileSize(video.size);
  const width = video.videoMediaMetadata?.width;
  const height = video.videoMediaMetadata?.height;
  const isVertical = width && height ? height > width : true;
  const driveUrl = video.webViewLink || `https://drive.google.com/file/d/${video.id}/view`;
  const primaryThumbUrl = video.id ? `/api/drive/thumbnail/${video.id}` : video.thumbnailLink;

  const handleCopyCaption = () => {
    if (!video.captionText) return;
    navigator.clipboard.writeText(video.captionText);
    setCopiedCaption(true);
    setTimeout(() => setCopiedCaption(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="max-w-2xl w-full bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-850 flex items-center justify-between bg-zinc-900/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Video className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-zinc-100 truncate font-mono">
                {video.name}
              </h3>
              <p className="text-[10px] text-zinc-500 font-mono truncate">
                Drive ID: {video.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Main Thumbnail Preview Container */}
          <div className="relative w-full rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center min-h-[220px] max-h-[340px] shadow-inner group">
            {primaryThumbUrl && !imageError ? (
              <div className="relative w-full h-full flex items-center justify-center bg-black/40">
                <img
                  src={primaryThumbUrl}
                  alt={video.name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  className="max-h-[340px] w-auto max-w-full object-contain rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-[1.01]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
                <Video className="w-10 h-10 text-zinc-600 animate-pulse" />
                <span className="text-xs font-mono">Google Drive video thumbnail generating...</span>
              </div>
            )}

            {/* Floating badges on thumbnail */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-black/80 text-blue-400 border border-blue-500/30 backdrop-blur-md uppercase tracking-wider">
                Google Drive Reel Preview
              </span>
              {isVertical && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-violet-950/80 text-violet-300 border border-violet-500/30 backdrop-blur-md uppercase">
                  9:16 Vertical
                </span>
              )}
            </div>

            {durationStr && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 text-[11px] font-mono font-bold px-2.5 py-1 rounded-md bg-black/85 text-zinc-200 border border-white/10 backdrop-blur-md shadow-md z-10">
                <Clock className="w-3 h-3 text-blue-400" />
                <span>{durationStr}</span>
              </div>
            )}
          </div>

          {/* Video Metadata Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-zinc-500 block">Format</span>
              <p className="text-xs font-semibold text-zinc-200 mt-0.5 uppercase font-mono">
                {video.name.split('.').pop() || 'MP4'}
              </p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-zinc-500 block">Duration</span>
              <p className="text-xs font-semibold text-zinc-200 mt-0.5 font-mono">
                {durationStr || 'Video Stream'}
              </p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-zinc-500 block">Dimensions</span>
              <p className="text-xs font-semibold text-zinc-200 mt-0.5 font-mono">
                {width && height ? `${width} × ${height}` : 'HD / Auto'}
              </p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-zinc-500 block">File Size</span>
              <p className="text-xs font-semibold text-zinc-200 mt-0.5 font-mono">
                {fileSizeStr || 'Drive Media'}
              </p>
            </div>
          </div>

          {/* Caption Couple Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                Linked Caption ({video.captionFileName || 'Auto-paired'})
              </span>
              {video.captionText && (
                <button
                  type="button"
                  onClick={handleCopyCaption}
                  className="text-[10px] font-mono text-zinc-400 hover:text-blue-400 flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedCaption ? (
                    <>
                      <Check className="w-3 h-3 text-green-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy Caption
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="p-3.5 bg-zinc-900/70 border border-zinc-800 rounded-xl text-xs text-zinc-300 font-sans leading-relaxed max-h-[140px] overflow-y-auto whitespace-pre-wrap">
              {video.captionText || (
                <span className="text-zinc-500 italic">
                  No caption .txt found with matching base name.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-zinc-850 bg-zinc-900/40 flex flex-col sm:flex-row items-center justify-between gap-3">
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-zinc-700 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Google Drive
          </a>

          <div className="w-full sm:w-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl transition border border-zinc-800 cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={() => {
                onClose();
                onScheduleClick(video);
              }}
              className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Schedule This Reel
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

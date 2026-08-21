import React, { useState } from 'react';
import { Play, Video, Eye, Sparkles, Film } from 'lucide-react';
import { DriveVideoItem } from '../types.js';

interface VideoThumbnailProps {
  video: DriveVideoItem;
  onPreviewClick?: (video: DriveVideoItem) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function formatDuration(durationMillis?: string | number): string | null {
  if (!durationMillis) return null;
  const totalSeconds = Math.floor(Number(durationMillis) / 1000);
  if (isNaN(totalSeconds) || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes?: string | number): string | null {
  if (!bytes) return null;
  const b = Number(bytes);
  if (isNaN(b) || b <= 0) return null;
  if (b < 1024 * 1024) {
    return `${(b / 1024).toFixed(1)} KB`;
  }
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export const VideoThumbnail: React.FC<VideoThumbnailProps> = ({
  video,
  onPreviewClick,
  className = '',
  size = 'md'
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // We can use either the proxy endpoint or direct Google thumbnail link
  const primaryThumbUrl = video.id ? `/api/drive/thumbnail/${video.id}` : video.thumbnailLink;
  const fallbackThumbUrl = video.thumbnailLink;
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(primaryThumbUrl || fallbackThumbUrl);

  const durationStr = formatDuration(video.videoMediaMetadata?.durationMillis);
  const width = video.videoMediaMetadata?.width;
  const height = video.videoMediaMetadata?.height;
  const isVertical = width && height ? height > width : true; // Reels default to vertical
  const extension = video.name.split('.').pop()?.toUpperCase() || 'MP4';

  const sizeClasses = {
    sm: 'w-14 h-10',
    md: 'w-20 h-14 sm:w-24 sm:h-16',
    lg: 'w-32 h-20 sm:w-40 sm:h-24'
  }[size];

  const handleImageError = () => {
    if (currentSrc !== fallbackThumbUrl && fallbackThumbUrl) {
      // Try direct Google thumbnail link as fallback
      setCurrentSrc(fallbackThumbUrl);
    } else {
      setImageError(true);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (onPreviewClick) {
          e.stopPropagation();
          onPreviewClick(video);
        }
      }}
      className={`relative ${sizeClasses} rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/90 shrink-0 select-none group cursor-pointer transition-all duration-300 hover:border-blue-500/60 hover:shadow-lg hover:shadow-blue-500/10 ${className}`}
      title={`Click to preview "${video.name}"`}
    >
      {/* Loading Shimmer */}
      {!imageLoaded && !imageError && currentSrc && (
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 animate-pulse" />
      )}

      {/* Actual Thumbnail Image */}
      {currentSrc && !imageError ? (
        <img
          src={currentSrc}
          alt={video.name}
          referrerPolicy="no-referrer"
          onLoad={() => setImageLoaded(true)}
          onError={handleImageError}
          className={`w-full h-full object-cover object-center transition-all duration-300 group-hover:scale-105 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : (
        /* Fallback Graphic */
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 flex flex-col items-center justify-center p-1">
          <div className="absolute inset-0 bg-radial-gradient from-blue-500/10 via-transparent to-transparent pointer-events-none opacity-40" />
          <Film className="w-5 h-5 text-zinc-600 group-hover:text-blue-400 transition-colors" />
        </div>
      )}

      {/* Dark gradient overlay for badge readability & cinematic look */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-60 transition-opacity" />

      {/* Hover Play / Enlarge Button */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 bg-black/40 backdrop-blur-[1px]">
        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-blue-600/90 text-white flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
          <Eye className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Top Left Format / Reel Indicator */}
      <div className="absolute top-1 left-1.5 flex items-center gap-1 z-10">
        <span className="text-[8px] font-mono font-bold px-1 py-0.2 rounded bg-black/70 text-zinc-300 border border-white/10 uppercase tracking-wider backdrop-blur-sm">
          {extension}
        </span>
        {isVertical && (
          <span className="hidden sm:inline-block text-[7px] font-mono font-bold px-1 py-0.2 rounded bg-blue-500/30 text-blue-300 border border-blue-400/20 uppercase tracking-widest backdrop-blur-sm">
            9:16
          </span>
        )}
      </div>

      {/* Bottom Right Duration Badge */}
      {durationStr ? (
        <div className="absolute bottom-1 right-1.5 z-10 flex items-center gap-0.5 text-[8px] font-mono font-semibold px-1.5 py-0.2 rounded bg-black/80 text-zinc-200 border border-white/10 backdrop-blur-sm shadow-sm">
          <span>{durationStr}</span>
        </div>
      ) : (
        <div className="absolute bottom-1 right-1.5 z-10 flex items-center gap-0.5 text-[7px] font-mono text-zinc-400">
          <Play className="w-2 h-2 fill-zinc-400" />
        </div>
      )}
    </div>
  );
};

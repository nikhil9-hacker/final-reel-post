import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';

const execPromise = util.promisify(exec);

export interface VideoMetadata {
  duration: number; // in seconds
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  bitRate: number;
  sizeBytes: number;
  isVertical: boolean;
  aspectRatioString: string;
  needsOptimization: boolean;
  optimizationReasons: string[];
}

export interface OptimizationResult {
  filePath: string;
  originalDuration: number;
  finalDuration: number;
  wasOptimized: boolean;
  reasons: string[];
}

/**
 * Extract comprehensive video metadata using ffprobe
 */
export async function probeVideo(filePath: string): Promise<VideoMetadata | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    const { stdout } = await execPromise(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 15000 }
    );

    const data = JSON.parse(stdout);
    const videoStream = (data.streams || []).find((s: any) => s.codec_type === 'video');
    const audioStream = (data.streams || []).find((s: any) => s.codec_type === 'audio');

    const duration = parseFloat(data.format?.duration || videoStream?.duration || '0');
    const width = parseInt(videoStream?.width || '0', 10);
    const height = parseInt(videoStream?.height || '0', 10);
    const videoCodec = (videoStream?.codec_name || '').toLowerCase();
    const audioCodec = (audioStream?.codec_name || '').toLowerCase();
    const bitRate = parseInt(data.format?.bit_rate || '0', 10);
    const sizeBytes = stats.size;

    const isVertical = height > width;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width || 1, height || 1);
    const aspectRatioString = width && height ? `${width / divisor}:${height / divisor}` : 'unknown';

    const reasons: string[] = [];

    // Instagram Reel constraint 1: Max duration is 900 seconds (15 minutes). Standard reels: 3s - 900s.
    if (duration > 900) {
      reasons.push(`Duration (${(duration / 60).toFixed(1)}m) exceeds Instagram Reels maximum of 15m (900s)`);
    }

    // Instagram Reel constraint 2: Aspect ratio must be vertical (9:16 recommended for Reels)
    if (!isVertical || width > height) {
      reasons.push(`Aspect ratio (${aspectRatioString}, ${width}x${height}) is horizontal/landscape; Instagram Reels requires vertical format (9:16)`);
    } else if (height < 540 || width < 360) {
      reasons.push(`Resolution (${width}x${height}) is below Instagram minimum resolution (540p)`);
    }

    // Instagram Reel constraint 3: Video codec must be H.264 or HEVC (H.265)
    if (videoCodec && !['h264', 'avc1', 'hevc', 'h265'].includes(videoCodec)) {
      reasons.push(`Video codec "${videoCodec}" is not natively supported by Instagram (requires H.264/HEVC)`);
    }

    // Instagram Reel constraint 4: Audio codec must be AAC (or mp3)
    if (audioCodec && !['aac', 'mp3', 'mp4a'].includes(audioCodec)) {
      reasons.push(`Audio codec "${audioCodec}" is not standard for Instagram (requires AAC)`);
    }

    return {
      duration,
      width,
      height,
      videoCodec,
      audioCodec,
      bitRate,
      sizeBytes,
      isVertical,
      aspectRatioString,
      needsOptimization: reasons.length > 0,
      optimizationReasons: reasons
    };
  } catch (err: any) {
    console.warn(`[VideoOptimizer] ffprobe probe failed for ${filePath}:`, err?.message || err);
    return null;
  }
}

/**
 * Ensures video is 100% compliant with Instagram Reels API specifications:
 * - Trims duration if > 90 seconds (Standard Instagram Reels maximum)
 * - Transcodes or adds faststart moov atom if necessary
 * - Adjusts aspect ratio to vertical 9:16 (720x1280) if horizontal
 * - Preserves original quality and uses fast stream copying whenever possible
 */
export async function optimizeForInstagramReel(
  inputFilePath: string,
  maxDurationSeconds = 90
): Promise<OptimizationResult> {
  const probe = await probeVideo(inputFilePath);

  if (!probe) {
    // If probe fails (e.g. ffprobe missing), return input file as-is
    return {
      filePath: inputFilePath,
      originalDuration: 0,
      finalDuration: 0,
      wasOptimized: false,
      reasons: ['Could not probe video metadata; using original file']
    };
  }

  // If already within all bounds: vertical aspect ratio, compliant codecs, and within max duration
  const needsDurationTrim = probe.duration > maxDurationSeconds;
  const isCompliantCodec = ['h264', 'avc1', 'hevc', 'h265'].includes(probe.videoCodec);
  const isCompliantAudio = !probe.audioCodec || ['aac', 'mp3', 'mp4a'].includes(probe.audioCodec);
  const isCompliantAspect = probe.isVertical && probe.height >= 540 && (probe.height / (probe.width || 1)) >= 1.2;

  if (!needsDurationTrim && isCompliantCodec && isCompliantAudio && isCompliantAspect) {
    return {
      filePath: inputFilePath,
      originalDuration: probe.duration,
      finalDuration: probe.duration,
      wasOptimized: false,
      reasons: []
    };
  }

  const dir = path.dirname(inputFilePath);
  const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
  const optimizedFilePath = path.join(dir, `${baseName}_optimized_${Date.now()}.mp4`);

  const reasons: string[] = [];
  if (needsDurationTrim) {
    reasons.push(`Trimmed duration from ${(probe.duration / 60).toFixed(1)}m to ${maxDurationSeconds}s for Instagram Reels standard length`);
  }
  if (!isCompliantAspect) {
    reasons.push(`Converted aspect ratio (${probe.width}x${probe.height}) to Instagram Reels standard vertical 9:16 (720x1280)`);
  }
  if (!isCompliantCodec) {
    reasons.push(`Re-encoded video codec from ${probe.videoCodec} to H.264`);
  }
  if (!isCompliantAudio) {
    reasons.push(`Re-encoded audio codec from ${probe.audioCodec} to AAC`);
  }

  console.log(`[VideoOptimizer] Optimizing "${baseName}" for Instagram Reels: ${reasons.join(', ')}...`);

  // Attempt Strategy 1: Fast stream copy IF aspect ratio is already compliant vertical and codecs are standard
  if (isCompliantAspect && isCompliantCodec && isCompliantAudio) {
    try {
      const trimParam = needsDurationTrim ? `-t ${maxDurationSeconds}` : '';
      await execPromise(
        `ffmpeg -y -ss 0 -i "${inputFilePath}" ${trimParam} -c copy -movflags +faststart "${optimizedFilePath}"`,
        { timeout: 60000 }
      );

      const stats = fs.statSync(optimizedFilePath);
      if (stats.size > 0) {
        console.log(`[VideoOptimizer] Fast stream copy successful (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
        return {
          filePath: optimizedFilePath,
          originalDuration: probe.duration,
          finalDuration: Math.min(probe.duration, maxDurationSeconds),
          wasOptimized: true,
          reasons
        };
      }
    } catch (copyErr: any) {
      console.warn(`[VideoOptimizer] Fast stream copy failed (${copyErr?.message || copyErr}). Falling back to full transcode.`);
    }
  }

  // Strategy 2: Fast re-encode to high-quality standard Instagram Reels 9:16 vertical H.264/AAC
  try {
    const trimParam = needsDurationTrim ? `-t ${maxDurationSeconds}` : '';
    // Scale and pad to standard vertical 720x1280 (9:16) with yuv420p
    const vfParam = isCompliantAspect
      ? '-vf "format=yuv420p"'
      : '-vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"';

    await execPromise(
      `ffmpeg -y -ss 0 -i "${inputFilePath}" ${trimParam} ${vfParam} -c:v libx264 -preset ultrafast -crf 23 -r 30 -threads 0 -c:a aac -b:a 128k -ar 44100 -movflags +faststart "${optimizedFilePath}"`,
      { timeout: 300000 }
    );

    const stats = fs.statSync(optimizedFilePath);
    if (stats.size > 0) {
      console.log(`[VideoOptimizer] Re-encoding successful (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
      return {
        filePath: optimizedFilePath,
        originalDuration: probe.duration,
        finalDuration: Math.min(probe.duration, maxDurationSeconds),
        wasOptimized: true,
        reasons
      };
    }
  } catch (encodeErr: any) {
    console.error(`[VideoOptimizer] Re-encoding failed:`, encodeErr);
    // Cleanup any incomplete file
    if (fs.existsSync(optimizedFilePath)) {
      try { fs.unlinkSync(optimizedFilePath); } catch {}
    }
  }

  // Fallback: return original file path
  return {
    filePath: inputFilePath,
    originalDuration: probe.duration,
    finalDuration: probe.duration,
    wasOptimized: false,
    reasons: ['Optimization command failed, using original file']
  };
}

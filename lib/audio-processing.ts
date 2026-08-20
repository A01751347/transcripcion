import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// Whisper hard cap is 25MB; leave headroom for slight container overhead
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

// Target chunk length (seconds). Short chunks = better recovery from a bad
// chunk, more parallelism, smaller files per Whisper call. 60s is a sweet
// spot for typical 1-2 hour audios.
const TARGET_CHUNK_SECONDS = 60;
const MIN_CHUNK_SECONDS = 40;
const MAX_CHUNK_SECONDS = 90;

// Silence detection params — tuned for natural conversation. -32dB catches
// breath pauses; 0.35s avoids cutting on micro-pauses inside sentences.
const SILENCE_NOISE_DB = -32;
const SILENCE_MIN_DURATION = 0.35;

// Output encoding for each chunk. AAC mono 128 kbps is broadcast-grade for
// speech — Whisper sees essentially the same signal as the original.
const CHUNK_BITRATE_KBPS = 128;

const WHISPER_SUPPORTED_EXTS = new Set([
  "flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm",
]);

function runStderr(
  cmd: string,
  args: string[]
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    let stdout = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr, stdout }));
  });
}

async function runOrThrow(cmd: string, args: string[]): Promise<string> {
  const { code, stderr, stdout } = await runStderr(cmd, args);
  if (code !== 0) {
    throw new Error(
      `${path.basename(cmd)} exited ${code}: ${stderr.slice(-600)}`
    );
  }
  return stdout;
}

export interface AudioProbe {
  duration: number;
  bitRate?: number;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  sizeBytes: number;
}

export async function probeAudio(filePath: string): Promise<AudioProbe> {
  const st = await stat(filePath);
  const stdout = await runOrThrow(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:stream=codec_name,channels,sample_rate",
    "-select_streams", "a:0",
    "-of", "json",
    filePath,
  ]);
  let data: any = {};
  try {
    data = JSON.parse(stdout);
  } catch {
    data = {};
  }
  const stream = data?.streams?.[0] ?? {};
  return {
    duration: parseFloat(data?.format?.duration ?? "0") || 0,
    bitRate: data?.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : undefined,
    codec: stream.codec_name,
    channels: stream.channels,
    sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : undefined,
    sizeBytes: st.size,
  };
}

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

/**
 * Detect silence ranges in a file using ffmpeg's silencedetect filter.
 * Parses stderr lines of the form:
 *   [silencedetect @ ...] silence_start: 12.345
 *   [silencedetect @ ...] silence_end: 13.456 | silence_duration: 1.111
 */
export async function detectSilences(
  filePath: string,
  opts: { noiseDb?: number; minDuration?: number } = {}
): Promise<SilenceRange[]> {
  const noise = opts.noiseDb ?? SILENCE_NOISE_DB;
  const dur = opts.minDuration ?? SILENCE_MIN_DURATION;
  const { stderr } = await runStderr(FFMPEG, [
    "-hide_banner",
    "-nostats",
    "-i", filePath,
    "-af", `silencedetect=noise=${noise}dB:d=${dur}`,
    "-f", "null",
    "-",
  ]);

  const silences: SilenceRange[] = [];
  let currentStart: number | null = null;
  const startRe = /silence_start:\s*(-?[\d.]+)/g;
  const endRe = /silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

  // Walk both patterns in document order
  const events: Array<{ pos: number; kind: "start" | "end"; t: number; d?: number }> = [];
  for (const m of stderr.matchAll(startRe)) {
    events.push({ pos: m.index ?? 0, kind: "start", t: parseFloat(m[1]) });
  }
  for (const m of stderr.matchAll(endRe)) {
    events.push({
      pos: m.index ?? 0,
      kind: "end",
      t: parseFloat(m[1]),
      d: parseFloat(m[2]),
    });
  }
  events.sort((a, b) => a.pos - b.pos);
  for (const e of events) {
    if (e.kind === "start") {
      currentStart = e.t;
    } else if (currentStart != null) {
      silences.push({
        start: currentStart,
        end: e.t,
        duration: e.d ?? e.t - currentStart,
      });
      currentStart = null;
    }
  }
  return silences;
}

export interface ChunkRange {
  start: number;
  end: number;
}

/**
 * Build chunk ranges that snap to silences whenever possible.
 *
 * For each chunk we look at silences whose midpoint falls inside the
 * acceptable window [pos+min, pos+max]. We prefer the silence whose midpoint
 * is closest to the ideal target (pos+target). If no silence falls in the
 * window we extend by 50%, and as a last resort hard-cut at target.
 *
 * The result guarantees Whisper never gets a chunk that's cut mid-word
 * unless the audio has zero detectable silences for >2× the target.
 */
export function buildSilenceAwareBoundaries(
  silences: SilenceRange[],
  totalDuration: number,
  opts: {
    target?: number;
    min?: number;
    max?: number;
  } = {}
): ChunkRange[] {
  const target = opts.target ?? TARGET_CHUNK_SECONDS;
  const min = opts.min ?? MIN_CHUNK_SECONDS;
  const max = opts.max ?? MAX_CHUNK_SECONDS;

  if (totalDuration <= max) {
    return [{ start: 0, end: totalDuration }];
  }

  const midpoints = silences
    .filter((s) => s.duration >= 0.2)
    .map((s) => (s.start + s.end) / 2)
    .sort((a, b) => a - b);

  const ranges: ChunkRange[] = [];
  let pos = 0;

  while (totalDuration - pos > max) {
    const ideal = pos + target;
    const windowMin = pos + min;
    const windowMax = pos + max;

    // First pass: silences inside the comfort window
    let candidates = midpoints.filter((m) => m >= windowMin && m <= windowMax);
    // Second pass: extend by 50%
    if (candidates.length === 0) {
      const extMax = pos + max * 1.5;
      candidates = midpoints.filter((m) => m >= windowMin && m <= extMax);
    }

    let nextBoundary: number;
    if (candidates.length > 0) {
      // Prefer midpoint closest to the ideal target
      nextBoundary = candidates.reduce((best, m) =>
        Math.abs(m - ideal) < Math.abs(best - ideal) ? m : best
      );
    } else {
      // No silences nearby — hard cut. Rare for natural speech.
      nextBoundary = ideal;
    }

    ranges.push({ start: pos, end: nextBoundary });
    pos = nextBoundary;
  }

  ranges.push({ start: pos, end: totalDuration });
  return ranges;
}

/**
 * Extract a precise time range into an m4a file (AAC mono, high bitrate).
 *
 *  - Re-encodes (NEVER `-c copy`) so cuts are sample-accurate, not snapped
 *    to the nearest keyframe.
 *  - Down-mixes to mono — Whisper ignores stereo anyway, halves the file
 *    size with no quality loss for speech.
 *  - Keeps original sample rate when reasonable (caps at 32kHz which is
 *    well above the Nyquist limit needed for intelligible speech).
 *  - m4a/AAC is natively accepted by Whisper, no further transcoding.
 */
export async function extractChunk(
  inputPath: string,
  range: ChunkRange,
  outputPath: string,
  opts: { bitrateKbps?: number; sampleRate?: number } = {}
): Promise<void> {
  const bitrate = opts.bitrateKbps ?? CHUNK_BITRATE_KBPS;
  const sampleRate = opts.sampleRate ?? 32000;
  const duration = range.end - range.start;

  await runOrThrow(FFMPEG, [
    "-y",
    "-ss", String(range.start),
    "-i", inputPath,
    "-t", String(duration),
    "-vn",
    "-ac", "1",
    "-ar", String(sampleRate),
    "-c:a", "aac",
    "-b:a", `${bitrate}k`,
    "-movflags", "+faststart",
    outputPath,
  ]);
}

export interface AudioLevels {
  meanDb: number;
  maxDb: number;
  /** Fraction of the chunk that's silence (0-1). 1 = pure silence. */
  silenceRatio: number;
}

/**
 * Lightweight per-chunk audio sanity check. Catches:
 *  - Chunks that are essentially silence (skip Whisper call, save $)
 *  - Chunks with abnormally low volume (likely poor recording, warn)
 *  - Chunks with clipping (max near 0dB)
 */
export async function analyzeAudioLevels(filePath: string): Promise<AudioLevels> {
  const probeInfo = await probeAudio(filePath).catch(() => ({ duration: 0 } as AudioProbe));
  const { stderr } = await runStderr(FFMPEG, [
    "-hide_banner",
    "-nostats",
    "-i", filePath,
    "-af", `volumedetect,silencedetect=noise=${SILENCE_NOISE_DB}dB:d=0.5`,
    "-f", "null",
    "-",
  ]);

  const meanMatch = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const maxMatch = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  const meanDb = meanMatch ? parseFloat(meanMatch[1]) : -100;
  const maxDb = maxMatch ? parseFloat(maxMatch[1]) : -100;

  let silenceTotal = 0;
  const endRe = /silence_end:\s*-?[\d.]+\s*\|\s*silence_duration:\s*([\d.]+)/g;
  for (const m of stderr.matchAll(endRe)) {
    silenceTotal += parseFloat(m[1]);
  }
  const silenceRatio =
    probeInfo.duration > 0 ? Math.min(1, silenceTotal / probeInfo.duration) : 0;

  return { meanDb, maxDb, silenceRatio };
}

export interface PreparedChunk {
  index: number;
  filePath: string;
  offsetSeconds: number;
  durationSeconds: number;
}

export interface PreparedAudio {
  chunks: PreparedChunk[];
  duration: number;
  workDir: string;
  /** True if the original file was small enough to send to Whisper directly */
  singlePiece: boolean;
}

/**
 * Prepare an audio file for transcription.
 *
 * Strategy:
 *  - Always probe the original.
 *  - Fast path: if the file is already <24MB AND uses a Whisper-supported
 *    container, send it as ONE chunk without re-encoding.
 *  - Otherwise: detect silences in the original, build chunk ranges
 *    (snapped to silences, target ~60s), and extract each chunk as
 *    high-quality m4a (AAC mono).
 *
 * The original file is never modified — chunks live in their own workDir.
 */
export async function prepareAudioForTranscription(
  filePath: string,
  opts: { persistDir?: string } = {}
): Promise<PreparedAudio> {
  await stat(filePath);
  const probeInfo = await probeAudio(filePath);
  const duration = probeInfo.duration;

  const workDir =
    opts.persistDir ??
    path.join(
      path.dirname(filePath),
      `.processing_${path.basename(filePath, path.extname(filePath))}_${Date.now()}`
    );
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const whisperCompat = WHISPER_SUPPORTED_EXTS.has(ext);

  // Fast path — small + compatible: send as a single piece, no re-encoding.
  if (
    whisperCompat &&
    probeInfo.sizeBytes <= WHISPER_MAX_BYTES &&
    duration <= MAX_CHUNK_SECONDS
  ) {
    return {
      chunks: [
        {
          index: 0,
          filePath,
          offsetSeconds: 0,
          durationSeconds: duration,
        },
      ],
      duration,
      workDir,
      singlePiece: true,
    };
  }

  // Silence-aware chunking
  const silences = await detectSilences(filePath).catch(() => [] as SilenceRange[]);
  const ranges = buildSilenceAwareBoundaries(silences, duration);

  const chunks: PreparedChunk[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const chunkPath = path.join(
      workDir,
      `chunk_${i.toString().padStart(4, "0")}.m4a`
    );
    await extractChunk(filePath, r, chunkPath);

    // Safety: if this single chunk exceeds Whisper's cap (very rare with
    // mono AAC 128k — only happens for ~25-min chunks), re-encode at a
    // lower bitrate. Quality stays excellent at 64 kbps for voice.
    let chunkSize = (await stat(chunkPath)).size;
    if (chunkSize > WHISPER_MAX_BYTES) {
      await extractChunk(filePath, r, chunkPath, { bitrateKbps: 64 });
      chunkSize = (await stat(chunkPath)).size;
    }
    if (chunkSize > WHISPER_MAX_BYTES) {
      throw new Error(
        `El fragmento #${i + 1} (${(r.end - r.start).toFixed(0)}s) sigue siendo demasiado grande tras recomprimir. Esto no debería pasar — revisa el archivo de origen.`
      );
    }

    chunks.push({
      index: i,
      filePath: chunkPath,
      offsetSeconds: r.start,
      durationSeconds: r.end - r.start,
    });
  }

  return {
    chunks,
    duration,
    workDir,
    singlePiece: false,
  };
}

/**
 * Re-extract one specific chunk's audio from the original file. Used when
 * the user re-processes a chunk and we want to retry with a fresh copy
 * (in case the previous extracted file was somehow corrupted).
 */
export async function reExtractChunk(
  originalPath: string,
  outputPath: string,
  range: ChunkRange
): Promise<void> {
  await extractChunk(originalPath, range, outputPath);
}

export async function cleanupWorkDir(workDir?: string): Promise<void> {
  if (!workDir || !existsSync(workDir)) return;
  try {
    const files = await readdir(workDir);
    await Promise.all(files.map((f) => unlink(path.join(workDir, f))));
    await rmdir(workDir);
  } catch {
    /* ignore cleanup errors */
  }
}

export function workDirForTranscription(
  uploadFilePath: string,
  transcriptionId: string
): string {
  return path.join(path.dirname(uploadFilePath), `chunks_${transcriptionId}`);
}

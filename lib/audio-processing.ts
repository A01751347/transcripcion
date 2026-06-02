import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// Whisper hard cap is 25MB, leave headroom
const TARGET_MAX_BYTES = 24 * 1024 * 1024;
const COMPRESSED_BITRATE_KBPS = 32; // mono 32kbps mp3 is plenty for speech
const CHUNK_SECONDS = 600; // 10 min chunks

// Whisper API only accepts these extensions, so anything else MUST be
// transcoded before sending (e.g. iPhone Voice Memos with .qta extension).
const WHISPER_SUPPORTED_EXTS = new Set([
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "wav",
  "webm",
]);

function getExt(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function isWhisperCompatibleExt(filePath: string): boolean {
  return WHISPER_SUPPORTED_EXTS.has(getExt(filePath));
}

function run(
  cmd: string,
  args: string[],
  opts: { silent?: boolean } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: opts.silent ? "ignore" : "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${path.basename(cmd)} exited with code ${code}: ${stderr.slice(-500)}`
          )
        );
    });
  });
}

function runJson(cmd: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e}`));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function probeAudio(
  filePath: string
): Promise<{ duration: number; bitRate?: number }> {
  const data = await runJson(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,bit_rate",
    "-of",
    "json",
    filePath,
  ]);
  const duration = parseFloat(data?.format?.duration ?? "0");
  const bitRate = data?.format?.bit_rate
    ? parseInt(data.format.bit_rate, 10)
    : undefined;
  return { duration, bitRate };
}

/**
 * Compress audio to mono mp3 at low bitrate with speech-tuned filters.
 *
 * Filter chain:
 *  - highpass=200: cuts sub-bass rumble / HVAC / handling noise
 *  - lowpass=4000: speech doesn't need >4kHz; reduces hiss
 *  - dynaudnorm: gentle dynamic range compression so quiet voices come up
 *    and Whisper sees consistent levels
 *  - areverse → silenceremove → areverse: trims trailing silence ONLY,
 *    preserving leading-aligned timestamps so the audio player stays in
 *    sync with segment.start values.
 */
export async function compressAudio(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const filter = [
    "highpass=f=200",
    "lowpass=f=4000",
    "dynaudnorm=f=200:g=15",
    "areverse",
    "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:detection=peak",
    "areverse",
  ].join(",");

  await run(FFMPEG, [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    filter,
    "-b:a",
    `${COMPRESSED_BITRATE_KBPS}k`,
    "-c:a",
    "libmp3lame",
    outputPath,
  ]);
}

/**
 * Split an audio file into time-based chunks. Returns ordered chunk paths.
 */
export async function chunkAudio(
  inputPath: string,
  outDir: string,
  chunkSeconds = CHUNK_SECONDS
): Promise<string[]> {
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  const pattern = path.join(outDir, "chunk_%04d.mp3");

  await run(FFMPEG, [
    "-y",
    "-i",
    inputPath,
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    "-c",
    "copy",
    "-reset_timestamps",
    "1",
    pattern,
  ]);

  const files = await readdir(outDir);
  return files
    .filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(outDir, f));
}

export interface PreparedChunk {
  index: number;
  filePath: string;
  offsetSeconds: number;
  durationSeconds: number;
}

export interface PreparedAudio {
  /** Single-piece or multi-chunk, in order */
  chunks: PreparedChunk[];
  /** Total duration in seconds */
  duration: number;
  /** Directory where compressed/chunked files live (persistent) */
  workDir?: string;
  /** True if compression/chunking was applied */
  wasProcessed: boolean;
}

/**
 * Prepare an audio file for transcription with Whisper.
 *
 * Always runs the speech-tuned filter chain (highpass, lowpass, dynaudnorm,
 * trailing-silence-trim) and guarantees a Whisper-supported extension.
 *
 * If the compressed file exceeds 24MB it's split into 10-minute chunks.
 *
 * Persistence: by default the work files live in a temp dir adjacent to the
 * input file. Pass `persistDir` to keep them in a stable location so
 * individual chunks can later be re-transcribed without re-uploading or
 * re-running ffmpeg from scratch.
 */
export async function prepareAudioForTranscription(
  filePath: string,
  opts: { persistDir?: string } = {}
): Promise<PreparedAudio> {
  await stat(filePath);
  const { duration: probedDuration } = await probeAudio(filePath).catch(
    () => ({ duration: 0 })
  );

  const workDir =
    opts.persistDir ??
    path.join(
      path.dirname(filePath),
      `.processing_${path.basename(filePath, path.extname(filePath))}_${Date.now()}`
    );
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }

  const compressedPath = path.join(workDir, "compressed.mp3");
  await compressAudio(filePath, compressedPath);
  const compressedSize = (await stat(compressedPath)).size;
  const { duration: compressedDuration } = await probeAudio(
    compressedPath
  ).catch(() => ({ duration: probedDuration }));

  if (compressedSize <= TARGET_MAX_BYTES) {
    return {
      chunks: [
        {
          index: 0,
          filePath: compressedPath,
          offsetSeconds: 0,
          durationSeconds: compressedDuration,
        },
      ],
      duration: compressedDuration || probedDuration,
      workDir,
      wasProcessed: true,
    };
  }

  const chunkPaths = await chunkAudio(compressedPath, workDir, CHUNK_SECONDS);
  if (chunkPaths.length === 0) {
    throw new Error(
      "El audio no pudo ser dividido en segmentos. Intenta con un archivo más corto."
    );
  }

  const chunks: PreparedChunk[] = [];
  let cumulative = 0;
  for (let i = 0; i < chunkPaths.length; i++) {
    const { duration: d } = await probeAudio(chunkPaths[i]).catch(() => ({
      duration: CHUNK_SECONDS,
    }));
    chunks.push({
      index: i,
      filePath: chunkPaths[i],
      offsetSeconds: cumulative,
      durationSeconds: d,
    });
    cumulative += d;
  }

  return {
    chunks,
    duration: compressedDuration || cumulative || probedDuration,
    workDir,
    wasProcessed: true,
  };
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
  return path.join(
    path.dirname(uploadFilePath),
    `chunks_${transcriptionId}`
  );
}

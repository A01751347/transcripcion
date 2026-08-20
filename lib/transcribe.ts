import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { openai, TRANSCRIPTION_MODEL } from "./openai";
import { deloopText, deloopSegments } from "./text-cleanup";

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avgLogprob?: number;
  noSpeechProb?: number;
  compressionRatio?: number;
  temperature?: number;
}

export interface ChunkQuality {
  /** Mean avg_logprob across segments — anything < -1 is poor. */
  meanAvgLogprob: number;
  /** Max no_speech_prob — > 0.6 means likely silence/noise. */
  maxNoSpeechProb: number;
  /** Max compression_ratio — > 2.4 means heavy repetition (loop). */
  maxCompressionRatio: number;
  /** Words per second — < 0.4 on a chunk of real speech is suspicious. */
  wordsPerSecond: number;
  /** True if any individual quality signal crosses its red line. */
  isPoor: boolean;
  /** Temperature used to produce this result (final attempt). */
  temperature: number;
  /** How many attempts were made. */
  attempts: number;
}

export interface ChunkTranscriptResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptSegment[];
  quality: ChunkQuality;
}

interface TranscribeChunkOpts {
  language?: string;
  /** Initial prompt — pass last ~200 chars of previous chunk for context. */
  prompt?: string;
  /** Skip the temperature-fallback loop (used internally for re-runs). */
  fixedTemperature?: number;
}

const DEFAULT_PROMPT =
  "Transcripción profesional de una conversación en español natural. " +
  "Puede contener nombres propios, términos técnicos en inglés mezclados, " +
  "y diálogo entre varias personas. Usa puntuación correcta.";

// Quality thresholds — aligned with the Whisper paper's recommended values.
const POOR_LOGPROB = -1.0;
const POOR_NO_SPEECH = 0.6;
const POOR_COMPRESSION = 2.4;
const POOR_WPS = 0.4;

// Temperature fallback ladder. First attempt is deterministic (0); each
// subsequent attempt nudges temperature up. We bail after this list.
const TEMPERATURE_LADDER = [0, 0.2, 0.4, 0.6];

interface RawWhisperResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    no_speech_prob?: number;
    compression_ratio?: number;
    temperature?: number;
  }>;
}

async function callWhisperOnce(
  filePath: string,
  opts: { language?: string; prompt: string; temperature: number }
): Promise<RawWhisperResponse> {
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(filePath) as any,
    model: TRANSCRIPTION_MODEL,
    language: opts.language ?? "es",
    response_format: "verbose_json",
    prompt: opts.prompt,
    temperature: opts.temperature,
  } as any);
  return response as unknown as RawWhisperResponse;
}

function normalizeSegments(
  raw: RawWhisperResponse,
  temperature: number
): TranscriptSegment[] {
  return (raw.segments ?? []).map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
    avgLogprob: s.avg_logprob,
    noSpeechProb: s.no_speech_prob,
    compressionRatio: s.compression_ratio,
    temperature: s.temperature ?? temperature,
  }));
}

/**
 * Drop segments that the metadata clearly marks as junk:
 *  - High no_speech_prob AND low logprob → silence / noise misheard as words.
 *  - Very high compression_ratio → a loop ("gracias gracias gracias…").
 *
 * We're conservative: a segment must hit BOTH no_speech and logprob thresholds
 * to be dropped on those grounds, so we don't accidentally lose quiet but
 * real speech.
 */
function filterJunkSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((s) => {
    const noSpeech = s.noSpeechProb ?? 0;
    const logprob = s.avgLogprob ?? 0;
    const compr = s.compressionRatio ?? 0;
    const isSilenceMisheard = noSpeech > POOR_NO_SPEECH && logprob < POOR_LOGPROB;
    const isLoop = compr > POOR_COMPRESSION;
    return !isSilenceMisheard && !isLoop;
  });
}

function computeQuality(
  segments: TranscriptSegment[],
  durationSeconds: number,
  temperature: number,
  attempts: number
): ChunkQuality {
  if (segments.length === 0) {
    return {
      meanAvgLogprob: -10,
      maxNoSpeechProb: 1,
      maxCompressionRatio: 0,
      wordsPerSecond: 0,
      isPoor: true,
      temperature,
      attempts,
    };
  }
  const logprobs = segments.map((s) => s.avgLogprob ?? 0);
  const noSpeechs = segments.map((s) => s.noSpeechProb ?? 0);
  const comprs = segments.map((s) => s.compressionRatio ?? 0);
  const meanAvgLogprob =
    logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  const maxNoSpeechProb = Math.max(...noSpeechs);
  const maxCompressionRatio = Math.max(...comprs);
  const wordCount = segments
    .map((s) => s.text.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);
  const wordsPerSecond = durationSeconds > 0 ? wordCount / durationSeconds : 0;

  const isPoor =
    meanAvgLogprob < POOR_LOGPROB ||
    maxCompressionRatio > POOR_COMPRESSION ||
    (durationSeconds > 30 && wordsPerSecond < POOR_WPS);

  return {
    meanAvgLogprob,
    maxNoSpeechProb,
    maxCompressionRatio,
    wordsPerSecond,
    isPoor,
    temperature,
    attempts,
  };
}

/**
 * Transcribe a single audio file (or one chunk of a longer audio).
 *
 * Uses Whisper's recommended temperature-fallback algorithm: start at
 * temperature 0, and if the result has poor quality metrics (low logprob,
 * high compression ratio) retry at higher temperature. This is the same
 * algorithm OpenAI's reference implementation uses internally.
 *
 * Returns the transcript along with per-segment quality metadata so the
 * orchestrator can decide whether to flag the chunk for the user.
 */
export async function transcribeAudioChunk(
  filePath: string,
  opts: TranscribeChunkOpts = {}
): Promise<ChunkTranscriptResult> {
  await stat(filePath);
  const prompt = (opts.prompt ?? DEFAULT_PROMPT).slice(-800);

  const ladder = opts.fixedTemperature != null
    ? [opts.fixedTemperature]
    : TEMPERATURE_LADDER;

  let bestResult: {
    raw: RawWhisperResponse;
    segments: TranscriptSegment[];
    quality: ChunkQuality;
    temperature: number;
  } | null = null;

  let attempts = 0;
  for (const temperature of ladder) {
    attempts += 1;
    const raw = await callWhisperOnce(filePath, {
      language: opts.language,
      prompt,
      temperature,
    });
    const rawSegments = normalizeSegments(raw, temperature);
    // Probe duration from raw response if available, else fallback later.
    const duration = raw.duration ?? 0;
    const quality = computeQuality(rawSegments, duration, temperature, attempts);

    // Always keep the *best* attempt so we don't regress on a worse retry.
    if (!bestResult || quality.meanAvgLogprob > bestResult.quality.meanAvgLogprob) {
      bestResult = { raw, segments: rawSegments, quality, temperature };
    }
    if (!quality.isPoor) break;
  }

  if (!bestResult) {
    // Should be unreachable — ladder is non-empty.
    throw new Error("Whisper no devolvió ningún resultado.");
  }

  const { raw, segments, quality } = bestResult;
  const filteredSegments = filterJunkSegments(segments);

  // Build text from the *filtered* segments (so junk doesn't leak in).
  // If a chunk has no segments at all, fall back to raw text.
  const filteredText = filteredSegments.length > 0
    ? filteredSegments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim()
    : raw.text;

  // Final safety net: collapse residual loops the metadata didn't catch.
  const deloopedText = deloopText(filteredText);
  const deloopedSegments = deloopSegments(filteredSegments);

  // Re-compute quality on the final segments so the caller sees post-filter
  // metrics, not the raw ones.
  const finalQuality = computeQuality(
    deloopedSegments,
    raw.duration ?? 0,
    quality.temperature,
    quality.attempts
  );
  finalQuality.attempts = quality.attempts;

  return {
    text: deloopedText,
    language: raw.language,
    duration: raw.duration,
    segments: deloopedSegments,
    quality: finalQuality,
  };
}

export interface MergeInput {
  index: number;
  offsetSeconds: number;
  text: string;
  segments?: TranscriptSegment[];
}

/**
 * Merge ordered chunk results into a single transcription. Adjusts segment
 * timestamps by the chunk offset and renumbers segment ids.
 */
export function mergeChunks(chunks: MergeInput[]): {
  text: string;
  segments: TranscriptSegment[];
} {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const text = ordered
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join("\n\n");

  const segments: TranscriptSegment[] = [];
  let id = 0;
  for (const c of ordered) {
    if (!c.segments) continue;
    for (const s of c.segments) {
      segments.push({
        ...s,
        id: id++,
        start: s.start + c.offsetSeconds,
        end: s.end + c.offsetSeconds,
      });
    }
  }

  return { text, segments };
}

/**
 * Take the last N characters of a chunk to feed as the next chunk's prompt.
 * Whisper uses the prompt to bias toward consistent spelling of names,
 * acronyms, and to maintain conversational continuity at boundaries.
 */
export function rollingPromptFrom(previousText: string | null | undefined, maxChars = 240): string | undefined {
  if (!previousText) return undefined;
  const trimmed = previousText.trim();
  if (trimmed.length === 0) return undefined;
  // Try to end on a sentence boundary if possible
  const tail = trimmed.slice(-maxChars);
  const lastPunct = Math.max(
    tail.lastIndexOf("."),
    tail.lastIndexOf("?"),
    tail.lastIndexOf("!")
  );
  if (lastPunct > maxChars * 0.4) {
    return tail.slice(lastPunct + 1).trim() || tail;
  }
  return tail;
}

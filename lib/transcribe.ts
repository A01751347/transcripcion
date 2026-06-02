import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { openai, TRANSCRIPTION_MODEL } from "./openai";
import { deloopText, deloopSegments } from "./text-cleanup";

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface ChunkTranscriptResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptSegment[];
}

interface TranscribeChunkOpts {
  language?: string;
  prompt?: string;
}

const DEFAULT_PROMPT =
  "Transcripción profesional de una conversación en español natural. " +
  "Puede contener nombres propios, términos técnicos en inglés mezclados, " +
  "y diálogo entre varias personas.";

/**
 * Whisper call for a single audio file (single piece OR one chunk of a
 * multi-chunk transcription). Returns the deloop'd text + segments.
 */
export async function transcribeSingleFile(
  filePath: string,
  opts: TranscribeChunkOpts = {}
): Promise<ChunkTranscriptResult> {
  await stat(filePath);
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(filePath) as any,
    model: TRANSCRIPTION_MODEL,
    language: opts.language ?? "es",
    response_format: "verbose_json",
    prompt: opts.prompt ?? DEFAULT_PROMPT,
    temperature: 0,
  } as any);

  const data = response as unknown as {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{
      id: number;
      start: number;
      end: number;
      text: string;
    }>;
  };

  const rawSegments = data.segments?.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  return {
    text: deloopText(data.text),
    language: data.language,
    duration: data.duration,
    segments: rawSegments ? deloopSegments(rawSegments) : undefined,
  };
}

/**
 * Decide whether a chunk's result looks like a hallucination dump.
 * A chunk is "suspicious" if its post-deloop text is implausibly short
 * relative to its duration. Real speech averages ~2-3 words/second; even
 * slow speakers hit ~1 word/sec. Anything under 0.3 wps for a 10-min chunk
 * almost certainly means Whisper looped and our deloop wiped most of it.
 */
export function isChunkSuspicious(
  text: string,
  durationSeconds: number
): boolean {
  if (durationSeconds < 30) return false; // too short to judge
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const wordsPerSecond = wordCount / durationSeconds;
  return wordsPerSecond < 0.3;
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
        id: id++,
        start: s.start + c.offsetSeconds,
        end: s.end + c.offsetSeconds,
        text: s.text,
      });
    }
  }

  // Final cross-chunk deloop pass (catches loops that span boundaries)
  return {
    text: deloopText(text),
    segments: segments.length > 0 ? deloopSegments(segments) : segments,
  };
}

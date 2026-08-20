import { prisma } from "./db";
import {
  prepareAudioForTranscription,
  analyzeAudioLevels,
  workDirForTranscription,
} from "./audio-processing";
import {
  transcribeAudioChunk,
  mergeChunks,
  rollingPromptFrom,
  type ChunkTranscriptResult,
} from "./transcribe";
import { verifyChunksWithLLM, type ChunkVerdict } from "./text-verification";

// Limit concurrent Whisper calls to stay friendly with OpenAI rate limits
// and avoid hammering local CPU with parallel ffmpeg reads.
const TRANSCRIBE_CONCURRENCY = 5;

// Below this RMS the chunk is effectively silence — skip the Whisper call.
const SILENCE_MEAN_DB = -50;
const SILENCE_RATIO_THRESHOLD = 0.95;

/**
 * Run an async mapper over an array with a fixed concurrency cap.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Background job: full transcription pipeline.
 *
 * Phases:
 *  1. Prepare audio — silence-aware chunking, output as high-quality m4a.
 *  2. Audio sanity pass — skip Whisper for chunks that are pure silence.
 *  3. Transcribe each chunk (limited concurrency) with temperature-fallback
 *     and per-segment metadata-based junk filtering.
 *  4. Merge results into the parent Transcription.
 *  5. LLM verification — second opinion that flags chunks whose text doesn't
 *     make sense in context.
 *  6. Final merge using only chunks the LLM didn't reject as noise.
 *
 * If any phase throws, the chunks already written to DB stay there so the
 * user can re-process individual chunks from the UI.
 */
export function runTranscriptionInBackground(
  transcriptionId: string,
  filePath: string,
  language?: string | null
): void {
  void (async () => {
    try {
      // Reset any previous chunk state for re-runs
      await prisma.transcriptionChunk.deleteMany({
        where: { transcriptionId },
      });

      const workDir = workDirForTranscription(filePath, transcriptionId);
      const prepared = await prepareAudioForTranscription(filePath, {
        persistDir: workDir,
      });

      await prisma.transcription.update({
        where: { id: transcriptionId },
        data: { duration: prepared.duration, status: "PROCESSING" },
      });

      await prisma.$transaction(
        prepared.chunks.map((c) =>
          prisma.transcriptionChunk.create({
            data: {
              transcriptionId,
              index: c.index,
              filePath: c.filePath,
              offsetSeconds: c.offsetSeconds,
              durationSeconds: c.durationSeconds,
              status: "PROCESSING",
            },
          })
        )
      );

      // Phase 2+3: per-chunk audio sanity check + transcription
      await mapConcurrent(prepared.chunks, TRANSCRIBE_CONCURRENCY, async (c) => {
        await processChunk(transcriptionId, c.index, c.filePath, c.durationSeconds, language);
      });

      // Phase 4: first merge (raw, before LLM verification)
      await rebuildTranscriptionFromChunks(transcriptionId);

      // Phase 5: LLM second-opinion verification
      await runLlmVerificationPass(transcriptionId);

      // Phase 6: rebuild final text using verdicts to skip flagged noise chunks
      await rebuildTranscriptionFromChunks(transcriptionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[transcription:${transcriptionId}] failed:`, message);
      try {
        await prisma.transcription.update({
          where: { id: transcriptionId },
          data: { status: "FAILED", errorMsg: message },
        });
      } catch (dbErr) {
        console.error(
          `[transcription:${transcriptionId}] failed to record failure:`,
          dbErr
        );
      }
    }
  })();
}

/**
 * Re-transcribe a single chunk. When the user triggers a manual re-run we
 * also feed it neighbor context (rolling prompt) which the parallel
 * first-pass couldn't, so the second attempt has a real chance of doing
 * better than the first.
 */
export function rerunChunkInBackground(
  transcriptionId: string,
  chunkIndex: number,
  language?: string | null
): void {
  void (async () => {
    try {
      const chunk = await prisma.transcriptionChunk.findUnique({
        where: { transcriptionId_index: { transcriptionId, index: chunkIndex } },
      });
      if (!chunk) throw new Error(`Chunk ${chunkIndex} no encontrado`);

      // Pull previous chunk text (if any) for the rolling prompt
      const prev = await prisma.transcriptionChunk.findUnique({
        where: {
          transcriptionId_index: {
            transcriptionId,
            index: chunkIndex - 1,
          },
        },
        select: { rawText: true },
      });
      const prompt = rollingPromptFrom(prev?.rawText ?? undefined);

      await prisma.transcriptionChunk.update({
        where: { id: chunk.id },
        data: {
          status: "PROCESSING",
          rawText: null,
          segments: null as any,
          errorMsg: null,
          llmVerdict: null,
        },
      });

      await processChunk(
        transcriptionId,
        chunk.index,
        chunk.filePath,
        chunk.durationSeconds,
        language,
        { prompt }
      );

      await rebuildTranscriptionFromChunks(transcriptionId);
      // Re-run LLM verification on just this chunk (cheap)
      await runLlmVerificationPass(transcriptionId, { onlyIndex: chunkIndex });
      await rebuildTranscriptionFromChunks(transcriptionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[chunk:${transcriptionId}/${chunkIndex}] failed:`,
        message
      );
    }
  })();
}

async function processChunk(
  transcriptionId: string,
  index: number,
  filePath: string,
  durationSeconds: number,
  language?: string | null,
  opts: { prompt?: string } = {}
): Promise<void> {
  // Audio sanity pass — cheap; lets us skip Whisper for silent chunks
  const levels = await analyzeAudioLevels(filePath).catch(() => ({
    meanDb: -100,
    maxDb: -100,
    silenceRatio: 1,
  }));

  if (
    levels.silenceRatio >= SILENCE_RATIO_THRESHOLD ||
    levels.meanDb <= SILENCE_MEAN_DB
  ) {
    await prisma.transcriptionChunk.update({
      where: { transcriptionId_index: { transcriptionId, index } },
      data: {
        status: "NOISE",
        rawText: "",
        segments: [] as any,
        errorMsg: "Fragmento sin contenido de voz — silencio o ruido de fondo.",
        meanDb: levels.meanDb,
        silenceRatio: levels.silenceRatio,
        attempts: 0,
      },
    });
    return;
  }

  let result: ChunkTranscriptResult | null = null;
  let error: string | null = null;
  try {
    result = await transcribeAudioChunk(filePath, {
      language: language || "es",
      prompt: opts.prompt,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!result) {
    await prisma.transcriptionChunk.update({
      where: { transcriptionId_index: { transcriptionId, index } },
      data: {
        status: "FAILED",
        errorMsg: error,
        meanDb: levels.meanDb,
        silenceRatio: levels.silenceRatio,
      },
    });
    return;
  }

  const { quality } = result;

  await prisma.transcriptionChunk.update({
    where: { transcriptionId_index: { transcriptionId, index } },
    data: {
      status: quality.isPoor ? "SUSPICIOUS" : "COMPLETED",
      rawText: result.text,
      segments: result.segments as any,
      errorMsg: quality.isPoor
        ? buildQualityWarning(quality, durationSeconds)
        : null,
      avgLogprob: quality.meanAvgLogprob,
      noSpeechProb: quality.maxNoSpeechProb,
      compressionRatio: quality.maxCompressionRatio,
      wordsPerSecond: quality.wordsPerSecond,
      meanDb: levels.meanDb,
      silenceRatio: levels.silenceRatio,
      attempts: quality.attempts,
    },
  });
}

function buildQualityWarning(
  quality: {
    meanAvgLogprob: number;
    maxCompressionRatio: number;
    wordsPerSecond: number;
    attempts: number;
  },
  durationSeconds: number
): string {
  const reasons: string[] = [];
  if (quality.meanAvgLogprob < -1) {
    reasons.push(
      `confianza baja (avg_logprob ${quality.meanAvgLogprob.toFixed(2)})`
    );
  }
  if (quality.maxCompressionRatio > 2.4) {
    reasons.push(
      `repetición alta (compression_ratio ${quality.maxCompressionRatio.toFixed(1)})`
    );
  }
  if (durationSeconds > 30 && quality.wordsPerSecond < 0.4) {
    reasons.push(
      `densidad muy baja (${quality.wordsPerSecond.toFixed(2)} palabras/s)`
    );
  }
  const tail =
    quality.attempts > 1
      ? ` Se intentaron ${quality.attempts} pasadas con distintas temperaturas.`
      : "";
  return `Fragmento sospechoso: ${reasons.join(", ") || "métricas pobres"}.${tail} Considera re-procesarlo.`;
}

/**
 * Send all completed chunks to the LLM verifier and persist its verdicts.
 * `noise` flips the chunk to NOISE status (its text is excluded from the
 * final merge). `suspicious` keeps text but flags the chunk for retry.
 */
async function runLlmVerificationPass(
  transcriptionId: string,
  opts: { onlyIndex?: number } = {}
): Promise<void> {
  try {
    const chunks = await prisma.transcriptionChunk.findMany({
      where: { transcriptionId },
      orderBy: { index: "asc" },
    });

    // Only verify chunks that produced text. NOISE/FAILED have no text to
    // verify; SUSPICIOUS chunks get a second opinion too.
    const verifiable = chunks.filter(
      (c) =>
        (c.status === "COMPLETED" || c.status === "SUSPICIOUS") &&
        (c.rawText ?? "").trim().length > 0
    );
    if (verifiable.length === 0) return;

    const verdicts = await verifyChunksWithLLM(
      verifiable.map((c) => ({
        index: c.index,
        text: c.rawText ?? "",
        durationSeconds: c.durationSeconds,
      }))
    );

    for (const v of verdicts) {
      if (opts.onlyIndex != null && v.index !== opts.onlyIndex) continue;
      const chunk = chunks.find((c) => c.index === v.index);
      if (!chunk) continue;

      const newStatus = verdictToStatus(v.verdict, chunk.status);
      const note = buildLlmNote(v.verdict, v.reason);
      // Preserve existing errorMsg from Whisper quality check if LLM is fine
      const errorMsg =
        v.verdict === "ok"
          ? chunk.errorMsg // keep existing whisper warning if any
          : note;

      await prisma.transcriptionChunk.update({
        where: { id: chunk.id },
        data: {
          status: newStatus,
          llmVerdict: v.verdict,
          errorMsg,
        },
      });
    }
  } catch (err) {
    // LLM verification is best-effort — failures don't poison the transcription.
    console.error(
      `[transcription:${transcriptionId}] LLM verification failed:`,
      err instanceof Error ? err.message : err
    );
  }
}

function verdictToStatus(
  verdict: ChunkVerdict,
  currentStatus: string
): "COMPLETED" | "SUSPICIOUS" | "NOISE" {
  if (verdict === "noise") return "NOISE";
  if (verdict === "suspicious") return "SUSPICIOUS";
  // verdict ok: don't downgrade an existing SUSPICIOUS verdict from Whisper
  // metrics — the LLM said it's fine but Whisper's numbers said otherwise.
  // Keep SUSPICIOUS so the user still sees the flag.
  if (currentStatus === "SUSPICIOUS") return "SUSPICIOUS";
  return "COMPLETED";
}

function buildLlmNote(verdict: ChunkVerdict, reason?: string): string {
  if (verdict === "noise") {
    return `Verificación LLM: el fragmento no contiene contenido útil${reason ? ` — ${reason}` : ""}. Excluido del texto final.`;
  }
  if (verdict === "suspicious") {
    return `Verificación LLM: el texto no encaja con el contexto${reason ? ` — ${reason}` : ""}. Considera re-procesarlo.`;
  }
  return "";
}

/**
 * Recompute the parent Transcription's text/segments from the current chunks.
 * - NOISE chunks are excluded entirely.
 * - FAILED chunks have no text (already excluded).
 * - COMPLETED and SUSPICIOUS contribute their text (the user can re-process
 *   suspicious ones if they want, but we still show the best-effort result).
 */
async function rebuildTranscriptionFromChunks(
  transcriptionId: string
): Promise<void> {
  const chunks = await prisma.transcriptionChunk.findMany({
    where: { transcriptionId },
    orderBy: { index: "asc" },
  });

  if (chunks.length === 0) {
    await prisma.transcription.update({
      where: { id: transcriptionId },
      data: { status: "FAILED", errorMsg: "Sin fragmentos para mergear" },
    });
    return;
  }

  const usable = chunks.filter(
    (c) =>
      (c.status === "COMPLETED" || c.status === "SUSPICIOUS") &&
      (c.rawText ?? "").trim().length > 0
  );

  const merged = mergeChunks(
    usable.map((c) => ({
      index: c.index,
      offsetSeconds: c.offsetSeconds,
      text: c.rawText ?? "",
      segments: (c.segments as any) ?? undefined,
    }))
  );

  const allDone = chunks.every(
    (c) =>
      c.status === "COMPLETED" ||
      c.status === "FAILED" ||
      c.status === "SUSPICIOUS" ||
      c.status === "NOISE"
  );
  const allFailed = chunks.every((c) => c.status === "FAILED");
  const hasFailed = chunks.some((c) => c.status === "FAILED");
  const hasSuspicious = chunks.some((c) => c.status === "SUSPICIOUS");
  const noiseCount = chunks.filter((c) => c.status === "NOISE").length;

  const errorBits: string[] = [];
  if (hasFailed) errorBits.push("algunos fragmentos fallaron");
  if (hasSuspicious) errorBits.push("algunos fragmentos parecen sospechosos");
  if (noiseCount > 0)
    errorBits.push(
      `${noiseCount} fragmento${noiseCount === 1 ? "" : "s"} excluido${noiseCount === 1 ? "" : "s"} por ser ruido/silencio`
    );

  await prisma.transcription.update({
    where: { id: transcriptionId },
    data: {
      status: allFailed ? "FAILED" : allDone ? "COMPLETED" : "PROCESSING",
      rawText: merged.text || null,
      segments: merged.segments as any,
      errorMsg: allFailed
        ? "Todos los fragmentos fallaron"
        : errorBits.length > 0
          ? `${errorBits.join("; ")} — revisa el panel de fragmentos para re-procesar.`
          : null,
    },
  });
}

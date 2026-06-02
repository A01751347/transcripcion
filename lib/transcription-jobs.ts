import { prisma } from "./db";
import {
  prepareAudioForTranscription,
  workDirForTranscription,
} from "./audio-processing";
import {
  transcribeSingleFile,
  isChunkSuspicious,
  mergeChunks,
  type ChunkTranscriptResult,
} from "./transcribe";

/**
 * Fire-and-forget background transcription for the initial upload.
 *
 * Pipeline:
 *  1. prepareAudioForTranscription → persistent workDir with compressed mp3
 *     (or N chunks if >24MB compressed)
 *  2. Create TranscriptionChunk rows in DB (status PENDING)
 *  3. Process each chunk in parallel; each one writes its own text/segments
 *  4. When all chunks settle, re-merge and persist to the Transcription row
 *
 * If the process dies mid-flight, individual chunk rows hold their state
 * and the user can re-process the failed ones from the UI.
 */
export function runTranscriptionInBackground(
  transcriptionId: string,
  filePath: string,
  language?: string | null
): void {
  void (async () => {
    try {
      // Clean up any previous chunk state and on-disk artifacts so a re-run
      // starts fresh.
      await prisma.transcriptionChunk.deleteMany({
        where: { transcriptionId },
      });

      const workDir = workDirForTranscription(filePath, transcriptionId);
      const prepared = await prepareAudioForTranscription(filePath, {
        persistDir: workDir,
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

      await prisma.transcription.update({
        where: { id: transcriptionId },
        data: {
          duration: prepared.duration,
        },
      });

      // Transcribe all chunks in parallel
      await Promise.all(
        prepared.chunks.map((c) =>
          processChunk(transcriptionId, c.index, c.filePath, c.durationSeconds, language)
        )
      );

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
 * Re-transcribe a single chunk by index. Used by the UI "Re-procesar
 * este fragmento" button. After it completes, the parent transcription
 * gets re-merged automatically.
 */
export function rerunChunkInBackground(
  transcriptionId: string,
  chunkIndex: number,
  language?: string | null
): void {
  void (async () => {
    try {
      const chunk = await prisma.transcriptionChunk.findUnique({
        where: {
          transcriptionId_index: { transcriptionId, index: chunkIndex },
        },
      });
      if (!chunk) {
        throw new Error(`Chunk ${chunkIndex} no encontrado`);
      }

      await prisma.transcriptionChunk.update({
        where: { id: chunk.id },
        data: {
          status: "PROCESSING",
          rawText: null,
          segments: null as any,
          errorMsg: null,
        },
      });

      await processChunk(
        transcriptionId,
        chunk.index,
        chunk.filePath,
        chunk.durationSeconds,
        language
      );

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
  language?: string | null
): Promise<void> {
  let result: ChunkTranscriptResult | null = null;
  let error: string | null = null;

  try {
    result = await transcribeSingleFile(filePath, {
      language: language || "es",
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!result) {
    await prisma.transcriptionChunk.update({
      where: {
        transcriptionId_index: { transcriptionId, index },
      },
      data: {
        status: "FAILED",
        errorMsg: error,
      },
    });
    return;
  }

  const suspicious = isChunkSuspicious(result.text, durationSeconds);

  await prisma.transcriptionChunk.update({
    where: {
      transcriptionId_index: { transcriptionId, index },
    },
    data: {
      status: suspicious ? "SUSPICIOUS" : "COMPLETED",
      rawText: result.text,
      segments: result.segments as any,
      errorMsg: suspicious
        ? "Densidad de palabras muy baja — posible alucinación de Whisper. Considera re-procesar este fragmento."
        : null,
    },
  });
}

/**
 * Recompute the parent Transcription's rawText/segments/status from the
 * current state of its chunks. Called after the initial run and after
 * any single-chunk re-run.
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
      (c.status === "COMPLETED" || c.status === "SUSPICIOUS") && c.rawText
  );

  const merged = mergeChunks(
    usable.map((c) => ({
      index: c.index,
      offsetSeconds: c.offsetSeconds,
      text: c.rawText ?? "",
      segments: (c.segments as any) ?? undefined,
    }))
  );

  const hasFailed = chunks.some((c) => c.status === "FAILED");
  const hasSuspicious = chunks.some((c) => c.status === "SUSPICIOUS");
  const allDone = chunks.every(
    (c) =>
      c.status === "COMPLETED" ||
      c.status === "FAILED" ||
      c.status === "SUSPICIOUS"
  );

  // Parent status:
  //  - FAILED if every chunk failed
  //  - COMPLETED otherwise (even with some failures/suspicious — the user
  //    sees the partial result and a banner inviting them to re-run the
  //    bad fragments)
  const allFailed = chunks.every((c) => c.status === "FAILED");

  await prisma.transcription.update({
    where: { id: transcriptionId },
    data: {
      status: allFailed ? "FAILED" : allDone ? "COMPLETED" : "PROCESSING",
      rawText: merged.text || null,
      segments: merged.segments as any,
      errorMsg: allFailed
        ? "Todos los fragmentos fallaron"
        : hasFailed
          ? "Algunos fragmentos fallaron — re-procesa desde el panel"
          : hasSuspicious
            ? "Algunos fragmentos parecen alucinaciones — re-procesa desde el panel"
            : null,
    },
  });
}

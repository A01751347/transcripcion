import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { runTranscriptionInBackground } from "@/lib/transcription-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-run transcription on an existing recording using the current pipeline.
 * Useful after improving the audio-processing or deloop logic to clean up
 * older transcripts without having to delete and re-upload.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = await prisma.transcription.findUnique({ where: { id } });

  if (!t) {
    return NextResponse.json(
      { error: "Transcripción no encontrada." },
      { status: 404 }
    );
  }

  if (!existsSync(t.filePath)) {
    return NextResponse.json(
      {
        error:
          "El archivo de audio ya no existe en disco. Re-súbelo para transcribir de nuevo.",
      },
      { status: 410 }
    );
  }

  // Reset transcript fields and mark as processing again. The background
  // job will rebuild chunks from scratch and flip status to COMPLETED or
  // FAILED when done.
  await prisma.transcription.update({
    where: { id },
    data: {
      status: "PROCESSING",
      rawText: null,
      segments: null as any,
      errorMsg: null,
    },
  });

  runTranscriptionInBackground(id, t.filePath, t.language);

  return NextResponse.json({ ok: true });
}

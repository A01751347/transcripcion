import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { rerunChunkInBackground } from "@/lib/transcription-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const { id, index: indexStr } = await params;
  const index = parseInt(indexStr, 10);
  if (Number.isNaN(index)) {
    return NextResponse.json(
      { error: "Índice de fragmento inválido." },
      { status: 400 }
    );
  }

  const chunk = await prisma.transcriptionChunk.findUnique({
    where: { transcriptionId_index: { transcriptionId: id, index } },
  });
  if (!chunk) {
    return NextResponse.json(
      { error: "Fragmento no encontrado." },
      { status: 404 }
    );
  }
  if (!existsSync(chunk.filePath)) {
    return NextResponse.json(
      {
        error:
          "El archivo del fragmento ya no está en disco. Re-procesa la transcripción completa para regenerarlo.",
      },
      { status: 410 }
    );
  }

  const t = await prisma.transcription.findUnique({ where: { id } });

  rerunChunkInBackground(id, index, t?.language);

  await prisma.transcription.update({
    where: { id },
    data: { status: "PROCESSING" },
  });

  return NextResponse.json({ ok: true });
}

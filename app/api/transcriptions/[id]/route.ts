import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { updateTranscriptionSchema } from "@/lib/validators";
import {
  cleanupWorkDir,
  workDirForTranscription,
} from "@/lib/audio-processing";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const transcription = await prisma.transcription.findUnique({
    where: { id },
    include: {
      folder: true,
      summary: true,
      keyPoints: { orderBy: [{ importance: "desc" }, { order: "asc" }] },
      chatMessages: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      tags: true,
    },
  });

  if (!transcription) {
    return NextResponse.json(
      { error: "Transcripción no encontrada." },
      { status: 404 }
    );
  }

  return NextResponse.json({ transcription });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateTranscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const transcription = await prisma.transcription.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ transcription });
}

export async function DELETE(
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

  try {
    await unlink(t.filePath);
  } catch {
    // ignore file unlink errors
  }
  await cleanupWorkDir(workDirForTranscription(t.filePath, id));

  await prisma.transcription.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

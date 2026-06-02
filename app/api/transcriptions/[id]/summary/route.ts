import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateSummary } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const transcription = await prisma.transcription.findUnique({
    where: { id },
  });
  if (!transcription?.rawText) {
    return NextResponse.json(
      { error: "La transcripción aún no tiene texto." },
      { status: 400 }
    );
  }

  try {
    const result = await generateSummary(transcription.rawText);
    const summary = await prisma.summary.upsert({
      where: { transcriptionId: id },
      create: { transcriptionId: id, ...result },
      update: { ...result },
    });
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

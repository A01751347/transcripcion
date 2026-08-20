import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chunks = await prisma.transcriptionChunk.findMany({
    where: { transcriptionId: id },
    orderBy: { index: "asc" },
    select: {
      id: true,
      index: true,
      offsetSeconds: true,
      durationSeconds: true,
      status: true,
      rawText: true,
      errorMsg: true,
      avgLogprob: true,
      noSpeechProb: true,
      compressionRatio: true,
      wordsPerSecond: true,
      meanDb: true,
      silenceRatio: true,
      attempts: true,
      llmVerdict: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ chunks });
}

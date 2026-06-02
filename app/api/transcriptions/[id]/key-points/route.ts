import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateKeyPoints } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const keyPoints = await prisma.keyPoint.findMany({
    where: { transcriptionId: id },
    orderBy: [{ importance: "desc" }, { order: "asc" }],
  });
  return NextResponse.json({ keyPoints });
}

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
    const points = await generateKeyPoints(transcription.rawText);

    await prisma.keyPoint.deleteMany({ where: { transcriptionId: id } });
    await prisma.keyPoint.createMany({
      data: points.map((p, idx) => ({
        transcriptionId: id,
        content: p.content,
        category: p.category,
        importance: p.importance,
        timestamp: p.timestamp,
        order: idx,
      })),
    });

    const created = await prisma.keyPoint.findMany({
      where: { transcriptionId: id },
      orderBy: [{ importance: "desc" }, { order: "asc" }],
    });

    return NextResponse.json({ keyPoints: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

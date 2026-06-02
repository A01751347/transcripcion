import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const [total, completed, processing, failed, durationAgg, folderCount] =
    await Promise.all([
      prisma.transcription.count(),
      prisma.transcription.count({ where: { status: "COMPLETED" } }),
      prisma.transcription.count({ where: { status: "PROCESSING" } }),
      prisma.transcription.count({ where: { status: "FAILED" } }),
      prisma.transcription.aggregate({ _sum: { duration: true } }),
      prisma.folder.count(),
    ]);

  return NextResponse.json({
    total,
    completed,
    processing,
    failed,
    folderCount,
    totalDurationSeconds: durationAgg._sum.duration ?? 0,
  });
}

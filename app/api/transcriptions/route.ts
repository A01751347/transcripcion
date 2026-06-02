import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveUploadedFile } from "@/lib/storage";
import { runTranscriptionInBackground } from "@/lib/transcription-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const folderId = searchParams.get("folderId");
  const q = searchParams.get("q");
  const status = searchParams.get("status");

  const transcriptions = await prisma.transcription.findMany({
    where: {
      folderId: folderId ?? undefined,
      status: status ? (status as any) : undefined,
      OR: q
        ? [
            { title: { contains: q, mode: "insensitive" } },
            { rawText: { contains: q, mode: "insensitive" } },
          ]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: {
      folder: true,
      summary: { select: { shortSummary: true } },
      _count: { select: { keyPoints: true, chatMessages: true, notes: true } },
    },
  });

  return NextResponse.json({ transcriptions });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null) ?? "";
    const folderId = formData.get("folderId") as string | null;
    const language = formData.get("language") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Falta el archivo de audio." },
        { status: 400 }
      );
    }

    // 2GB sanity ceiling — real Whisper compatibility is handled by
    // prepareAudioForTranscription (compress + chunk). MAX_UPLOAD_MB in .env
    // is optional and only used to lower this ceiling further.
    const envMax = Number(process.env.MAX_UPLOAD_MB);
    const maxMb = Number.isFinite(envMax) && envMax > 0 ? envMax : 2048;
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json(
        {
          error: `El archivo (${(file.size / 1024 / 1024).toFixed(1)} MB) excede el límite configurado (${maxMb} MB). Aumenta MAX_UPLOAD_MB en .env o quita la variable.`,
        },
        { status: 400 }
      );
    }

    const { filePath, fileName, fileSize } = await saveUploadedFile(file);

    const transcription = await prisma.transcription.create({
      data: {
        title: title || file.name.replace(/\.[^.]+$/, ""),
        fileName,
        filePath,
        fileSize,
        mimeType: file.type || "audio/mpeg",
        folderId: folderId || null,
        status: "PROCESSING",
      },
    });

    // Kick off transcription in the background and return immediately.
    // The UI polls /api/transcriptions/[id] until status flips to
    // COMPLETED or FAILED.
    runTranscriptionInBackground(transcription.id, filePath, language);

    return NextResponse.json({ transcription });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = await prisma.transcription.findUnique({ where: { id } });
  if (!t) {
    return new Response("Not found", { status: 404 });
  }

  const stats = await stat(t.filePath);
  const range = req.headers.get("range");

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
    const chunkSize = end - start + 1;
    const stream = createReadStream(t.filePath, { start, end });

    return new Response(stream as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize.toString(),
        "Content-Type": t.mimeType || "audio/mpeg",
      },
    });
  }

  const stream = createReadStream(t.filePath);
  return new Response(stream as any, {
    headers: {
      "Content-Length": stats.size.toString(),
      "Content-Type": t.mimeType || "audio/mpeg",
      "Accept-Ranges": "bytes",
    },
  });
}

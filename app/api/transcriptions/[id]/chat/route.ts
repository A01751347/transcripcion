import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chatWithTranscription } from "@/lib/analysis";
import { chatSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messages = await prisma.chatMessage.findMany({
    where: { transcriptionId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Mensaje inválido." }, { status: 400 });
  }

  const transcription = await prisma.transcription.findUnique({
    where: { id },
    include: { chatMessages: { orderBy: { createdAt: "asc" }, take: 20 } },
  });
  if (!transcription?.rawText) {
    return NextResponse.json(
      { error: "La transcripción aún no tiene texto." },
      { status: 400 }
    );
  }

  await prisma.chatMessage.create({
    data: {
      transcriptionId: id,
      role: "user",
      content: parsed.data.message,
    },
  });

  try {
    const reply = await chatWithTranscription(
      transcription.rawText,
      transcription.chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      parsed.data.message
    );

    const assistantMsg = await prisma.chatMessage.create({
      data: {
        transcriptionId: id,
        role: "assistant",
        content: reply,
      },
    });

    return NextResponse.json({ message: assistantMsg });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.chatMessage.deleteMany({ where: { transcriptionId: id } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { noteSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const notes = await prisma.note.findMany({
    where: { transcriptionId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ notes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nota inválida." }, { status: 400 });
  }

  const note = await prisma.note.create({
    data: { transcriptionId: id, ...parsed.data },
  });
  return NextResponse.json({ note });
}

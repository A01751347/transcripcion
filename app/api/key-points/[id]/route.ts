import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { keyPointUpdateSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = keyPointUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos." },
      { status: 400 }
    );
  }
  const keyPoint = await prisma.keyPoint.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ keyPoint });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.keyPoint.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

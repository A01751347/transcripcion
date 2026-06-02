import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createFolderSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET() {
  const folders = await prisma.folder.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { transcriptions: true } } },
  });
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const folder = await prisma.folder.create({ data: parsed.data });
  return NextResponse.json({ folder });
}

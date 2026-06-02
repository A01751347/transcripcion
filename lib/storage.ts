import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function ensureUploadDir(): Promise<string> {
  const abs = path.resolve(UPLOAD_DIR);
  if (!existsSync(abs)) {
    await mkdir(abs, { recursive: true });
  }
  return abs;
}

export async function saveUploadedFile(
  file: File,
  prefix = ""
): Promise<{ filePath: string; fileName: string; fileSize: number }> {
  const dir = await ensureUploadDir();
  const ext = file.name.split(".").pop() ?? "bin";
  const base = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 60);
  const id = Math.random().toString(36).slice(2, 10);
  const fileName = `${prefix}${base}_${id}.${ext}`;
  const filePath = path.join(dir, fileName);

  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  return {
    filePath,
    fileName,
    fileSize: file.size,
  };
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds && seconds !== 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffH < 24) return `hace ${diffH} h`;
  if (diffD < 7) return `hace ${diffD} d`;
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export const COMMON_AUDIO_EXTENSIONS = [
  "mp3",
  "mp4",
  "m4a",
  "wav",
  "ogg",
  "oga",
  "opus",
  "webm",
  "flac",
  "aac",
  "wma",
  "amr",
  "aiff",
  "aif",
  "mpeg",
  "mpga",
  "mov",
  "qt",
  "qta",
  "3gp",
  "3gpp",
  "mka",
];

// Permissive — accept anything that looks remotely like audio/video. The
// backend will run ffprobe on it and reject if it's not a readable container.
export function isAudioFile(file: { type: string; name: string }): boolean {
  if (file.type?.startsWith("audio/") || file.type?.startsWith("video/")) {
    return true;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  // Allow anything we explicitly know, plus any short extension we don't
  // recognize — ffprobe will be the source of truth.
  if (COMMON_AUDIO_EXTENSIONS.includes(ext)) return true;
  // Don't accept obvious non-audio types
  const blocked = ["exe", "dll", "zip", "rar", "tar", "gz", "pdf", "docx", "xlsx", "pptx", "txt", "jpg", "jpeg", "png", "gif", "html", "json", "js", "ts"];
  if (blocked.includes(ext)) return false;
  return ext.length <= 6;
}

export function truncate(text: string, max = 150): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "…";
}

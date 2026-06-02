"use client";
import Link from "next/link";
import {
  AudioLines,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  StickyNote,
  Target,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  cn,
  formatDuration,
  formatRelativeDate,
  truncate,
} from "@/lib/utils";

interface TranscriptionCardProps {
  t: {
    id: string;
    title: string;
    status: string;
    language?: string | null;
    duration?: number | null;
    createdAt: string | Date;
    folder?: { name: string; color?: string | null } | null;
    summary?: { shortSummary: string } | null;
    _count?: { keyPoints: number; chatMessages: number; notes: number };
    rawText?: string | null;
  };
}

const STATUS_CONFIG = {
  COMPLETED: {
    label: "Listo",
    icon: CheckCircle2,
    variant: "success" as const,
  },
  PROCESSING: {
    label: "Procesando",
    icon: Loader2,
    variant: "info" as const,
  },
  PENDING: {
    label: "Pendiente",
    icon: Clock,
    variant: "warning" as const,
  },
  FAILED: {
    label: "Error",
    icon: XCircle,
    variant: "destructive" as const,
  },
};

export function TranscriptionCard({ t }: TranscriptionCardProps) {
  const cfg =
    STATUS_CONFIG[t.status as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;

  return (
    <Link href={`/transcriptions/${t.id}`}>
      <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold leading-tight group-hover:text-primary transition-colors line-clamp-2">
                {t.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {formatRelativeDate(t.createdAt)}
              </p>
            </div>
            <Badge variant={cfg.variant} className="shrink-0">
              <Icon
                className={cn(
                  "h-3 w-3 mr-1",
                  t.status === "PROCESSING" && "animate-spin"
                )}
              />
              {cfg.label}
            </Badge>
          </div>

          {t.summary?.shortSummary ? (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {t.summary.shortSummary}
            </p>
          ) : t.rawText ? (
            <p className="text-sm text-muted-foreground line-clamp-2 italic">
              {truncate(t.rawText, 140)}
            </p>
          ) : t.status === "PROCESSING" ? (
            <p className="text-sm text-muted-foreground italic">
              Transcribiendo con Whisper…
            </p>
          ) : null}

          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t">
            <div className="flex items-center gap-1">
              <AudioLines className="h-3 w-3" />
              {formatDuration(t.duration)}
            </div>
            {t._count?.keyPoints ? (
              <div className="flex items-center gap-1">
                <Target className="h-3 w-3" />
                {t._count.keyPoints}
              </div>
            ) : null}
            {t._count?.chatMessages ? (
              <div className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {t._count.chatMessages}
              </div>
            ) : null}
            {t._count?.notes ? (
              <div className="flex items-center gap-1">
                <StickyNote className="h-3 w-3" />
                {t._count.notes}
              </div>
            ) : null}
            {t.folder && (
              <div
                className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  backgroundColor: `${t.folder.color}20`,
                  color: t.folder.color ?? undefined,
                }}
              >
                {t.folder.name}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

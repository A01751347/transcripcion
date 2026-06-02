"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  MoreVertical,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AudioPlayer } from "@/components/audio-player";
import { TranscriptView } from "@/components/transcript-view";
import { SummarySection } from "@/components/summary-section";
import { KeyPointsSection } from "@/components/key-points-section";
import { ChatSection } from "@/components/chat-section";
import { NotesSection } from "@/components/notes-section";
import { ChunksSection } from "@/components/chunks-section";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatRelativeDate, cn } from "@/lib/utils";

const STATUS_BADGE = {
  COMPLETED: { label: "Listo", icon: CheckCircle2, variant: "success" as const },
  PROCESSING: { label: "Procesando", icon: Loader2, variant: "info" as const },
  PENDING: { label: "Pendiente", icon: Clock, variant: "warning" as const },
  FAILED: { label: "Error", icon: XCircle, variant: "destructive" as const },
};

export function TranscriptionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [seekTo, setSeekTo] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState<number>(0);

  const { data, isLoading } = useQuery({
    queryKey: ["transcription", id],
    queryFn: async () => {
      const res = await fetch(`/api/transcriptions/${id}`);
      if (!res.ok) throw new Error("No encontrada");
      return res.json();
    },
    refetchInterval: (q) => {
      const status = (q.state.data as any)?.transcription?.status;
      return status === "PROCESSING" || status === "PENDING" ? 2500 : false;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/transcriptions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error eliminando");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Transcripción eliminada");
      router.push("/transcriptions");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retranscribe = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/transcriptions/${id}/retranscribe`, {
        method: "POST",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error re-procesando");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Re-procesando con el pipeline actual…");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const t = data?.transcription;
  if (!t) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">No se encontró la transcripción.</p>
        <Link href="/transcriptions">
          <Button variant="ghost" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
        </Link>
      </div>
    );
  }

  const cfg = STATUS_BADGE[t.status as keyof typeof STATUS_BADGE];
  const Icon = cfg.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0 flex-1">
          <Link href="/transcriptions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Transcripciones
            </Button>
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {t.title}
          </h1>
          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
            <Badge variant={cfg.variant}>
              <Icon
                className={cn(
                  "h-3 w-3 mr-1",
                  t.status === "PROCESSING" && "animate-spin"
                )}
              />
              {cfg.label}
            </Badge>
            <span>{formatRelativeDate(t.createdAt)}</span>
            <span>·</span>
            <span>{formatDuration(t.duration)}</span>
            {t.language && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {t.language}
                </span>
              </>
            )}
            {t.folder && (
              <span
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  backgroundColor: `${t.folder.color}20`,
                  color: t.folder.color ?? undefined,
                }}
              >
                {t.folder.name}
              </span>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                if (
                  confirm(
                    "Re-procesar el audio con el pipeline actual. Esto borra la transcripción actual y cuesta una nueva llamada a Whisper. ¿Continuar?"
                  )
                ) {
                  retranscribe.mutate();
                }
              }}
              disabled={
                retranscribe.isPending || t.status === "PROCESSING"
              }
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-procesar audio
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (confirm("¿Eliminar esta transcripción y su audio?")) {
                  remove.mutate();
                }
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {t.status === "PROCESSING" && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <div>
              <p className="font-medium text-sm">Procesando audio con Whisper…</p>
              <p className="text-xs text-muted-foreground">
                Esta página se actualiza sola cuando termine. Puedes cerrarla,
                el proceso sigue en background.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pl-8">
            <p>· Audios pequeños (&lt;25MB): ~5–30 segundos</p>
            <p>· Audios grandes: se comprimen + dividen en chunks de 10 min y se transcriben en paralelo</p>
            <p>· Una grabación de 1 hora suele tardar ~30s · 3 horas ~1–2 min</p>
          </div>
        </div>
      )}

      {t.status === "FAILED" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-1">
          <p className="font-medium text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            La transcripción falló
          </p>
          {t.errorMsg && (
            <p className="text-xs text-muted-foreground">{t.errorMsg}</p>
          )}
        </div>
      )}

      {t.status === "COMPLETED" && (
        <>
          <AudioPlayer
            src={`/api/transcriptions/${id}/audio`}
            seekTo={seekTo}
            onTimeUpdate={setCurrentTime}
          />

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Tabs defaultValue="transcript">
                <TabsList className="w-full grid grid-cols-5">
                  <TabsTrigger value="transcript">Texto</TabsTrigger>
                  <TabsTrigger value="summary">
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Resumen
                  </TabsTrigger>
                  <TabsTrigger value="keypoints">Puntos clave</TabsTrigger>
                  <TabsTrigger value="notes">Notas</TabsTrigger>
                  <TabsTrigger value="chunks">Fragmentos</TabsTrigger>
                </TabsList>

                <TabsContent value="transcript" className="mt-4">
                  <TranscriptView
                    rawText={t.rawText ?? ""}
                    segments={t.segments}
                    onSeek={setSeekTo}
                    currentTime={currentTime}
                    fileName={t.title}
                  />
                </TabsContent>

                <TabsContent value="summary" className="mt-4">
                  <SummarySection
                    transcriptionId={id}
                    summary={t.summary}
                  />
                </TabsContent>

                <TabsContent value="keypoints" className="mt-4">
                  <KeyPointsSection
                    transcriptionId={id}
                    keyPoints={t.keyPoints ?? []}
                    onSeek={setSeekTo}
                  />
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <NotesSection
                    transcriptionId={id}
                    notes={t.notes ?? []}
                  />
                </TabsContent>

                <TabsContent value="chunks" className="mt-4">
                  <ChunksSection
                    transcriptionId={id}
                    onSeek={setSeekTo}
                  />
                </TabsContent>
              </Tabs>
            </div>

            <div className="lg:col-span-1">
              <ChatSection
                transcriptionId={id}
                messages={t.chatMessages ?? []}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

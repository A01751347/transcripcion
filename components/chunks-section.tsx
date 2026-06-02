"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration, truncate } from "@/lib/utils";

interface Chunk {
  id: string;
  index: number;
  offsetSeconds: number;
  durationSeconds: number;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "SUSPICIOUS";
  rawText: string | null;
  errorMsg: string | null;
  updatedAt: string;
}

interface ChunksSectionProps {
  transcriptionId: string;
  onSeek?: (time: number) => void;
}

const STATUS_CONFIG = {
  COMPLETED: { label: "OK", icon: CheckCircle2, variant: "success" as const },
  PROCESSING: { label: "Procesando", icon: Loader2, variant: "info" as const, spin: true },
  PENDING: { label: "Pendiente", icon: Clock, variant: "warning" as const },
  SUSPICIOUS: {
    label: "Sospechoso",
    icon: AlertTriangle,
    variant: "warning" as const,
  },
  FAILED: { label: "Falló", icon: XCircle, variant: "destructive" as const },
};

export function ChunksSection({
  transcriptionId,
  onSeek,
}: ChunksSectionProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["chunks", transcriptionId],
    queryFn: async () => {
      const res = await fetch(
        `/api/transcriptions/${transcriptionId}/chunks`
      );
      return res.json();
    },
    refetchInterval: (q) => {
      const list = (q.state.data as any)?.chunks ?? [];
      const active = list.some(
        (c: Chunk) => c.status === "PROCESSING" || c.status === "PENDING"
      );
      return active ? 2500 : false;
    },
  });

  const retry = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(
        `/api/transcriptions/${transcriptionId}/chunks/${index}/retranscribe`,
        { method: "POST" }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Re-procesando fragmento…");
      queryClient.invalidateQueries({
        queryKey: ["chunks", transcriptionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["transcription", transcriptionId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const chunks = (data?.chunks ?? []) as Chunk[];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (chunks.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Este audio se procesó como una sola pieza, sin dividir en fragmentos.
        </CardContent>
      </Card>
    );
  }

  const problematic = chunks.filter(
    (c) => c.status === "FAILED" || c.status === "SUSPICIOUS"
  );

  return (
    <div className="space-y-3">
      {problematic.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <p className="font-medium text-sm">
                {problematic.length} fragmento{problematic.length === 1 ? "" : "s"} problemático{problematic.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                Whisper devolvió muy poco texto en estos rangos. Esto suele ocurrir
                cuando hay silencio largo, música o ruido bajo en esa parte del
                audio. Re-procesa solo los que fallaron — los demás se mantienen.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={retry.isPending}
                onClick={() => {
                  problematic.forEach((c) => retry.mutate(c.index));
                }}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Re-procesar {problematic.length} fragmento{problematic.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {chunks.map((c) => {
          const cfg = STATUS_CONFIG[c.status];
          const Icon = cfg.icon;
          return (
            <Card
              key={c.id}
              className={cn(
                c.status === "FAILED" &&
                  "border-destructive/30 bg-destructive/[0.02]",
                c.status === "SUSPICIOUS" &&
                  "border-amber-500/30 bg-amber-500/[0.03]"
              )}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-xs text-muted-foreground w-12">
                      #{(c.index + 1).toString().padStart(2, "0")}
                    </div>
                    <button
                      onClick={() => onSeek?.(c.offsetSeconds)}
                      className="text-sm tabular-nums hover:text-primary transition-colors"
                    >
                      {formatDuration(c.offsetSeconds)} →{" "}
                      {formatDuration(c.offsetSeconds + c.durationSeconds)}
                    </button>
                    <Badge variant={cfg.variant}>
                      <Icon
                        className={cn(
                          "h-3 w-3 mr-1",
                          "spin" in cfg && cfg.spin && "animate-spin"
                        )}
                      />
                      {cfg.label}
                    </Badge>
                  </div>

                  {(c.status === "FAILED" ||
                    c.status === "SUSPICIOUS" ||
                    c.status === "COMPLETED") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => retry.mutate(c.index)}
                      disabled={retry.isPending}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      Re-procesar
                    </Button>
                  )}
                </div>

                {c.errorMsg && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {c.errorMsg}
                  </p>
                )}

                {c.rawText && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {truncate(c.rawText, 240)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  Loader2,
  RefreshCw,
  Square,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration } from "@/lib/utils";

interface KeyPoint {
  id: string;
  content: string;
  category?: string | null;
  importance: number;
  timestamp?: number | null;
  done: boolean;
  order: number;
}

interface KeyPointsSectionProps {
  transcriptionId: string;
  keyPoints: KeyPoint[];
  onSeek?: (time: number) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  Acción: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  Decisión: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  Pregunta: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  Riesgo: "bg-red-500/15 text-red-700 dark:text-red-400",
  Idea: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Recordatorio: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  Dato: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

export function KeyPointsSection({
  transcriptionId,
  keyPoints,
  onSeek,
}: KeyPointsSectionProps) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["transcription", transcriptionId],
    });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/transcriptions/${transcriptionId}/key-points`,
        { method: "POST" }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error generando puntos");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Puntos clave generados");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = useMutation({
    mutationFn: async (p: KeyPoint) => {
      const res = await fetch(`/api/key-points/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !p.done }),
      });
      if (!res.ok) throw new Error("Error actualizando");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/key-points/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error eliminando");
      return res.json();
    },
    onSuccess: invalidate,
  });

  if (keyPoints.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-4 w-fit">
            <Target className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">Extrae los puntos clave</h3>
            <p className="text-sm text-muted-foreground">
              Identifica acciones, decisiones, ideas y datos importantes del
              audio. Marca lo que vayas completando.
            </p>
          </div>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            variant="gradient"
            size="lg"
          >
            {generate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analizando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Extraer puntos clave
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const done = keyPoints.filter((p) => p.done).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Puntos clave</h3>
          <Badge variant="outline" className="font-normal">
            {done} / {keyPoints.length} completos
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${
              generate.isPending ? "animate-spin" : ""
            }`}
          />
          Regenerar
        </Button>
      </div>

      <div className="space-y-2">
        {keyPoints.map((p) => (
          <Card
            key={p.id}
            className={cn(
              "transition-all group",
              p.done && "opacity-60 bg-muted/50"
            )}
          >
            <CardContent className="p-4 flex gap-3">
              <button
                onClick={() => toggle.mutate(p)}
                className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors"
              >
                {p.done ? (
                  <CheckSquare className="h-5 w-5 text-primary" />
                ) : (
                  <Square className="h-5 w-5" />
                )}
              </button>
              <div className="flex-1 min-w-0 space-y-2">
                <p
                  className={cn(
                    "text-sm leading-relaxed",
                    p.done && "line-through"
                  )}
                >
                  {p.content}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {p.category && (
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        CATEGORY_COLORS[p.category] ??
                          "bg-muted text-muted-foreground"
                      )}
                    >
                      {p.category}
                    </span>
                  )}
                  <div className="flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1.5 w-3 rounded-sm mx-px",
                          i < p.importance ? "bg-primary" : "bg-muted"
                        )}
                      />
                    ))}
                  </div>
                  {p.timestamp !== null && p.timestamp !== undefined && (
                    <button
                      onClick={() => onSeek?.(p.timestamp!)}
                      className="text-xs text-primary hover:underline tabular-nums"
                    >
                      {formatDuration(p.timestamp)}
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => remove.mutate(p.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

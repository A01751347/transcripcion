"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SummarySectionProps {
  transcriptionId: string;
  summary: {
    shortSummary: string;
    longSummary: string;
    topics: string[];
    sentiment?: string | null;
  } | null;
}

const SENTIMENT_COLORS: Record<string, "success" | "warning" | "destructive" | "info"> = {
  positivo: "success",
  neutral: "info",
  mixto: "warning",
  negativo: "destructive",
};

export function SummarySection({ transcriptionId, summary }: SummarySectionProps) {
  const queryClient = useQueryClient();

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/transcriptions/${transcriptionId}/summary`,
        { method: "POST" }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error generando resumen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Resumen generado");
      queryClient.invalidateQueries({
        queryKey: ["transcription", transcriptionId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-4 w-fit">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">Genera un resumen con IA</h3>
            <p className="text-sm text-muted-foreground">
              GPT-4 analizará la transcripción y producirá un resumen breve y
              detallado, junto con los temas clave.
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
                Generando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generar resumen
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Resumen breve</h3>
              {summary.sentiment && (
                <Badge
                  variant={
                    SENTIMENT_COLORS[summary.sentiment.toLowerCase()] ?? "outline"
                  }
                >
                  {summary.sentiment}
                </Badge>
              )}
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
          <p className="text-sm leading-relaxed">{summary.shortSummary}</p>

          {summary.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t">
              {summary.topics.map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-3">
          <h3 className="font-semibold">Resumen detallado</h3>
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-p:leading-relaxed prose-p:text-foreground/80">
            <ReactMarkdown>{summary.longSummary}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Copy, Download, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";

interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface TranscriptViewProps {
  rawText: string;
  segments?: Segment[] | null;
  onSeek?: (time: number) => void;
  currentTime?: number;
  fileName?: string;
}

export function TranscriptView({
  rawText,
  segments,
  onSeek,
  currentTime,
  fileName,
}: TranscriptViewProps) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"plain" | "segments">(
    segments && segments.length ? "segments" : "plain"
  );

  const copy = async () => {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
    toast.success("Texto copiado");
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([rawText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName ?? "transcripcion"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b p-3 flex-wrap gap-2">
        <div className="flex gap-1">
          <Button
            variant={view === "segments" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("segments")}
            disabled={!segments || segments.length === 0}
          >
            Con tiempos
          </Button>
          <Button
            variant={view === "plain" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("plain")}
          >
            Texto plano
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? (
              <Check className="h-4 w-4 mr-1.5" />
            ) : (
              <Copy className="h-4 w-4 mr-1.5" />
            )}
            Copiar
          </Button>
          <Button variant="ghost" size="sm" onClick={download}>
            <Download className="h-4 w-4 mr-1.5" />
            Descargar
          </Button>
        </div>
      </div>

      <div className="p-5 max-h-[600px] overflow-y-auto scrollbar-thin">
        {view === "plain" || !segments || segments.length === 0 ? (
          <p className="whitespace-pre-wrap leading-relaxed text-sm">
            {rawText}
          </p>
        ) : (
          <div className="space-y-2">
            {segments.map((s) => {
              const isActive =
                currentTime !== undefined &&
                currentTime >= s.start &&
                currentTime < s.end;
              return (
                <div
                  key={s.id}
                  className={`group flex gap-3 p-2 rounded-lg transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary/10 border-l-2 border-primary"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => onSeek?.(s.start)}
                >
                  <span className="text-xs font-mono text-muted-foreground tabular-nums pt-0.5 shrink-0 w-12">
                    {formatDuration(s.start)}
                  </span>
                  <p className="text-sm leading-relaxed flex-1">{s.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

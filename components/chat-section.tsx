"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Eraser,
  Loader2,
  MessageSquare,
  Send,
  User,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string | Date;
}

interface ChatSectionProps {
  transcriptionId: string;
  messages: ChatMessage[];
}

const SUGGESTIONS = [
  "¿Cuáles son los temas principales?",
  "Hazme un resumen ejecutivo en 5 viñetas.",
  "¿Qué acciones se acordaron?",
  "Extrae los nombres y números mencionados.",
  "Reescríbelo como un email profesional.",
];

export function ChatSection({ transcriptionId, messages }: ChatSectionProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["transcription", transcriptionId],
    });

  const send = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`/api/transcriptions/${transcriptionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error en la respuesta");
      }
      return res.json();
    },
    onSuccess: () => {
      setInput("");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/transcriptions/${transcriptionId}/chat`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Error limpiando");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Conversación reiniciada");
      invalidate();
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, send.isPending]);

  const handleSend = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || send.isPending) return;
    send.mutate(t);
  };

  return (
    <div className="flex flex-col h-[640px] rounded-xl border bg-card">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Conversa con el audio</h3>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            <Eraser className="h-3.5 w-3.5 mr-1.5" />
            Limpiar
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="text-center py-8 space-y-4">
            <div className="mx-auto rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-3 w-fit">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">
                Pregúntale lo que quieras al audio
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                GPT-4 responderá basándose en el contenido transcrito.
              </p>
            </div>
            <div className="flex flex-col gap-2 max-w-sm mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-left text-xs px-3 py-2 rounded-lg border bg-background hover:bg-accent transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex gap-2.5 animate-slide-up",
                m.role === "user" && "flex-row-reverse"
              )}
            >
              <div
                className={cn(
                  "shrink-0 rounded-full p-1.5 h-7 w-7 flex items-center justify-center",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"
                )}
              >
                {m.role === "user" ? (
                  <User className="h-3.5 w-3.5" />
                ) : (
                  <Bot className="h-3.5 w-3.5" />
                )}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%]",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {m.content}
                  </p>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {send.isPending && (
          <div className="flex gap-2.5 animate-fade-in">
            <div className="shrink-0 rounded-full p-1.5 h-7 w-7 flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-2xl px-3.5 py-2.5 bg-muted">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 space-y-2">
        <div className="flex gap-2">
          <Textarea
            placeholder="Pregunta sobre el audio…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={send.isPending}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          <Button
            onClick={() => handleSend()}
            disabled={send.isPending || !input.trim()}
            variant="gradient"
            size="icon"
            className="h-11 w-11 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          Enter para enviar · Shift+Enter para salto de línea
        </p>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeDate } from "@/lib/utils";

interface Note {
  id: string;
  content: string;
  createdAt: string | Date;
  timestamp?: number | null;
}

interface NotesSectionProps {
  transcriptionId: string;
  notes: Note[];
}

export function NotesSection({ transcriptionId, notes }: NotesSectionProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["transcription", transcriptionId],
    });

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/transcriptions/${transcriptionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error("Error guardando nota");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Nota guardada");
      setText("");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Nueva nota</h3>
          </div>
          <Textarea
            placeholder="Escribe una idea, reflexión o anotación libre…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[100px]"
          />
          <Button
            onClick={() => add.mutate()}
            disabled={!text.trim() || add.isPending}
            variant="gradient"
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Guardar nota
          </Button>
        </CardContent>
      </Card>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Aún no hay notas.
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <Card key={n.id} className="group">
              <CardContent className="p-4 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {n.content}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatRelativeDate(n.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => remove.mutate(n.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

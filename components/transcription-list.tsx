"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TranscriptionCard } from "@/components/transcription-card";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_FILTERS = [
  { value: "", label: "Todos" },
  { value: "COMPLETED", label: "Listos" },
  { value: "PROCESSING", label: "Procesando" },
  { value: "FAILED", label: "Errores" },
];

export function TranscriptionList() {
  const params = useSearchParams();
  const folderId = params.get("folderId") ?? "";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["transcriptions", { q, status, folderId }],
    queryFn: async () => {
      const url = new URL("/api/transcriptions", window.location.origin);
      if (q) url.searchParams.set("q", q);
      if (status) url.searchParams.set("status", status);
      if (folderId) url.searchParams.set("folderId", folderId);
      const res = await fetch(url);
      return res.json();
    },
    refetchInterval: (query) => {
      const list = (query.state.data as any)?.transcriptions ?? [];
      const hasActive = list.some(
        (t: any) => t.status === "PROCESSING" || t.status === "PENDING"
      );
      return hasActive ? 3000 : false;
    },
  });

  const transcriptions = data?.transcriptions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar en títulos y transcripciones…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                status === s.value
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : transcriptions.length === 0 ? (
        <div className="text-center py-20 space-y-3">
          <div className="text-5xl">🎙️</div>
          <h3 className="font-semibold">
            {q || status
              ? "No hay resultados con esos filtros"
              : "Aún no tienes transcripciones"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Sube tu primer audio para verlo aquí, junto con su resumen y puntos
            clave generados por IA.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in">
          {transcriptions.map((t: any) => (
            <TranscriptionCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

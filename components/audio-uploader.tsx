"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileAudio,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { COMMON_AUDIO_EXTENSIONS, cn, formatBytes, isAudioFile } from "@/lib/utils";

interface AudioUploaderProps {
  folders: Array<{ id: string; name: string; color?: string | null }>;
  defaultFolderId?: string;
}

export function AudioUploader({ folders, defaultFolderId }: AudioUploaderProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [language, setLanguage] = useState("es");
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    if (!isAudioFile(f)) {
      toast.error("Tipo de archivo no soportado.");
      return;
    }
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, ""));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    // No accept filter — we validate via isAudioFile so extensions like .qta,
    // .opus, etc. (which browsers don't always map to a MIME) still work.
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecciona un audio.");
      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      if (folderId) form.append("folderId", folderId);
      form.append("language", language);

      return new Promise<{ transcription: { id: string } }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error ?? "Error desconocido"));
            } catch {
              reject(new Error("Error subiendo el audio."));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Error de red."));
        xhr.open("POST", "/api/transcriptions");
        xhr.send(form);
      });
    },
    onSuccess: (data) => {
      toast.success("Audio subido — transcribiendo en background…");
      router.push(`/transcriptions/${data.transcription.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setProgress(0);
    },
  });

  const reset = () => {
    setFile(null);
    setTitle("");
    setProgress(0);
  };

  return (
    <div className="space-y-6">
      {!file ? (
        <div
          {...getRootProps()}
          className={cn(
            "relative rounded-2xl border-2 border-dashed transition-all cursor-pointer p-12 text-center",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/30"
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-5">
              <Upload className="h-10 w-10 text-primary" />
            </div>
            <div>
              <p className="text-lg font-semibold">
                {isDragActive
                  ? "Suelta el archivo aquí"
                  : "Arrastra tu audio o haz click"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                mp3, m4a, wav, ogg, opus, flac, aac, webm, mp4, qta…
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Cualquier tamaño · auto-comprimido y dividido si es largo
              </p>
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-3">
                <FileAudio className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(file.size)} · {file.type || "audio"}
                </p>
              </div>
              {!upload.isPending && (
                <Button variant="ghost" size="icon" onClick={reset}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nombre descriptivo"
                  disabled={upload.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="folder">Carpeta (opcional)</Label>
                <select
                  id="folder"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  disabled={upload.isPending}
                >
                  <option value="">Sin carpeta</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="lang">Idioma principal</Label>
                <select
                  id="lang"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={upload.isPending}
                >
                  <option value="es">Español (con palabras en inglés ok)</option>
                  <option value="en">Inglés</option>
                  <option value="pt">Portugués</option>
                  <option value="fr">Francés</option>
                  <option value="">Auto-detectar</option>
                </select>
              </div>
            </div>

            {upload.isPending && (
              <div className="space-y-2 animate-fade-in">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {progress < 100 ? "Subiendo audio…" : "Encolando…"}
                  </span>
                  <span className="text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            <Button
              onClick={() => upload.mutate()}
              disabled={upload.isPending || !title.trim()}
              variant="gradient"
              size="lg"
              className="w-full"
            >
              {upload.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Transcribir
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

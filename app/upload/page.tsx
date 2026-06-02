import { Sparkles, Upload } from "lucide-react";
import { prisma } from "@/lib/db";
import { AudioUploader } from "@/components/audio-uploader";

export const dynamic = "force-dynamic";

async function getFolders() {
  try {
    return await prisma.folder.findMany({ orderBy: { createdAt: "asc" } });
  } catch {
    return [];
  }
}

export default async function UploadPage() {
  const folders = await getFolders();

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="h-3 w-3" />
          OpenAI Whisper
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Sube un audio para transcribir
        </h1>
        <p className="text-muted-foreground">
          La transcripción se ejecuta en cuanto el archivo sube. Después podrás
          generar resúmenes, extraer puntos clave y conversar con el contenido.
        </p>
      </div>

      <AudioUploader folders={folders.map((f) => ({ id: f.id, name: f.name, color: f.color }))} />

      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="flex gap-3">
          <div className="rounded-full bg-primary/10 p-1.5 h-fit">
            <Upload className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">Audios largos sin problema</p>
            <p>
              Si tu archivo pesa más de 24 MB lo comprimimos automáticamente a
              mp3 mono 32 kbps (perfecto para voz). Si aún es demasiado, lo
              dividimos en chunks de 10 minutos, transcribimos en paralelo y
              unimos el resultado conservando los timestamps.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-full bg-primary/10 p-1.5 h-fit">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">Multilingüe</p>
            <p>
              Whisper detecta automáticamente cambios de idioma. Si tu audio es
              mayormente en español con palabras o frases en inglés, déjalo en
              "Español" y funcionará perfecto.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

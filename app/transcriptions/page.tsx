import Link from "next/link";
import { Upload } from "lucide-react";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { TranscriptionList } from "@/components/transcription-list";
import { Skeleton } from "@/components/ui/skeleton";

export default function TranscriptionsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transcripciones</h1>
          <p className="text-muted-foreground mt-1">
            Todos tus audios convertidos a texto.
          </p>
        </div>
        <Link href="/upload">
          <Button variant="gradient">
            <Upload className="h-4 w-4 mr-2" />
            Subir audio
          </Button>
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        }
      >
        <TranscriptionList />
      </Suspense>
    </div>
  );
}

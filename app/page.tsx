import Link from "next/link";
import {
  AudioLines,
  ArrowRight,
  CheckCircle2,
  Folder,
  Loader2,
  MessageSquare,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TranscriptionCard } from "@/components/transcription-card";
import { formatDuration } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  try {
    const [total, completed, processing, durationAgg, recent, folders] =
      await Promise.all([
        prisma.transcription.count(),
        prisma.transcription.count({ where: { status: "COMPLETED" } }),
        prisma.transcription.count({ where: { status: "PROCESSING" } }),
        prisma.transcription.aggregate({ _sum: { duration: true } }),
        prisma.transcription.findMany({
          take: 6,
          orderBy: { createdAt: "desc" },
          include: {
            folder: true,
            summary: { select: { shortSummary: true } },
            _count: {
              select: { keyPoints: true, chatMessages: true, notes: true },
            },
          },
        }),
        prisma.folder.findMany({
          include: { _count: { select: { transcriptions: true } } },
          orderBy: { createdAt: "asc" },
          take: 6,
        }),
      ]);

    return {
      stats: {
        total,
        completed,
        processing,
        totalDuration: durationAgg._sum.duration ?? 0,
      },
      recent,
      folders,
    };
  } catch {
    return {
      stats: { total: 0, completed: 0, processing: 0, totalDuration: 0 },
      recent: [],
      folders: [],
    };
  }
}

export default async function HomePage() {
  const { stats, recent, folders } = await getDashboardData();

  return (
    <div className="space-y-8 animate-fade-in">
      <section className="gradient-bg rounded-3xl p-8 md:p-12 border">
        <div className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              Powered by OpenAI Whisper · GPT-4
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
              Convierte tus audios en{" "}
              <span className="gradient-text">texto, ideas y acción</span>
            </h1>
            <p className="text-muted-foreground text-lg">
              Sube tus grabaciones en español (con palabras en inglés mezcladas
              sin problema), obtén la transcripción al instante, resúmenes y
              puntos clave automáticos, y conversa con el contenido.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/upload">
              <Button variant="gradient" size="xl">
                <Upload className="h-5 w-5 mr-2" />
                Subir audio
              </Button>
            </Link>
            <Link href="/transcriptions">
              <Button variant="outline" size="xl">
                Ver transcripciones
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={AudioLines}
          label="Audios"
          value={stats.total}
          color="from-violet-500 to-purple-500"
        />
        <StatCard
          icon={CheckCircle2}
          label="Listos"
          value={stats.completed}
          color="from-emerald-500 to-teal-500"
        />
        <StatCard
          icon={Loader2}
          label="Procesando"
          value={stats.processing}
          color="from-blue-500 to-indigo-500"
          animate={stats.processing > 0}
        />
        <StatCard
          icon={Target}
          label="Tiempo total"
          value={formatDuration(stats.totalDuration)}
          color="from-pink-500 to-rose-500"
        />
      </section>

      {folders.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Carpetas</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {folders.map((f) => (
              <Link key={f.id} href={`/transcriptions?folderId=${f.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="p-4 space-y-2">
                    <Folder
                      className="h-5 w-5"
                      style={{ color: f.color ?? undefined }}
                      fill={f.color ?? "none"}
                      fillOpacity={0.2}
                    />
                    <div>
                      <p className="font-medium text-sm truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {f._count.transcriptions} audios
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recientes</h2>
          {recent.length > 0 && (
            <Link href="/transcriptions">
              <Button variant="ghost" size="sm">
                Ver todas
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center space-y-4">
              <div className="mx-auto rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-4 w-fit">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold">Sube tu primer audio</h3>
                <p className="text-sm text-muted-foreground">
                  Soportamos mp3, m4a, wav, ogg y más. Hasta 25 MB por archivo.
                </p>
              </div>
              <Link href="/upload">
                <Button variant="gradient">
                  <Upload className="h-4 w-4 mr-2" />
                  Empezar
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recent.map((t: any) => (
              <TranscriptionCard
                key={t.id}
                t={{ ...t, createdAt: t.createdAt.toISOString() }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <FeatureCard
          icon={Sparkles}
          title="Resumen con IA"
          description="GPT-4 destila lo importante en un resumen breve y otro detallado, con temas y sentimiento."
        />
        <FeatureCard
          icon={Target}
          title="Puntos clave accionables"
          description="Categoriza ideas, acciones, decisiones y riesgos. Marca lo que vayas completando."
        />
        <FeatureCard
          icon={MessageSquare}
          title="Conversa con el audio"
          description="Pregúntale lo que quieras a tu transcripción y obtén respuestas contextualizadas."
        />
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  animate,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
  animate?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <div
          className={`inline-flex p-2 rounded-lg bg-gradient-to-br ${color}`}
        >
          <Icon
            className={`h-4 w-4 text-white ${animate ? "animate-spin" : ""}`}
          />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div className="rounded-lg bg-primary/10 p-2.5 w-fit">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

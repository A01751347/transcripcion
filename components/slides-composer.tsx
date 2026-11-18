"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  FileText,
  Grid2x2,
  ImageIcon,
  Images,
  Loader2,
  Package,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";
import {
  claudeTokens,
  composeImages,
  composePdf,
  computeGeometry,
  DEFAULT_OPTIONS,
  effectiveCellSize,
  FORMAT_META,
  geminiTokens,
  getLayout,
  gridSizeFor,
  isImageFile,
  isPdfFile,
  LAYOUTS,
  openAiTokens,
  parsePageRange,
  readDeckInfo,
  readImageInfo,
  type ComposeOptions,
  type DeckInfo,
  type FitMode,
  type GridImage,
  type ImageFormat,
  type LayoutId,
} from "@/lib/slide-grid";

/**
 * Un PDF es una fuente con varias páginas; las imágenes sueltas se juntan en
 * una sola fuente para que un lote de 10 fotos salga en mosaicos de 4 o 9 y no
 * en 10 mosaicos de una celda.
 */
type Source =
  | { kind: "pdf"; id: string; file: File; info?: DeckInfo; error?: string }
  | {
      kind: "images";
      id: string;
      files: File[];
      /** Proporción de cada imagen, en el mismo orden; undefined mientras carga. */
      aspects: (number | undefined)[];
      info?: DeckInfo;
      error?: string;
    };

const sourceName = (s: Source) =>
  s.kind === "pdf"
    ? s.file.name
    : `${s.files.length} ${s.files.length === 1 ? "imagen" : "imágenes"}`;

const sourceSize = (s: Source) =>
  s.kind === "pdf"
    ? s.file.size
    : s.files.reduce((acc, f) => acc + f.size, 0);

const FITS: { value: FitMode; label: string; hint: string }[] = [
  { value: "contain", label: "Completa", hint: "Sin recortar" },
  { value: "cover", label: "Llenar", hint: "Recorta bordes" },
];

const RESOLUTIONS = [
  { value: 1176, label: "1176", hint: "Más barato" },
  { value: 1568, label: "1568", hint: "Óptimo Claude" },
  { value: 2048, label: "2048", hint: "Óptimo GPT" },
  { value: 3072, label: "3072", hint: "Máxima nitidez" },
];

const nf = new Intl.NumberFormat("es-MX");

export function SlidesComposer() {
  const [sources, setSources] = useState<Source[]>([]);
  const [options, setOptions] = useState<ComposeOptions>(DEFAULT_OPTIONS);
  const [results, setResults] = useState<GridImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, name: "" });
  const [preview, setPreview] = useState<GridImage | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<GridImage[]>([]);

  resultsRef.current = results;
  // Los object URLs viven mientras se muestran las miniaturas; al desmontar hay
  // que soltarlos o el navegador se queda con los blobs en memoria.
  useEffect(
    () => () => resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url)),
    []
  );

  const clearResults = useCallback(() => {
    setResults((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
  }, []);

  const set = <K extends keyof ComposeOptions>(
    key: K,
    value: ComposeOptions[K]
  ) => setOptions((o) => ({ ...o, [key]: value }));

  const onDrop = useCallback(async (accepted: File[]) => {
    const pdfs = accepted.filter(isPdfFile);
    const pics = accepted.filter((f) => !isPdfFile(f) && isImageFile(f));
    if (pdfs.length === 0 && pics.length === 0) {
      toast.error("Solo se aceptan PDFs e imágenes (PNG, JPG, WebP…).");
      return;
    }

    const pdfSources = pdfs.map((file) => ({
      kind: "pdf" as const,
      id: `pdf-${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
    }));

    // Las imágenes sueltas van juntas: el nombre lo pone el navegador en el
    // orden en que las eligió el usuario, y ese orden es el del mosaico.
    const picSource =
      pics.length > 0
        ? {
            kind: "images" as const,
            id: `img-${crypto.randomUUID()}`,
            files: pics,
            aspects: pics.map(() => undefined) as (number | undefined)[],
          }
        : null;

    const added: Source[] = [
      ...pdfSources,
      ...(picSource ? [picSource] : []),
    ];
    setSources((prev) => [...prev, ...added]);

    for (const s of pdfSources) {
      try {
        const info = await readDeckInfo(s.file);
        setSources((prev) =>
          prev.map((p) => (p.id === s.id ? { ...p, info } : p))
        );
      } catch {
        setSources((prev) =>
          prev.map((p) =>
            p.id === s.id
              ? { ...p, error: "No se pudo leer el PDF (¿protegido?)" }
              : p
          )
        );
      }
    }

    if (picSource) {
      const aspects: (number | undefined)[] = [];
      let failed = 0;
      for (const file of picSource.files) {
        try {
          aspects.push((await readImageInfo(file)).aspect);
        } catch {
          aspects.push(undefined);
          failed++;
        }
      }
      const usable = aspects.filter(
        (a): a is number => typeof a === "number" && a > 0
      );
      setSources((prev) =>
        prev.map((p) =>
          p.id === picSource.id && p.kind === "images"
            ? {
                ...p,
                aspects,
                info:
                  usable.length > 0
                    ? {
                        numPages: p.files.length,
                        aspect: median(usable),
                        pageWidth: 0,
                        pageHeight: 0,
                      }
                    : undefined,
                error:
                  usable.length === 0
                    ? "No se pudo leer ninguna de las imágenes"
                    : failed > 0
                      ? `${failed} ${failed === 1 ? "imagen ilegible" : "imágenes ilegibles"}`
                      : undefined,
              }
            : p
        )
      );
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"],
    },
    multiple: true,
  });

  const layout = getLayout(options.layout);

  const estimate = useMemo(() => {
    const ready = sources.filter((s) => s.info);
    if (ready.length === 0) return null;

    let slides = 0;
    let images = 0;
    let claude = 0;
    let openai = 0;
    let gemini = 0;
    let claudeSolo = 0;
    let geo = computeGeometry(16 / 9, layout.cols, layout.rows, options);

    for (const s of ready) {
      const pages = parsePageRange(options.pageRange, s.info!.numPages).length;
      if (pages === 0) continue;
      const g = computeGeometry(
        s.info!.aspect,
        layout.cols,
        layout.rows,
        options
      );
      geo = g;
      // El último mosaico se recorta si sobran celdas, así que cuesta menos.
      const full = Math.floor(pages / layout.perImage);
      const rest = pages % layout.perImage;
      const sizes = [
        ...(full > 0 ? [{ n: full, s: gridSizeFor(g, layout.cols, layout.perImage, options) }] : []),
        ...(rest > 0 ? [{ n: 1, s: gridSizeFor(g, layout.cols, rest, options) }] : []),
      ];
      slides += pages;
      images += full + (rest > 0 ? 1 : 0);
      for (const { n, s: sz } of sizes) {
        claude += claudeTokens(sz.width, sz.height) * n;
        openai += openAiTokens(sz.width, sz.height) * n;
        gemini += geminiTokens(sz.width, sz.height) * n;
      }

      // Referencia: el mismo slide exportado solo, al mismo lado largo.
      const soloW =
        s.info!.aspect >= 1 ? options.maxEdge : options.maxEdge * s.info!.aspect;
      const soloH = soloW / s.info!.aspect;
      claudeSolo += claudeTokens(soloW, soloH) * pages;
    }

    const cell = effectiveCellSize(geo);
    return {
      slides,
      images,
      claude,
      openai,
      gemini,
      claudeSolo,
      saved: claudeSolo > 0 ? 1 - claude / claudeSolo : 0,
      geo,
      cell,
    };
  }, [sources, options, layout]);

  async function generate() {
    const ready = sources.filter((s) => s.info);
    if (ready.length === 0) {
      toast.error("Agrega al menos un PDF o unas imágenes.");
      return;
    }

    clearResults();
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const totalPages = ready.reduce(
      (acc, s) => acc + parsePageRange(options.pageRange, s.info!.numPages).length,
      0
    );
    setProgress({ done: 0, total: totalPages, name: "" });

    let offset = 0;
    const collected: GridImage[] = [];
    try {
      for (const s of ready) {
        const onProgress = (p: { sourceName: string; done: number }) =>
          setProgress({
            done: offset + p.done,
            total: totalPages,
            name: p.sourceName,
          });

        const grids =
          s.kind === "pdf"
            ? await composePdf(s.file, s.id, options, onProgress, controller.signal)
            : await composeImages(
                s.files,
                s.id,
                s.files.length === 1 ? s.files[0].name : "imagenes",
                options,
                onProgress,
                controller.signal,
                s.aspects.map((a) => a ?? 0)
              );
        offset += parsePageRange(options.pageRange, s.info!.numPages).length;
        collected.push(...grids);
        setResults([...collected]);
      }
      toast.success(
        `${collected.length} ${collected.length === 1 ? "imagen generada" : "imágenes generadas"}`
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        toast.info("Generación cancelada");
      } else {
        toast.error((err as Error)?.message ?? "Error generando las imágenes");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function download(image: GridImage) {
    const a = document.createElement("a");
    a.href = image.url;
    a.download = image.filename;
    a.click();
  }

  async function downloadZip() {
    if (results.length === 0) return;
    const toastId = toast.loading("Armando el ZIP…");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const r of results) zip.file(r.filename, r.blob);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `slides_${layout.perImage}up_${results.length}img.zip`;
      a.click();
      // Revocar en el mismo tick corta la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast.success("ZIP listo", { id: toastId });
    } catch {
      toast.error("No se pudo crear el ZIP", { id: toastId });
    }
  }

  async function copyImage(image: GridImage) {
    try {
      // El portapapeles solo acepta PNG, así que reencodeamos al vuelo.
      const bitmap = await createImageBitmap(image.blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      const png: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("sin blob"))),
          "image/png"
        )
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setCopied(image.id);
      setTimeout(() => setCopied((c) => (c === image.id ? null : c)), 1600);
    } catch {
      toast.error("Tu navegador no dejó copiar la imagen");
    }
  }

  async function copyPrompt() {
    const names = [...new Set(results.map((r) => r.sourceName))].join(", ");
    const onlyImages = sources.every((s) => s.kind === "images");
    const text =
      `Te comparto ${results.length} ${results.length === 1 ? "imagen" : "imágenes"}. ` +
      `Cada una es un mosaico de hasta ${layout.perImage} ${onlyImages ? "imágenes" : "slides"}` +
      `${names ? ` de ${names}` : ""}, ` +
      `en orden de lectura (izquierda a derecha, arriba a abajo). ` +
      `El número en la esquina superior izquierda de cada celda es su posición en ` +
      `${onlyImages ? "el lote original" : "el PDF original"}: úsalo para citarlas.`;
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copiado");
  }

  const totalBytes = results.reduce((acc, r) => acc + r.bytes, 0);
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Slides <span className="gradient-text">en mosaico</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          Convierte un PDF de presentación —o un lote de imágenes sueltas— en
          mosaicos de 4 o 9 slides, listos para pegarle a un LLM gastando una
          fracción de los tokens. Todo se procesa en tu navegador.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-9 w-9 mx-auto mb-3 text-muted-foreground" />
        <p className="font-medium">
          {isDragActive
            ? "Suelta los archivos aquí"
            : "Arrastra PDFs o imágenes, o haz clic"}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Varias presentaciones a la vez, o un lote de fotos y capturas (PNG,
          JPG, WebP…)
        </p>
      </div>

      {sources.length > 0 && (
        <div className="space-y-2">
          {sources.map((s) => {
            const pages = s.info
              ? parsePageRange(options.pageRange, s.info.numPages).length
              : 0;
            const unit = s.kind === "pdf" ? "páginas" : "imágenes";
            return (
              <Card key={s.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    {s.kind === "pdf" ? (
                      <FileText className="h-4 w-4 text-primary" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {sourceName(s)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.info ? (
                        <>
                          {s.info.numPages} {unit} · {pages} seleccionadas ·{" "}
                          {formatBytes(sourceSize(s))}
                          {s.error && (
                            <span className="text-amber-600 dark:text-amber-400">
                              {" "}
                              · {s.error}
                            </span>
                          )}
                        </>
                      ) : s.error ? (
                        <span className="text-destructive">{s.error}</span>
                      ) : (
                        "Leyendo…"
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() =>
                      setSources((prev) => prev.filter((p) => p.id !== s.id))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start">
        <div className="space-y-4 lg:sticky lg:top-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Grid2x2 className="h-4 w-4 text-primary" />
                Ajustes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Slides por imagen">
                <div className="grid grid-cols-3 gap-1.5">
                  {LAYOUTS.map((l) => (
                    <Choice
                      key={l.id}
                      active={options.layout === l.id}
                      onClick={() => set("layout", l.id as LayoutId)}
                    >
                      {l.perImage}
                    </Choice>
                  ))}
                </div>
              </Field>

              <Field
                label="Lado largo de la imagen"
                hint="Los modelos reescalan por encima de su límite: más px de ahí no añaden detalle."
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {RESOLUTIONS.map((r) => (
                    <Choice
                      key={r.value}
                      active={options.maxEdge === r.value}
                      onClick={() => set("maxEdge", r.value)}
                    >
                      <span className="flex flex-col leading-tight">
                        <span>{r.label} px</span>
                        <span className="text-[10px] opacity-70">{r.hint}</span>
                      </span>
                    </Choice>
                  ))}
                </div>
              </Field>

              <Field label="Formato">
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(FORMAT_META) as ImageFormat[]).map((f) => (
                    <Choice
                      key={f}
                      active={options.format === f}
                      onClick={() => set("format", f)}
                    >
                      {FORMAT_META[f].label}
                    </Choice>
                  ))}
                </div>
              </Field>

              {FORMAT_META[options.format].hasQuality && (
                <Field label={`Calidad · ${Math.round(options.quality * 100)}%`}>
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={options.quality}
                    onChange={(e) => set("quality", Number(e.target.value))}
                    className="w-full accent-violet-600"
                  />
                </Field>
              )}

              <Field
                label="Encaje en la celda"
                hint="Aplica cuando el slide o la foto no tiene la proporción de la celda."
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {FITS.map((f) => (
                    <Choice
                      key={f.value}
                      active={options.fit === f.value}
                      onClick={() => set("fit", f.value)}
                    >
                      <span className="flex flex-col leading-tight">
                        <span>{f.label}</span>
                        <span className="text-[10px] opacity-70">{f.hint}</span>
                      </span>
                    </Choice>
                  ))}
                </div>
              </Field>

              <Field
                label="Páginas / imágenes"
                hint="Vacío = todas. Ej: 1-12, 20, 25-30 (se aplica a cada fuente)"
              >
                <Input
                  value={options.pageRange}
                  onChange={(e) => set("pageRange", e.target.value)}
                  placeholder="todas"
                />
              </Field>

              <div className="space-y-2">
                <Toggle
                  checked={options.showLabels}
                  onChange={(v) => set("showLabels", v)}
                  label="Numerar cada slide"
                  hint="Deja que el modelo cite «slide 7»"
                />
                <Toggle
                  checked={options.showBorders}
                  onChange={(v) => set("showBorders", v)}
                  label="Borde entre slides"
                  hint="Ayuda a separar slides con fondo blanco"
                />
              </div>
            </CardContent>
          </Card>

          {estimate && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Estimación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row
                  k="Salida"
                  v={`${estimate.images} img · ${estimate.geo.width}×${estimate.geo.height}`}
                />
                <Row
                  k="Slides"
                  v={`${estimate.slides} en total`}
                />
                <Row
                  k="Cada slide le llega a"
                  v={`${estimate.cell.w}×${estimate.cell.h} px`}
                />
                <div className="rounded-lg bg-muted/60 p-3 space-y-1.5">
                  <Row k="Claude" v={`~${nf.format(estimate.claude)} tk`} strong />
                  <Row k="GPT-4o" v={`~${nf.format(estimate.openai)} tk`} />
                  <Row k="Gemini" v={`~${nf.format(estimate.gemini)} tk`} />
                </div>
                {estimate.saved > 0.01 && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {Math.round(estimate.saved * 100)}% menos que mandar los{" "}
                    {estimate.slides} sueltos (~
                    {nf.format(estimate.claudeSolo)} tk en Claude).
                  </p>
                )}
                {estimate.cell.w < 450 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    A esta densidad el texto chico puede volverse ilegible. Baja
                    a 4 slides por imagen si la presentación tiene mucho texto.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Button
              variant="gradient"
              size="lg"
              className="w-full"
              disabled={busy || sources.every((s) => !s.info)}
              onClick={generate}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generando…
                </>
              ) : (
                <>
                  <Images className="h-4 w-4 mr-2" />
                  Generar mosaicos
                </>
              )}
            </Button>
            {busy && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => abortRef.current?.abort()}
              >
                Cancelar
              </Button>
            )}
          </div>

          {busy && (
            <div className="space-y-1.5">
              <Progress value={pct} />
              <p className="text-xs text-muted-foreground">
                {progress.done} / {progress.total} slides · {progress.name}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {results.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {results.length} {results.length === 1 ? "imagen" : "imágenes"}
                </Badge>
                <Badge variant="secondary">{formatBytes(totalBytes)}</Badge>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={copyPrompt}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Prompt sugerido
                </Button>
                <Button variant="outline" size="sm" onClick={downloadZip}>
                  <Package className="h-3.5 w-3.5 mr-1.5" />
                  Descargar ZIP
                </Button>
                <Button variant="ghost" size="sm" onClick={clearResults}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {results.map((r) => (
                  <Card key={r.id} className="overflow-hidden group">
                    <button
                      type="button"
                      onClick={() => setPreview(r)}
                      className="block w-full bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.url}
                        alt={`Slides ${r.pages.join(", ")}`}
                        className="w-full h-auto"
                        loading="lazy"
                      />
                    </button>
                    <CardContent className="flex items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {r.filename}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.pages.length} slides · {formatBytes(r.bytes)} · ~
                          {nf.format(claudeTokens(r.width, r.height))} tk
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => copyImage(r)}
                        title="Copiar imagen"
                      >
                        {copied === r.id ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => download(r)}
                        title="Descargar"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                <Images className="h-10 w-10 mx-auto mb-3 opacity-40" />
                Tus mosaicos aparecerán aquí.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-auto"
          onClick={() => setPreview(null)}
        >
          <div className="min-h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.filename}
              className="max-w-full rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <Button
            variant="secondary"
            size="icon"
            className="fixed top-4 right-4"
            onClick={() => setPreview(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-input hover:bg-accent text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-lg border border-input p-2.5 text-left hover:bg-accent transition-colors"
    >
      <span
        className={cn(
          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "block h-4 w-4 rounded-full bg-white transition-transform",
            checked && "translate-x-4"
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {hint && (
          <span className="block text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </button>
  );
}

/** Mediana de proporciones: una foto vertical suelta no tuerce la cuadrícula. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={cn("text-xs tabular-nums", strong && "font-semibold")}>
        {v}
      </span>
    </div>
  );
}

/**
 * Composición de slides en imágenes-mosaico (2x2, 3x3, …).
 *
 * La fuente puede ser un PDF de presentación o un lote de imágenes sueltas
 * (capturas, fotos de pizarrón, slides exportados uno por uno).
 *
 * Todo corre en el navegador: el archivo nunca sale del equipo. pdf.js rasteriza
 * cada página directamente al tamaño de celda que le toca, así que el texto se
 * dibuja nítido a esa resolución en vez de escalarse desde un render grande.
 *
 * El objetivo es mandarle presentaciones a un LLM con visión gastando menos
 * tokens: 9 slides en una imagen cuestan ~1/9 que 9 imágenes sueltas, siempre
 * que la imagen no supere el límite donde el modelo la reescala.
 */

export type LayoutId = "1x1" | "2x2" | "2x3" | "3x3" | "4x4";

export type Layout = {
  id: LayoutId;
  cols: number;
  rows: number;
  perImage: number;
  label: string;
};

export const LAYOUTS: Layout[] = [
  { id: "1x1", cols: 1, rows: 1, perImage: 1, label: "1 slide" },
  { id: "2x2", cols: 2, rows: 2, perImage: 4, label: "4 slides" },
  { id: "2x3", cols: 3, rows: 2, perImage: 6, label: "6 slides" },
  { id: "3x3", cols: 3, rows: 3, perImage: 9, label: "9 slides" },
  { id: "4x4", cols: 4, rows: 4, perImage: 16, label: "16 slides" },
];

export const getLayout = (id: LayoutId): Layout =>
  LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[1];

export type ImageFormat = "jpeg" | "webp" | "png";

/**
 * `contain` deja la imagen completa con bandas blancas; `cover` llena la celda
 * recortando los bordes. Con fotos de distintas cámaras `cover` da una
 * cuadrícula pareja, pero puede comerse texto pegado a la orilla.
 */
export type FitMode = "contain" | "cover";

export const FORMAT_META: Record<
  ImageFormat,
  { mime: string; ext: string; label: string; hasQuality: boolean }
> = {
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPEG", hasQuality: true },
  webp: { mime: "image/webp", ext: "webp", label: "WebP", hasQuality: true },
  png: { mime: "image/png", ext: "png", label: "PNG", hasQuality: false },
};

export type ComposeOptions = {
  layout: LayoutId;
  /** Lado largo de la imagen resultante, en px. */
  maxEdge: number;
  format: ImageFormat;
  quality: number;
  /** Separación entre slides, en px. */
  gap: number;
  /** Margen exterior, en px. */
  margin: number;
  /** Dibuja el número de slide en cada celda. */
  showLabels: boolean;
  /** Dibuja un borde fino alrededor de cada slide. */
  showBorders: boolean;
  /** Páginas/slides a incluir, ej. "1-12, 20". Vacío = todos. */
  pageRange: string;
  /** Cómo encaja cada slide en su celda cuando las proporciones no coinciden. */
  fit: FitMode;
};

export const DEFAULT_OPTIONS: ComposeOptions = {
  layout: "2x2",
  maxEdge: 1568,
  format: "jpeg",
  quality: 0.92,
  gap: 10,
  margin: 8,
  showLabels: true,
  showBorders: true,
  pageRange: "",
  fit: "contain",
};

export type GridImage = {
  id: string;
  sourceId: string;
  sourceName: string;
  /** Índice del mosaico dentro de su fuente, base 1. */
  index: number;
  /** Número de slide dentro de la fuente, base 1: página del PDF o n-ésima imagen. */
  pages: number[];
  width: number;
  height: number;
  bytes: number;
  blob: Blob;
  url: string;
  filename: string;
};

export type ComposeProgress = {
  sourceName: string;
  done: number;
  total: number;
};

// ---------------------------------------------------------------- geometría

export type GridGeometry = {
  width: number;
  height: number;
  cellW: number;
  cellH: number;
};

/**
 * Elige el tamaño de celda más grande que deja la imagen completa dentro de
 * `maxEdge` por su lado largo.
 */
export function computeGeometry(
  cellAspect: number,
  cols: number,
  rows: number,
  { maxEdge, gap, margin }: Pick<ComposeOptions, "maxEdge" | "gap" | "margin">
): GridGeometry {
  const availW = maxEdge - margin * 2 - gap * (cols - 1);
  const availH = maxEdge - margin * 2 - gap * (rows - 1);
  const cellW = Math.max(
    1,
    Math.floor(Math.min(availW / cols, (availH / rows) * cellAspect))
  );
  // Truncado, no redondeado: con `floor` en ambos lados queda garantizado que
  // cols*cellW <= availW y rows*cellH <= availH, así que el mosaico nunca se
  // pasa de `maxEdge` (redondear hacia arriba lo excedía por 1-2 px en PDFs
  // verticales, y eso obliga al modelo a reescalar la imagen entera).
  const cellH = Math.max(1, Math.floor(cellW / cellAspect));
  return {
    width: margin * 2 + cols * cellW + gap * (cols - 1),
    height: margin * 2 + rows * cellH + gap * (rows - 1),
    cellW,
    cellH,
  };
}

/**
 * Tamaño del lienzo para un mosaico con `count` slides. El último grupo casi
 * nunca llena la cuadrícula, y las celdas vacías le costarían tokens al modelo,
 * así que se recorta a las filas y columnas realmente usadas.
 */
export function gridSizeFor(
  geo: GridGeometry,
  cols: number,
  count: number,
  { gap, margin }: Pick<ComposeOptions, "gap" | "margin">
): { width: number; height: number } {
  const usedCols = Math.max(1, Math.min(cols, count));
  const usedRows = Math.max(1, Math.ceil(count / cols));
  return {
    width: margin * 2 + usedCols * geo.cellW + gap * (usedCols - 1),
    height: margin * 2 + usedRows * geo.cellH + gap * (usedRows - 1),
  };
}

// -------------------------------------------------------- costo en tokens

/**
 * Claude reescala cualquier imagen cuyo lado largo pase de 1568 px y luego
 * cobra ancho*alto/750 tokens.
 */
export function claudeTokens(w: number, h: number): number {
  const s = Math.min(1, 1568 / Math.max(w, h));
  return Math.round((w * s * h * s) / 750);
}

/**
 * GPT-4o/4.1 en detalle alto: encaja en 2048², lleva el lado corto a 768 y
 * cobra 170 tokens por mosaico de 512² más 85 de base.
 */
export function openAiTokens(w: number, h: number): number {
  const fit = Math.min(1, 2048 / Math.max(w, h));
  let W = w * fit;
  let H = h * fit;
  const short = 768 / Math.min(W, H);
  W *= short;
  H *= short;
  return 85 + 170 * (Math.ceil(W / 512) * Math.ceil(H / 512));
}

/** Gemini: 258 tokens por mosaico de 768². */
export function geminiTokens(w: number, h: number): number {
  if (w <= 384 && h <= 384) return 258;
  return Math.ceil(w / 768) * Math.ceil(h / 768) * 258;
}

/**
 * Resolución con la que un slide llega realmente al modelo, ya aplicado el
 * reescalado de Claude. Es el número que decide si el texto se va a leer.
 */
export function effectiveCellSize(
  geo: GridGeometry,
  limit = 1568
): { w: number; h: number } {
  const s = Math.min(1, limit / Math.max(geo.width, geo.height));
  return { w: Math.round(geo.cellW * s), h: Math.round(geo.cellH * s) };
}

// ------------------------------------------------------------ rango de páginas

export function parsePageRange(input: string, total: number): number[] {
  const raw = input.trim();
  if (!raw) return Array.from({ length: total }, (_, i) => i + 1);

  const out = new Set<number>();
  for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*(?:-|–|—|a)\s*(\d+)$/i);
    if (range) {
      let [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i);
      continue;
    }
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= total) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------------- canvas

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Reduce a la mitad hasta acercarse al destino: menos aliasing que un salto. */
function downscale(
  src: HTMLCanvasElement,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  let cur = src;
  while (cur.width >= targetW * 2 && cur.height >= targetH * 2) {
    const next = document.createElement("canvas");
    next.width = Math.max(targetW, Math.floor(cur.width / 2));
    next.height = Math.max(targetH, Math.floor(cur.height / 2));
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen")),
      mime,
      quality
    );
  });
}

// -------------------------------------------------------------------- pdf.js

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}
export function sanitizeName(name: string): string {
  return (
    name
      .replace(/\.(pdf|png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i, "")
      .replace(/[^\w\-À-ÿ]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "slides"
  );
}

export type DeckInfo = {
  numPages: number;
  aspect: number;
  pageWidth: number;
  pageHeight: number;
};

export async function readDeckInfo(file: File): Promise<DeckInfo> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    return {
      numPages: doc.numPages,
      aspect: vp.width / vp.height,
      pageWidth: vp.width,
      pageHeight: vp.height,
    };
  } finally {
    await task.destroy();
  }
}

// -------------------------------------------------------------- imágenes

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Lee el tamaño de una imagen sin decodificarla entera dos veces. */
export async function readImageInfo(file: File): Promise<DeckInfo> {
  const bitmap = await decodeImage(file);
  try {
    return {
      numPages: 1,
      aspect: bitmap.width / bitmap.height,
      pageWidth: bitmap.width,
      pageHeight: bitmap.height,
    };
  } finally {
    bitmap.close?.();
  }
}

type DecodedImage = {
  width: number;
  height: number;
  close?: () => void;
};

async function decodeImage(
  file: File
): Promise<DecodedImage & CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari viejo y algunos HEIC caen aquí; el <img> suele poder.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error(`No se pudo leer la imagen "${file.name}"`));
      img.src = url;
    });
    return Object.assign(img, {
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// ------------------------------------------------------------ motor común

/**
 * Un slide listo para dibujarse: se le pide que se pinte del tamaño de celda
 * que le toque. El PDF lo resuelve rasterizando la página a esa escala y las
 * imágenes reescalando el bitmap, pero al mosaico le da igual cuál sea.
 */
type SlideRenderer = {
  /** Número que se dibuja en la esquina y se usa para nombrar el archivo. */
  label: number;
  /** Proporción ancho/alto del slide original. */
  aspect: number;
  /** Dibuja el slide centrado dentro de la celda (x, y, cellW, cellH). */
  draw: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    cellW: number,
    cellH: number,
    options: ComposeOptions
  ) => Promise<void>;
  /** Libera lo que haya quedado en memoria tras dibujar. */
  cleanup?: () => void;
};

/**
 * Coloca `source` dentro de la celda respetando el modo de encaje. Devuelve el
 * rectángulo destino y el recorte en coordenadas de la fuente.
 */
function fitRect(
  srcW: number,
  srcH: number,
  cellW: number,
  cellH: number,
  mode: FitMode
) {
  if (mode === "cover") {
    const scale = Math.max(cellW / srcW, cellH / srcH);
    const cropW = Math.min(srcW, cellW / scale);
    const cropH = Math.min(srcH, cellH / scale);
    return {
      sx: (srcW - cropW) / 2,
      sy: (srcH - cropH) / 2,
      sw: cropW,
      sh: cropH,
      dw: cellW,
      dh: cellH,
    };
  }
  const scale = Math.min(cellW / srcW, cellH / srcH);
  return {
    sx: 0,
    sy: 0,
    sw: srcW,
    sh: srcH,
    dw: Math.max(1, Math.round(srcW * scale)),
    dh: Math.max(1, Math.round(srcH * scale)),
  };
}

/**
 * Arma los mosaicos a partir de una lista de slides ya resueltos. Es el núcleo
 * compartido entre PDFs e imágenes: la geometría, el recorte del último grupo,
 * las etiquetas y el encode salen todos de aquí.
 */
async function composeSlides(
  slides: SlideRenderer[],
  sourceId: string,
  sourceName: string,
  baseName: string,
  cellAspect: number,
  options: ComposeOptions,
  onProgress?: (p: ComposeProgress) => void,
  signal?: AbortSignal
): Promise<GridImage[]> {
  const { cols, rows, perImage } = getLayout(options.layout);
  const { mime, ext } = FORMAT_META[options.format];
  const geo = computeGeometry(cellAspect, cols, rows, options);
  const groups = chunk(slides, perImage);
  const results: GridImage[] = [];

  let done = 0;
  onProgress?.({ sourceName, done, total: slides.length });

  for (const [gi, group] of groups.entries()) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");

    // El tamaño de celda es el mismo en todos los mosaicos, así que los slides
    // salen a idéntica escala aunque el último lienzo sea más chico.
    const { width, height } = gridSizeFor(geo, cols, group.length, options);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#e6e8ec"; // los separadores marcan dónde corta cada slide
    ctx.fillRect(0, 0, width, height);

    for (const [ci, slide] of group.entries()) {
      const x = options.margin + (ci % cols) * (geo.cellW + options.gap);
      const y =
        options.margin + Math.floor(ci / cols) * (geo.cellH + options.gap);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, geo.cellW, geo.cellH);

      try {
        await slide.draw(ctx, x, y, geo.cellW, geo.cellH, options);
      } finally {
        slide.cleanup?.();
      }

      if (options.showBorders) {
        ctx.strokeStyle = "rgba(100,116,139,0.45)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, geo.cellW - 1, geo.cellH - 1);
      }
      if (options.showLabels) {
        drawLabel(ctx, x, y, geo.cellH, String(slide.label));
      }

      done++;
      onProgress?.({ sourceName, done, total: slides.length });
    }

    const blob = await canvasToBlob(
      canvas,
      mime,
      FORMAT_META[options.format].hasQuality ? options.quality : undefined
    );
    const labels = group.map((s) => s.label);
    const first = labels[0];
    const last = labels[labels.length - 1];
    const suffix = first === last ? `p${first}` : `p${first}-${last}`;
    results.push({
      id: `${sourceId}-${gi}`,
      sourceId,
      sourceName,
      index: gi + 1,
      pages: labels,
      width,
      height,
      bytes: blob.size,
      blob,
      url: URL.createObjectURL(blob),
      filename: `${baseName}_${String(gi + 1).padStart(2, "0")}_${suffix}.${ext}`,
    });
  }

  return results;
}

/**
 * Rasteriza un PDF y devuelve un mosaico por cada `cols*rows` slides.
 */
export async function composePdf(
  file: File,
  sourceId: string,
  options: ComposeOptions,
  onProgress?: (p: ComposeProgress) => void,
  signal?: AbortSignal
): Promise<GridImage[]> {
  const pdfjs = await loadPdfjs();
  const base = sanitizeName(file.name);

  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;

  try {
    const pages = parsePageRange(options.pageRange, doc.numPages);
    if (pages.length === 0) {
      throw new Error(`"${file.name}": el rango de páginas no selecciona nada`);
    }

    const firstViewport = (await doc.getPage(pages[0])).getViewport({ scale: 1 });
    const cellAspect = firstViewport.width / firstViewport.height;

    const slides: SlideRenderer[] = pages.map((pageNumber) => ({
      label: pageNumber,
      aspect: cellAspect,
      draw: async (ctx, x, y, cellW, cellH, opts) => {
        const page = await doc.getPage(pageNumber);
        try {
          const base1 = page.getViewport({ scale: 1 });
          // Slides chicos pierden trazos finos si se rasterizan 1:1;
          // renderizar al doble y bajar da texto más legible.
          const ss = cellW < 900 ? 2 : 1;
          const rect = fitRect(base1.width, base1.height, cellW, cellH, opts.fit);
          const scale = rect.dw / rect.sw;
          const viewport = page.getViewport({ scale: scale * ss });

          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = Math.max(1, Math.round(viewport.width));
          pageCanvas.height = Math.max(1, Math.round(viewport.height));
          await page.render({
            canvas: pageCanvas,
            viewport,
            background: "#ffffff",
          }).promise;

          drawFitted(ctx, pageCanvas, ss, rect, x, y, cellW, cellH);
        } finally {
          page.cleanup();
        }
      },
    }));

    return await composeSlides(
      slides,
      sourceId,
      file.name,
      base,
      cellAspect,
      options,
      onProgress,
      signal
    );
  } finally {
    await task.destroy();
  }
}

/**
 * Arma mosaicos a partir de un lote de imágenes sueltas, en el orden dado.
 *
 * Las fotos rara vez comparten proporción, así que la celda se calcula con la
 * proporción mediana del lote: así una imagen atravesada no deforma la
 * cuadrícula entera, y cada imagen se encaja dentro según `options.fit`.
 */
export async function composeImages(
  files: File[],
  sourceId: string,
  sourceName: string,
  options: ComposeOptions,
  onProgress?: (p: ComposeProgress) => void,
  signal?: AbortSignal,
  /** Proporciones ya leídas, en el mismo orden que `files`. */
  aspects?: number[]
): Promise<GridImage[]> {
  const picked = parsePageRange(options.pageRange, files.length);
  if (picked.length === 0) {
    throw new Error("El rango de imágenes no selecciona nada");
  }

  const known = (aspects ?? []).filter((a) => Number.isFinite(a) && a > 0);
  const cellAspect = known.length > 0 ? medianAspect(known) : 4 / 3;
  const base = sanitizeName(sourceName);

  const slides: SlideRenderer[] = picked.map((n) => {
    const file = files[n - 1];
    let decoded: (DecodedImage & CanvasImageSource) | null = null;
    return {
      label: n,
      aspect: aspects?.[n - 1] ?? cellAspect,
      draw: async (ctx, x, y, cellW, cellH, opts) => {
        decoded = await decodeImage(file);
        const rect = fitRect(
          decoded.width,
          decoded.height,
          cellW,
          cellH,
          opts.fit
        );
        drawFitted(ctx, decoded, 1, rect, x, y, cellW, cellH);
      },
      cleanup: () => {
        decoded?.close?.();
        decoded = null;
      },
    };
  });

  return composeSlides(
    slides,
    sourceId,
    sourceName,
    base,
    cellAspect,
    options,
    onProgress,
    signal
  );
}

/** Mediana: una sola foto vertical entre horizontales no mueve la celda. */
function medianAspect(aspects: number[]): number {
  const sorted = [...aspects].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Dibuja `src` en la celda. `src` puede venir sobredimensionado por `ss`
 * (supersampling), en cuyo caso se baja por mitades antes de pintarlo.
 */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  ss: number,
  rect: ReturnType<typeof fitRect>,
  x: number,
  y: number,
  cellW: number,
  cellH: number
) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const dx = x + Math.round((cellW - rect.dw) / 2);
  const dy = y + Math.round((cellH - rect.dh) / 2);

  // Bajar de golpe desde una fuente mucho más grande (una foto de 4000 px
  // metida en una celda de 500) deja aliasing: se recorta primero a un canvas
  // propio y se baja por mitades. Si la fuente ya viene cerca del destino, el
  // drawImage directo es más barato y se ve igual.
  const srcW = rect.sw * ss;
  const srcH = rect.sh * ss;
  if (srcW >= rect.dw * 2 && srcH >= rect.dh * 2) {
    const cropped = cropToCanvas(src, rect.sx * ss, rect.sy * ss, srcW, srcH);
    const scaled = downscale(cropped, rect.dw, rect.dh);
    ctx.drawImage(scaled, dx, dy, rect.dw, rect.dh);
    return;
  }

  ctx.drawImage(
    src,
    rect.sx * ss,
    rect.sy * ss,
    srcW,
    srcH,
    dx,
    dy,
    rect.dw,
    rect.dh
  );
}

/**
 * Copia el recorte a un canvas propio para poder reducirlo por mitades.
 * Cuando no hay recorte y ya es un canvas, se devuelve tal cual.
 */
function cropToCanvas(
  src: CanvasImageSource & { width: number; height: number },
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement {
  if (
    src instanceof HTMLCanvasElement &&
    sx === 0 &&
    sy === 0 &&
    sw === src.width &&
    sh === src.height
  ) {
    return src;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}


function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellH: number,
  text: string
) {
  const fs = Math.max(11, Math.round(cellH * 0.05));
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const padX = Math.round(fs * 0.52);
  const padY = Math.round(fs * 0.3);
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = fs + padY * 2;
  const bx = x + Math.round(fs * 0.35);
  const by = y + Math.round(fs * 0.35);

  ctx.fillStyle = "rgba(15,23,42,0.82)";
  roundRect(ctx, bx, by, w, h, Math.round(h * 0.3));
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, bx + padX, by + h / 2 + fs * 0.05);
}

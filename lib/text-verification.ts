import { openai, CHAT_MODEL } from "./openai";

export type ChunkVerdict = "ok" | "suspicious" | "noise";

export interface ChunkVerdictResult {
  index: number;
  verdict: ChunkVerdict;
  reason?: string;
}

interface ChunkForVerify {
  index: number;
  text: string;
  durationSeconds: number;
}

const SYSTEM_PROMPT = `Eres un revisor de transcripciones automáticas en español. Recibes fragmentos consecutivos de la transcripción de un audio (cada uno con su índice y duración en segundos) y debes clasificar CADA fragmento como:

- "ok": el texto tiene sentido en sí mismo y/o encaja con el contexto de los fragmentos vecinos. Una conversación normal, una explicación, una pausa narrativa breve son OK.
- "suspicious": el texto contiene errores claros de reconocimiento (loops repetitivos, palabras inventadas, frases que no encajan con nada antes/después, texto que claramente no corresponde a la duración del fragmento, "muchas gracias por ver el video" en medio de una reunión, etc.). Vale la pena re-procesar este fragmento.
- "noise": el fragmento es prácticamente silencio o ruido sin contenido — no hay nada que rescatar aunque se re-procese.

NO reescribas el texto. NO inventes contenido. Sólo emite el JSON con verdicts.

Devuelve SIEMPRE un JSON con la forma:
{ "verdicts": [{ "index": <number>, "verdict": "ok"|"suspicious"|"noise", "reason": "<string corto, opcional, solo si no es ok>" }] }`;

function buildUserMessage(chunks: ChunkForVerify[]): string {
  const body = chunks
    .map(
      (c) =>
        `--- Fragmento #${c.index} (duración ${c.durationSeconds.toFixed(0)}s) ---\n${c.text || "(vacío)"}`
    )
    .join("\n\n");
  return `Clasifica cada uno de estos ${chunks.length} fragmentos:\n\n${body}`;
}

/**
 * Send all chunks in a single LLM call and get back per-chunk verdicts.
 * For very large transcriptions we batch in groups so we don't blow up
 * the context window. Each batch carries 2 chunks of overlap on each side
 * so the LLM has neighbor context when judging boundary fragments.
 */
export async function verifyChunksWithLLM(
  chunks: ChunkForVerify[],
  opts: { batchSize?: number; overlap?: number } = {}
): Promise<ChunkVerdictResult[]> {
  if (chunks.length === 0) return [];
  const batchSize = opts.batchSize ?? 30;
  const overlap = opts.overlap ?? 2;

  const verdicts = new Map<number, ChunkVerdictResult>();

  for (let i = 0; i < chunks.length; i += batchSize) {
    const sliceStart = Math.max(0, i - overlap);
    const sliceEnd = Math.min(chunks.length, i + batchSize + overlap);
    const batch = chunks.slice(sliceStart, sliceEnd);

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(batch) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed: { verdicts?: ChunkVerdictResult[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If the LLM returned bad JSON, treat everything in this batch as ok
      // — we don't want a verification glitch to corrupt a good transcription.
      continue;
    }

    // Only keep verdicts for the chunks that are this batch's "primary"
    // range, not its overlap padding. This prevents one batch's edge
    // chunks from overwriting another batch's verdict.
    const primaryRange = new Set(
      chunks
        .slice(i, Math.min(chunks.length, i + batchSize))
        .map((c) => c.index)
    );
    for (const v of parsed.verdicts ?? []) {
      if (
        typeof v.index === "number" &&
        primaryRange.has(v.index) &&
        ["ok", "suspicious", "noise"].includes(v.verdict)
      ) {
        verdicts.set(v.index, {
          index: v.index,
          verdict: v.verdict,
          reason: v.reason?.trim() || undefined,
        });
      }
    }
  }

  // Fill in any missing chunks as ok (LLM didn't return a verdict for them
  // — we conservatively assume they're fine rather than re-process unnecessarily).
  return chunks.map(
    (c) =>
      verdicts.get(c.index) ?? {
        index: c.index,
        verdict: "ok" as const,
      }
  );
}

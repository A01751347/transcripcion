import { openai, CHAT_MODEL } from "./openai";

export interface SummaryOutput {
  shortSummary: string;
  longSummary: string;
  topics: string[];
  sentiment: string;
}

export interface KeyPointOutput {
  content: string;
  category?: string;
  importance: number;
  timestamp?: number;
}

const SUMMARY_PROMPT = `Eres un asistente experto en análisis de transcripciones de audio en español.
Analiza la transcripción y devuelve un JSON con esta estructura exacta:
{
  "shortSummary": "Resumen muy breve de 1-2 frases.",
  "longSummary": "Resumen detallado en 2-4 párrafos. Usa markdown si es útil.",
  "topics": ["tema 1", "tema 2", "tema 3"],
  "sentiment": "positivo | neutral | negativo | mixto"
}
Responde únicamente con el JSON, sin texto adicional.`;

const KEY_POINTS_PROMPT = `Eres un asistente experto que extrae los puntos clave de una transcripción en español.
Identifica entre 5 y 12 puntos importantes, accionables o destacables.
Para cada uno, sugiere una categoría corta como: "Idea", "Acción", "Decisión", "Pregunta", "Riesgo", "Recordatorio", "Dato".
Asigna una importancia del 1 al 5 (5 = crítico).
Si la transcripción incluye marcas de tiempo, intenta asignar un timestamp aproximado en segundos.

Responde únicamente con un JSON de la forma:
{
  "points": [
    { "content": "...", "category": "Acción", "importance": 4, "timestamp": 12.5 }
  ]
}`;

const CHAT_SYSTEM_PROMPT = `Eres un asistente que ayuda al usuario a entender, analizar y trabajar sobre una transcripción de audio en español.
Responde en el mismo idioma que pregunte el usuario (por defecto español).
Cuando cites contenido del audio, usa comillas. Si la respuesta no está en la transcripción, dilo claramente.
Sé conciso, claro y útil. Usa markdown para listas o estructura cuando ayude.`;

function truncateForContext(text: string, maxChars = 60000): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars / 2) +
    "\n\n[…transcripción truncada por longitud…]\n\n" +
    text.slice(-maxChars / 2)
  );
}

export async function generateSummary(
  transcriptText: string
): Promise<SummaryOutput> {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content: `Transcripción:\n\n${truncateForContext(transcriptText)}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<SummaryOutput>;
  return {
    shortSummary: parsed.shortSummary ?? "",
    longSummary: parsed.longSummary ?? "",
    topics: parsed.topics ?? [],
    sentiment: parsed.sentiment ?? "neutral",
  };
}

export async function generateKeyPoints(
  transcriptText: string
): Promise<KeyPointOutput[]> {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      { role: "system", content: KEY_POINTS_PROMPT },
      {
        role: "user",
        content: `Transcripción:\n\n${truncateForContext(transcriptText)}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{"points":[]}';
  const parsed = JSON.parse(raw) as { points: KeyPointOutput[] };
  return parsed.points ?? [];
}

export async function chatWithTranscription(
  transcriptText: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.5,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      {
        role: "system",
        content: `Transcripción del audio:\n\n${truncateForContext(transcriptText)}`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}

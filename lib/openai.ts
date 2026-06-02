import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[openai] Missing OPENAI_API_KEY — transcription and analysis endpoints will fail until it is set in .env"
  );
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

export const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

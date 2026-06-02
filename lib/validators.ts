import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().optional(),
});

export const updateTranscriptionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().nullable().optional(),
  rawText: z.string().optional(),
});

export const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

export const noteSchema = z.object({
  content: z.string().min(1).max(2000),
  timestamp: z.number().optional(),
});

export const keyPointUpdateSchema = z.object({
  done: z.boolean().optional(),
  content: z.string().min(1).optional(),
  order: z.number().int().optional(),
});

export const summarySchema = z.object({
  shortSummary: z.string(),
  longSummary: z.string(),
  topics: z.array(z.string()),
  sentiment: z
    .enum(["positivo", "neutral", "negativo", "mixto"])
    .or(z.string()),
});

export const keyPointsSchema = z.object({
  points: z.array(
    z.object({
      content: z.string(),
      category: z.string().optional(),
      importance: z.number().int().min(1).max(5).default(3),
      timestamp: z.number().optional(),
    })
  ),
});

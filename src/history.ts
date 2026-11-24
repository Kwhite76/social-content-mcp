import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REEL_STYLES } from "./reel/styles.js";

/** Older logs called subjects "cards" and backgrounds "textures"; read both. */
export function legacyNames(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { cards, texture, ...rest } = raw as Record<string, unknown>;
  return {
    ...rest,
    ...(rest.subjects === undefined && cards !== undefined ? { subjects: cards } : {}),
    ...(rest.background === undefined && texture !== undefined ? { background: texture } : {}),
  };
}

/** One published (or drafted) post, as kept in <brand kit>/history.jsonl. */
export const EntryObject = z.object({
  date: z.iso.date(),
  topic: z.string(),
  format: z.string(),
  angle: z.string().default(""),
  subjects: z.array(z.string()).default([]), // featured products, people, places, items
  facts: z.array(z.string()).default([]), // facts and topics used (never reused)
  background: z.string().optional(),
  layout: z.string().optional(),
  reel_style: z.enum(REEL_STYLES).optional(),
  caption: z.string().optional(),
  reel_beats: z.array(z.string()).optional(),
  ai_score: z.number().optional(),
  image: z.string().optional(),
  reel: z.string().optional(),
  sources: z.array(z.string()).default([]),
  notes: z.string().optional(),
  logged_at: z.string().optional(),
});
/** EntryObject, also reading the older field names */
export const EntrySchema = z.preprocess(legacyNames, EntryObject);
export type Entry = z.infer<typeof EntrySchema>;

export const historyFile = (kitDir: string) => path.join(kitDir, "history.jsonl");

export function readHistory(kitDir: string): { entries: Entry[]; badLines: number[] } {
  const file = historyFile(kitDir);
  if (!fs.existsSync(file)) return { entries: [], badLines: [] };
  const entries: Entry[] = [];
  const badLines: number[] = [];
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      entries.push(EntrySchema.parse(JSON.parse(line)));
    } catch {
      badLines.push(i + 1);
    }
  });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, badLines };
}

export function appendHistory(kitDir: string, entry: Entry): Entry {
  const e = EntrySchema.parse({ ...entry, logged_at: entry.logged_at ?? new Date().toISOString() });
  fs.mkdirSync(kitDir, { recursive: true });
  fs.appendFileSync(historyFile(kitDir), JSON.stringify(e) + "\n");
  return e;
}

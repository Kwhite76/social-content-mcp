import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The AI-writing check: desklib/ai-text-detector-v1.01 (MIT; DeBERTa-v3-large with mean pooling
 * and one logit), converted to ONNX and run locally with onnxruntime-node. Scores text the way
 * houtini-ai/ai-detect does, so its numbers match: split into sentences after . ! or ? followed
 * by whitespace, skip sentences under 5 words, score each (sigmoid of the logit), and report the
 * mean of the scored sentences as a percentage.
 *
 * The model (about 1.7 GB) isn't in the extension: it's downloaded once, on first use, from the
 * project's GitHub release, checked against its SHA-256, and kept in the app folder.
 *
 * It runs on onnxruntime-node where that has a build, and on onnxruntime-web (WebAssembly) where it
 * doesn't (Intel Macs): slower, same results. So every computer gets the check.
 */

export const MODEL_NAME = "desklib-ai-text-detector-v1.01";
export const MIN_WORDS = 5;
const MAX_TOKENS = 512;
const BATCH = 8;
const DEFAULT_SOURCE = "https://github.com/Kwhite76/social-content-mcp/releases/download/detector-model-v1";

export interface SentenceScore { text: string; ai_probability: number | null; label: "AI" | "Human" | "Skipped" }
export interface DetectResult {
  score_pct: number | null;
  verdict: "LIKELY AI" | "MIXED" | "LIKELY HUMAN" | "NOT SCORED";
  scored: number;
  skipped: number;
  sentences: SentenceScore[];
}

/** Sentences as houtini-ai/ai-detect splits them: after . ! or ? followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Scores text with a scorer that maps sentences to AI probabilities (0..1). */
export async function scoreText(text: string, score: (sentences: string[]) => Promise<number[]>): Promise<DetectResult> {
  const all = splitSentences(text);
  const toScore = all.filter((s) => words(s) >= MIN_WORDS);
  const probs = toScore.length ? await score(toScore) : [];
  const byText = new Map<number, number>();
  toScore.forEach((_, i) => byText.set(i, probs[i]));
  let k = 0;
  const sentences: SentenceScore[] = all.map((s) => {
    if (words(s) < MIN_WORDS) return { text: s, ai_probability: null, label: "Skipped" };
    const p = byText.get(k++)!;
    return { text: s, ai_probability: +p.toFixed(4), label: p >= 0.5 ? "AI" : "Human" };
  });
  if (!probs.length) return { score_pct: null, verdict: "NOT SCORED", scored: 0, skipped: all.length, sentences };
  const pct = Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 1000) / 10;
  return {
    score_pct: pct,
    verdict: pct > 50 ? "LIKELY AI" : pct < 40 ? "LIKELY HUMAN" : "MIXED",
    scored: probs.length,
    skipped: all.length - probs.length,
    sentences,
  };
}

// ---------- the model files ----------

interface ManifestFile { name: string; bytes: number; sha256: string }
interface Manifest { model: string; variant: string; files: ManifestFile[] }

export type DetectorState =
  | { state: "ready"; dir: string; variant: string; runtime: "native" | "wasm" }
  | { state: "not downloaded"; size_mb?: number }
  | { state: "downloading"; done_mb: number; total_mb: number; percent: number }
  | { state: "failed"; error: string }
  | { state: "unavailable"; reason: string };

export class Detector {
  private dir: string;
  private source: string;
  private download?: Promise<void>;
  private progress = { done: 0, total: 0 };
  private error?: string;
  private session?: Promise<{ run: (ids: number[][]) => Promise<number[]> }>;

  constructor(appDir: string, opts: { source?: string; modelDir?: string } = {}) {
    this.dir = opts.modelDir ?? path.join(appDir, "models", MODEL_NAME);
    this.source = (opts.source ?? DEFAULT_SOURCE).replace(/\/+$/, "");
  }

  private ready(): Manifest | undefined {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.dir, "manifest.json"), "utf8")) as Manifest;
      return m.files.every((f) => fs.existsSync(path.join(this.dir, f.name)) && fs.statSync(path.join(this.dir, f.name)).size === f.bytes) ? m : undefined;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<DetectorState> {
    const runtime = await loadRuntime();
    if (!runtime.ok) return { state: "unavailable", reason: runtime.reason };
    const m = this.ready();
    if (m) return { state: "ready", dir: this.dir, variant: m.variant, runtime: runtime.kind };
    if (this.download) {
      const mb = (n: number) => Math.round(n / 1e6);
      return { state: "downloading", done_mb: mb(this.progress.done), total_mb: mb(this.progress.total), percent: this.progress.total ? Math.floor((100 * this.progress.done) / this.progress.total) : 0 };
    }
    if (this.error) return { state: "failed", error: this.error };
    return { state: "not downloaded" };
  }

  /** Starts the one-time download (if needed) and returns at once. */
  startDownload(): void {
    if (this.ready() || this.download) return;
    this.error = undefined;
    this.download = this.fetchModel().catch((e) => { this.error = (e as Error).message; }).finally(() => { this.download = undefined; });
  }

  /** Waits for the download, up to ms. */
  async waitForDownload(ms: number): Promise<void> {
    if (!this.download) return;
    await Promise.race([this.download, new Promise((r) => setTimeout(r, ms))]);
  }

  private async fetchModel() {
    fs.mkdirSync(this.dir, { recursive: true });
    const res = await fetch(`${this.source}/manifest.json`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`couldn't get the detector's file list (HTTP ${res.status})`);
    const manifest = (await res.json()) as Manifest;
    this.progress = { done: 0, total: manifest.files.reduce((a, f) => a + f.bytes, 0) };
    for (const f of manifest.files) {
      const dest = path.join(this.dir, f.name);
      if (fs.existsSync(dest) && fs.statSync(dest).size === f.bytes && (await sha256(dest)) === f.sha256) {
        this.progress.done += f.bytes;
        continue;
      }
      const part = dest + ".part";
      const r = await fetch(`${this.source}/${f.name}`);
      if (!r.ok || !r.body) throw new Error(`download of ${f.name} failed (HTTP ${r.status})`);
      const out = fs.createWriteStream(part);
      const hash = crypto.createHash("sha256");
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        this.progress.done += chunk.length;
        if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok));
      }
      await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
      if (hash.digest("hex") !== f.sha256) { fs.rmSync(part, { force: true }); throw new Error(`${f.name} didn't match its checksum; try again`); }
      fs.renameSync(part, dest);
    }
    fs.writeFileSync(path.join(this.dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  /** Scores text; the model must be downloaded. */
  async detect(text: string): Promise<DetectResult> {
    return scoreText(text, (sentences) => this.scoreSentences(sentences));
  }

  /** AI probability for each sentence, as is (no splitting or skipping). */
  async scoreSentences(sentences: string[]): Promise<number[]> {
    const s = await this.loadSession();
    const tok = await this.tokenizer();
    const ids = sentences.map((t) => tok(t));
    const out: number[] = [];
    for (let i = 0; i < ids.length; i += BATCH) out.push(...(await s.run(ids.slice(i, i + BATCH))));
    return out;
  }

  /** Token ids for one sentence, as the model sees them. */
  async tokenize(text: string): Promise<number[]> {
    return (await this.tokenizer())(text);
  }

  private tok?: (t: string) => number[];
  private async tokenizer() {
    if (this.tok) return this.tok;
    const { Tokenizer } = await import("@huggingface/tokenizers");
    const json = JSON.parse(fs.readFileSync(path.join(this.dir, "tokenizer.json"), "utf8"));
    const config = JSON.parse(fs.readFileSync(path.join(this.dir, "tokenizer_config.json"), "utf8"));
    const t = new Tokenizer(json, config);
    const sep = t.token_to_id(config.sep_token ?? "[SEP]")!;
    // truncate the way transformers does with special tokens: keep the start, end with [SEP]
    this.tok = (text: string) => {
      const ids = t.encode(text).ids;
      return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), sep] : ids;
    };
    return this.tok;
  }

  private loadSession() {
    this.session ??= (async () => {
      const runtime = await loadRuntime();
      if (!runtime.ok) throw new Error(`The AI detector isn't available on this computer: ${runtime.reason}`);
      if (!this.ready()) throw new Error("The AI detector's model isn't downloaded yet.");
      const ort = runtime.ort;
      const modelFile = path.join(this.dir, "model.onnx");
      const session = runtime.kind === "native"
        ? await ort.InferenceSession.create(modelFile, {
          graphOptimizationLevel: "all",
          intraOpNumThreads: Math.max(1, Math.min(8, os.availableParallelism() - 1)),
        })
        : await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(modelFile)), { graphOptimizationLevel: "all" });
      const pad = 0;
      return {
        run: async (batch: number[][]) => {
          const len = Math.max(...batch.map((b) => b.length));
          const ids = new BigInt64Array(batch.length * len), mask = new BigInt64Array(batch.length * len);
          batch.forEach((b, r) => b.forEach((id, c) => { ids[r * len + c] = BigInt(id); mask[r * len + c] = 1n; }));
          for (let r = 0; r < batch.length; r++) for (let c = batch[r].length; c < len; c++) ids[r * len + c] = BigInt(pad);
          const res = await session.run({
            input_ids: new ort.Tensor("int64", ids, [batch.length, len]),
            attention_mask: new ort.Tensor("int64", mask, [batch.length, len]),
          });
          const logits = res.logits.data as Float32Array;
          return Array.from(logits, (z) => 1 / (1 + Math.exp(-z)));
        },
      };
    })().catch((e) => { this.session = undefined; throw e; });
    return this.session;
  }
}

async function sha256(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

type Ort = typeof import("onnxruntime-node");
type Runtime = { ok: true; ort: Ort; kind: "native" | "wasm" } | { ok: false; reason: string };
let runtimeCache: Promise<Runtime> | undefined;

/**
 * The ONNX runtime: onnxruntime-node (native, fastest), or onnxruntime-web's WebAssembly build
 * where the native one has no binary (Intel Macs). SCM_DETECTOR_RUNTIME=wasm forces the second.
 */
export function loadRuntime(): Promise<Runtime> {
  runtimeCache ??= (async (): Promise<Runtime> => {
    let nativeError = "skipped";
    if (process.env.SCM_DETECTOR_RUNTIME !== "wasm") {
      try {
        return { ok: true, ort: await import("onnxruntime-node"), kind: "native" };
      } catch (e) {
        nativeError = (e as Error).message.split("\n")[0];
      }
    }
    try {
      const web = (await import("onnxruntime-web")) as unknown as Ort & { env: { wasm: { numThreads: number } } };
      web.env.wasm.numThreads = Math.max(1, Math.min(4, os.availableParallelism() - 1));
      return { ok: true, ort: web, kind: "wasm" };
    } catch (e) {
      return { ok: false, reason: `no ONNX runtime loaded (native: ${nativeError}; WebAssembly: ${(e as Error).message.split("\n")[0]})` };
    }
  })();
  return runtimeCache;
}

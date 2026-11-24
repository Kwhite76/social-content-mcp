import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Detector, scoreText, splitSentences } from "../src/detect/detector.js";
import { createServer } from "../src/server.js";

// A stand-in for the real model: a DeBERTa-v3-style tokenizer and a tiny ONNX model with the same
// inputs and outputs. expected.json has Python's token ids and probabilities for every sample.
const FIX = path.join(import.meta.dirname, "fixtures", "detector");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8")) as Array<{ text: string; ids: number[]; probability: number }>;
const body = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

/** Serves the fixture like the GitHub release; counts requests per file. */
function release() {
  const hits: Record<string, number> = {};
  const srv = http.createServer((req, res) => {
    const name = path.basename(req.url!);
    hits[name] = (hits[name] ?? 0) + 1;
    const f = path.join(FIX, name);
    if (!fs.existsSync(f) || name === "expected.json") { res.writeHead(404); return res.end(); }
    res.end(fs.readFileSync(f));
  }).listen(0);
  return { url: `http://localhost:${(srv.address() as { port: number }).port}`, hits, close: () => srv.close() };
}

describe("AI-writing detector", () => {
  it("splits and skips sentences like houtini-ai/ai-detect", async () => {
    expect(splitSentences("  One two three four five. Short one! Is this six words long? Dr. Smith said hi.\nNo split here\nbut here. ")).toEqual(
      ["One two three four five.", "Short one!", "Is this six words long?", "Dr.", "Smith said hi.", "No split here\nbut here."]);
    const r = await scoreText("This sentence has more than five words. Too short. Another sentence with plenty of words in it.", async (s) => s.map((_, i) => [0.2, 0.7][i]));
    expect(r).toMatchObject({ score_pct: 45, verdict: "MIXED", scored: 2, skipped: 1 });
    expect(r.sentences.map((s) => s.label)).toEqual(["Human", "Skipped", "AI"]);
    expect((await scoreText("Tiny. Also tiny.", async () => [])).verdict).toBe("NOT SCORED");
  });

  it("tokenizes exactly like the Python tokenizer and scores like the model, including text past 512 tokens", async () => {
    const d = new Detector(os.tmpdir(), { modelDir: FIX });
    for (const e of expected) expect(await d.tokenize(e.text)).toEqual(e.ids);
    const got = await d.scoreSentences(expected.map((e) => e.text));
    got.forEach((p, i) => expect(p).toBeCloseTo(expected[i].probability, 5));
  });

  it("downloads the model once, checks it, and scores through the tool", async () => {
    const rel = release();
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "det-state-"));
    try {
      const cfg = loadConfig({ SCM_BRAND_KIT_DIR: path.join(import.meta.dirname, "fixtures", "kit"), SCM_STATE_DIR: state, SCM_DETECTOR_URL: rel.url });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await createServer(cfg).connect(a);
      const c = new Client({ name: "t", version: "0" });
      await c.connect(b);

      expect(body(await c.callTool({ name: "ai_detector_status", arguments: {} })).state).toBe("not downloaded");
      const text = `${expected[0].text} Way too short. ${expected[8].text}`;
      const r = body(await c.callTool({ name: "detect_ai_text", arguments: { text } })); // downloads, then scores
      expect(r).toMatchObject({ scored: 2, skipped: 1, target_pct: 15 });
      expect(r.score_pct).toBeCloseTo(Math.round(((expected[0].probability + expected[8].probability) / 2) * 1000) / 10, 5);
      expect(r.meets_target).toBe(r.score_pct < 15);
      expect(body(await c.callTool({ name: "ai_detector_status", arguments: {} })).state).toBe("ready");

      await c.callTool({ name: "detect_ai_text", arguments: { text } });
      expect(rel.hits["model.onnx"]).toBe(1); // kept after the first download
    } finally {
      rel.close();
    }
  });

  it("refuses a download that doesn't match its checksum", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "det-bad-"));
    const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
    manifest.files[0].sha256 = "0".repeat(64);
    const srv = http.createServer((req, res) => {
      const name = path.basename(req.url!);
      res.end(name === "manifest.json" ? JSON.stringify(manifest) : fs.readFileSync(path.join(FIX, name)));
    }).listen(0);
    try {
      const d = new Detector(os.tmpdir(), { modelDir: dir, source: `http://localhost:${(srv.address() as { port: number }).port}` });
      d.startDownload();
      await d.waitForDownload(30_000);
      const st = await d.status();
      expect(st.state).toBe("failed");
      expect((st as { error: string }).error).toMatch(/checksum/);
      expect(fs.readdirSync(dir).some((f) => f.endsWith(".part"))).toBe(false);
    } finally {
      srv.close();
    }
  });
});

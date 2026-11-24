import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The WebAssembly runtime, used where onnxruntime-node has no build (Intel Macs), must give the
// same scores as the Python model.
process.env.SCM_DETECTOR_RUNTIME = "wasm";
const FIX = path.join(import.meta.dirname, "fixtures", "detector");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8")) as Array<{ text: string; probability: number }>;

describe("AI-writing detector on WebAssembly", () => {
  it("scores like the Python model", async () => {
    const { Detector, loadRuntime } = await import("../src/detect/detector.js");
    expect(await loadRuntime()).toMatchObject({ ok: true, kind: "wasm" });
    const d = new Detector(os.tmpdir(), { modelDir: FIX });
    expect(await d.status()).toMatchObject({ state: "ready", runtime: "wasm" });
    const got = await d.scoreSentences(expected.map((e) => e.text));
    got.forEach((p, i) => expect(p).toBeCloseTo(expected[i].probability, 5));
    const r = await d.detect(`${expected[0].text} Too short here. ${expected[8].text}`);
    expect(r.scored).toBe(2);
  }, 60_000);
});

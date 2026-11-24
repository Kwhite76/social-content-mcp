// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
// Checks the Node detector against the original PyTorch model, then assembles the release files.
//   tsx scripts/detector/parity.ts <export dir> <release dir>
// Fails unless the tokenizer matches exactly and the fp32 model matches within 0.01. Ships the
// int8 model when it stays within 0.05 with no sentence changing sides of 0.5, else the fp32 one.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Detector, MODEL_NAME } from "../../src/detect/detector.js";

const [exp, rel] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(path.join(exp, "expected.json"), "utf8")) as Array<{ text: string; ids: number[]; probability: number }>;
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function variantDir(variant: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `det-${variant}-`));
  const files = ["tokenizer.json", "tokenizer_config.json"];
  for (const f of files) fs.copyFileSync(path.join(exp, f), path.join(d, f));
  fs.symlinkSync(path.resolve(exp, `model-${variant}.onnx`), path.join(d, "model.onnx"));
  const list = [...files, "model.onnx"].map((name) => ({ name, bytes: fs.statSync(path.join(d, name)).size, sha256: "-" }));
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ model: MODEL_NAME, variant, files: list }));
  return d;
}

const report: Record<string, unknown> = { samples: expected.length };
const det32 = new Detector(os.tmpdir(), { modelDir: variantDir("fp32") });
const tokenMismatches = [];
for (const e of expected) {
  const ids = await det32.tokenize(e.text);
  if (JSON.stringify(ids) !== JSON.stringify(e.ids)) tokenMismatches.push({ text: e.text, python: e.ids.slice(0, 12), node: ids.slice(0, 12) });
}
report.tokenizer_mismatches = tokenMismatches;

const compare = async (variant: string) => {
  const d = new Detector(os.tmpdir(), { modelDir: variantDir(variant) });
  const t0 = Date.now();
  const got = await d.scoreSentences(expected.map((e) => e.text));
  const diffs = got.map((p, i) => Math.abs(p - expected[i].probability));
  return {
    max_abs: +Math.max(...diffs).toFixed(4),
    mean_abs: +(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(4),
    label_flips: got.filter((p, i) => p >= 0.5 !== expected[i].probability >= 0.5).length,
    ms_per_sentence: Math.round((Date.now() - t0) / got.length),
    bytes: fs.statSync(path.join(exp, `model-${variant}.onnx`)).size,
  };
};
const fp32 = await compare("fp32");
const int8 = await compare("int8");
report.fp32 = fp32;
report.int8 = int8;
const variant = int8.max_abs <= 0.05 && int8.label_flips === 0 ? "int8" : "fp32";
report.shipped = variant;
console.log(JSON.stringify(report, null, 2));

if (tokenMismatches.length) throw new Error(`tokenizer differs from Python on ${tokenMismatches.length} samples`);
if (fp32.max_abs > 0.01) throw new Error(`fp32 ONNX differs from PyTorch by up to ${fp32.max_abs}`);

fs.mkdirSync(rel, { recursive: true });
fs.copyFileSync(path.join(exp, `model-${variant}.onnx`), path.join(rel, "model.onnx"));
for (const f of ["tokenizer.json", "tokenizer_config.json"]) fs.copyFileSync(path.join(exp, f), path.join(rel, f));
const files = ["model.onnx", "tokenizer.json", "tokenizer_config.json"].map((name) => ({ name, bytes: fs.statSync(path.join(rel, name)).size, sha256: sha(path.join(rel, name)) }));
fs.writeFileSync(path.join(rel, "manifest.json"), JSON.stringify({ model: MODEL_NAME, variant, files }, null, 2));
fs.writeFileSync(path.join(rel, "parity.json"), JSON.stringify(report, null, 2));

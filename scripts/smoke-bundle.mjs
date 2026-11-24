// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
// Starts a packed bundle's server the way Claude Desktop does and checks it answers:
// lists tools, loads a brand kit, and renders a short reel with the bundled ffmpeg and canvas.
//   node scripts/smoke-bundle.mjs build/mcpb-<platform>-<arch>
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const bundle = path.resolve(process.argv[2]);
const kit = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-kit-"));
fs.cpSync(path.join(import.meta.dirname, "..", "tests", "fixtures", "kit"), kit, { recursive: true });
// a plain test post
fs.mkdirSync(path.join(kit, "output"), { recursive: true });
fs.copyFileSync(path.join(kit, "logo", "logo.png"), path.join(kit, "output", "post.png"));

// a stand-in AI detector model, served like the GitHub release (checks the ONNX runtime loads)
const detFix = path.join(import.meta.dirname, "..", "tests", "fixtures", "detector");
const srv = http.createServer((req, res) => res.end(fs.readFileSync(path.join(detFix, path.basename(req.url))))).listen(0);
const detUrl = `http://localhost:${srv.address().port}`;

for (const f of ["LICENSE", "NOTICE"])
  if (!fs.existsSync(path.join(bundle, f))) throw new Error(`${f} missing from the bundle`);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(bundle, "dist", "cli.js"), "serve"],
  env: { ...process.env, SCM_BRAND_KIT_DIR: kit, SCM_AUTO_KEEPER: "false", SCM_DETECTOR_URL: detUrl,
    SCM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "smoke-state-")) },
});
const c = new Client({ name: "smoke", version: "0" });
await c.connect(transport);
const tools = (await c.listTools()).tools.map((t) => t.name);
if (tools.length < 15) throw new Error(`only ${tools.length} tools`);
const kitRes = JSON.parse((await c.callTool({ name: "analyze_brand_kit", arguments: {} })).content[0].text);
if (!kitRes.ok) throw new Error(`kit: ${kitRes.problems.join("; ")}`);
const guide = (await c.callTool({ name: "get_guide", arguments: { name: "setup" } })).content[0].text;
if (!/first-time setup/i.test(guide)) throw new Error("setup guide missing from the bundle");
const reel = await c.callTool({ name: "render_reel", arguments: { post_file: "post.png", style: "pushin", file_name: "smoke.mp4", check_frames: false } });
if (reel.isError) throw new Error(`reel: ${reel.content[0].text}`);
const r = JSON.parse(reel.content[0].text);
if (!(r.seconds > 7 && fs.statSync(r.path).size > 10_000)) throw new Error(`reel looks wrong: ${JSON.stringify(r)}`);
const added = await c.callTool({ name: "add_brand_file", arguments: { kind: "style", source_path: path.join(kit, "logo") } });
if (added.isError || !added.content.some((x) => x.type === "image")) throw new Error(`add_brand_file preview: ${JSON.stringify(added).slice(0, 300)}`);
const det = await c.callTool({ name: "detect_ai_text", arguments: { text: "We roasted the Guji a little lighter this week and it tastes like peach tea now." } });
if (det.isError) throw new Error(`detector: ${det.content[0].text}`);
await c.close();

// the WebAssembly fallback (used where the native runtime has no build) must work from the bundle too
const wasm = new Client({ name: "smoke-wasm", version: "0" });
await wasm.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(bundle, "dist", "cli.js"), "serve"],
  env: { ...process.env, SCM_BRAND_KIT_DIR: kit, SCM_AUTO_KEEPER: "false", SCM_DETECTOR_URL: detUrl, SCM_DETECTOR_RUNTIME: "wasm",
    SCM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "smoke-state-")) },
}));
const detW = await wasm.callTool({ name: "detect_ai_text", arguments: { text: "We roasted the Guji a little lighter this week and it tastes like peach tea now." } });
if (detW.isError) throw new Error(`detector (WebAssembly): ${detW.content[0].text}`);
const st = JSON.parse((await wasm.callTool({ name: "ai_detector_status", arguments: {} })).content[0].text);
if (st.runtime !== "wasm") throw new Error(`expected the WebAssembly runtime, got ${st.runtime}`);
await wasm.close();
srv.close();
const a = JSON.parse(det.content[0].text).score_pct, b = JSON.parse(detW.content[0].text).score_pct;
if (a !== b) throw new Error(`native and WebAssembly scores differ: ${a} vs ${b}`);
console.log(`bundle OK: ${tools.length} tools, reel ${r.seconds} s in ${r.renderMs} ms, detector ${a}% (native and WebAssembly agree)`);

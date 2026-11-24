// Starts a packed bundle's server the way Claude Desktop does and checks it answers:
// lists tools, loads a brand kit, and renders a short reel with the bundled ffmpeg and canvas.
//   node scripts/smoke-bundle.mjs build/mcpb-<platform>-<arch>
import fs from "node:fs";
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

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(bundle, "dist", "cli.js"), "serve"],
  env: { ...process.env, SCM_BRAND_KIT_DIR: kit, SCM_AUTO_KEEPER: "false" },
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
await c.close();
console.log(`bundle OK: ${tools.length} tools, reel ${r.seconds} s in ${r.renderMs} ms`);

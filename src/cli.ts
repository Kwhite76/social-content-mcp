#!/usr/bin/env node
import fs from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { runKeeper } from "./keeper/keeper.js";

const [cmd = "serve"] = process.argv.slice(2);
const cfg = loadConfig();

if (cmd === "serve") {
  const server = createServer(cfg);
  await server.connect(new StdioServerTransport());
} else if (cmd === "keeper") {
  await runKeeper(cfg.penpotUrl + "/");
} else if (cmd === "reel") {
  // social-content-mcp reel <post.png> <logo.png> <style> <out.mp4> [beats.json]
  const [post, logo, style, out, beatsFile] = process.argv.slice(3);
  const { renderReel } = await import("./reel/render.js");
  const beats = beatsFile ? JSON.parse(fs.readFileSync(beatsFile, "utf8")).beats : [];
  console.log(JSON.stringify(await renderReel({ post, logo, style: style as never, beats }, out)));
} else {
  console.error("usage: social-content-mcp [serve|keeper|reel <post> <logo> <style> <out.mp4> [beats.json]]");
  process.exit(2);
}

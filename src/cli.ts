#!/usr/bin/env node
// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { KeeperBusy, runKeeper } from "./keeper/keeper.js";

const [cmd = "serve"] = process.argv.slice(2);
const cfg = loadConfig();

if (cmd === "serve") {
  const { KeeperSupervisor } = await import("./keeper/supervisor.js");
  // the keeper needs the key to be useful, and can be turned off in the extension settings
  const keeper = cfg.autoKeeper && cfg.penpotKey ? new KeeperSupervisor(cfg.penpotUrl + "/", { url: cfg.penpotUrl, key: cfg.penpotKey }) : undefined;
  const server = createServer(cfg, { keeper });
  await server.connect(new StdioServerTransport());
  keeper?.start();
  // Claude Desktop closes stdin (or sends a signal) when it quits or disables the extension:
  // close the keeper's browser first so it isn't left running
  let closing = false;
  const quit = () => {
    if (closing) return;
    closing = true;
    void (keeper?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
  };
  process.stdin.on("end", quit);
  process.stdin.on("close", quit);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) process.on(sig, quit);
} else if (cmd === "keeper") {
  try {
    const { PenpotBridge } = await import("./penpot.js");
    const bridge = cfg.penpotKey ? new PenpotBridge(cfg.penpotUrl, cfg.penpotKey) : undefined;
    await runKeeper(cfg.penpotUrl + "/", {
      probe: bridge ? async () => { try { await bridge.execute("return 1;"); } catch (e) { await bridge.close(); throw e; } } : undefined,
    });
  } catch (e) {
    if (e instanceof KeeperBusy) {
      console.error(`${e.message} Nothing to do: Penpot is already being kept connected.`);
      process.exit(3);
    }
    throw e;
  }
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

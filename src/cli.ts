#!/usr/bin/env node
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
} else {
  console.error("usage: social-content-mcp [serve|keeper]");
  process.exit(2);
}

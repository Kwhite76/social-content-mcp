// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
// Spike: can a plain MCP client reach Penpot's hosted MCP with just the MCP key?
// Usage (PowerShell):  $env:SCM_PENPOT_MCP_KEY="..."; npm run spike:penpot
import { loadConfig } from "../src/config.js";
import { PenpotBridge } from "../src/penpot.js";

const cfg = loadConfig();
const penpot = new PenpotBridge(cfg.penpotUrl, cfg.penpotKey);
try {
  console.log("tools:", (await penpot.tools()).join(", "));
  console.log("open file:", await penpot.execute("return penpot.currentFile ? penpot.currentFile.name : null;"));
  console.log("OK: the key alone is enough.");
} catch (e) {
  console.error("FAILED:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await penpot.close();
}

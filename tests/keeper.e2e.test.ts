import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Runs the real keeper (built CLI) headless against a page that mimics Penpot's MCP menu.
// Needs Chrome or Edge installed; enable with KEEPER_E2E=1 (CI does).
function runKeeper(query: string) {
  const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "penpot-mock.html"));
  // with "freeze", the first page load hangs for good after 6 s, like a tab the browser froze
  let frozenOnce = false;
  const srv = http.createServer((_, res) => {
    const freeze = query.includes("freeze") && !frozenOnce;
    frozenOnce ||= freeze;
    res.end(html.toString().replace("/*FREEZE*/", freeze ? "setTimeout(() => { for (;;) {} }, 6000);" : ""));
  }).listen(0);
  const port = (srv.address() as { port: number }).port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-home-"));
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "dist", "cli.js"), "keeper"], {
    env: { ...process.env, HOME: home, USERPROFILE: home, KEEPER_HEADLESS: "1", KEEPER_CHECK_MS: "2000",
      KEEPER_FILE_URL: `http://localhost:${port}/workspace?file-id=test${query}` },
    stdio: "ignore",
  });
  const logFile = path.join(home, ".social-content-mcp", "keeper", "keeper.log");
  const waitFor = async (re: RegExp, ms: number) => {
    const deadline = Date.now() + ms;
    let log = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      if (re.test(log)) break;
    }
    return log;
  };
  const stop = () => { child.kill(); srv.close(); };
  return { waitFor, stop };
}

describe.skipIf(!process.env.KEEPER_E2E)("keeper (e2e)", () => {
  it("connects, notices the drop and reconnects", async () => {
    const k = runKeeper("");
    try {
      const log = await k.waitFor(/dropped[\s\S]*MCP connected\./, 60_000);
      expect(log).toMatch(/Clicked MCP > Connect\./);
      expect(log).toMatch(/MCP connection dropped\.[\s\S]*MCP connected\./);
    } finally { k.stop(); }
  }, 90_000);

  it("restarts the browser when the page freezes, then reconnects", async () => {
    const k = runKeeper("&freeze");
    try {
      const log = await k.waitFor(/(stopped responding|Problem:)[\s\S]*MCP connected\./, 120_000);
      expect(log).toMatch(/(Page stopped responding|Problem: .*timed out)/);
      expect(log).toMatch(/(stopped responding|Problem:)[\s\S]*MCP connected\./);
    } finally { k.stop(); }
  }, 150_000);
});

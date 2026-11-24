import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Runs the real keeper (built CLI) headless against a page that mimics Penpot's MCP menu.
// Needs Chrome or Edge installed; enable with KEEPER_E2E=1 (CI does).
describe.skipIf(!process.env.KEEPER_E2E)("keeper (e2e)", () => {
  it("connects, notices the drop and reconnects", async () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "penpot-mock.html"));
    const srv = http.createServer((_, res) => res.end(html)).listen(0);
    const port = (srv.address() as { port: number }).port;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-home-"));
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "dist", "cli.js"), "keeper"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, KEEPER_HEADLESS: "1", KEEPER_CHECK_MS: "2000",
        KEEPER_FILE_URL: `http://localhost:${port}/workspace?file-id=test` },
      stdio: "ignore",
    });
    try {
      const logFile = path.join(home, ".social-content-mcp", "keeper", "keeper.log");
      const deadline = Date.now() + 60_000;
      let log = "";
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
        if (/dropped[\s\S]*MCP connected\./.test(log)) break;
      }
      expect(log).toMatch(/Clicked MCP > Connect\./);
      expect(log).toMatch(/MCP connection dropped\.[\s\S]*MCP connected\./);
    } finally {
      child.kill();
      srv.close();
    }
  }, 90_000);
});

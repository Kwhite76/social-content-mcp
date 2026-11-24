import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The keeper in this process against a page that mimics Penpot's MCP menu, with a test call
// standing in for Penpot's server. Needs Chrome or Edge; enable with KEEPER_E2E=1.
process.env.SCM_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-probe-"));
Object.assign(process.env, { KEEPER_HEADLESS: "1", KEEPER_CHECK_MS: "1000", KEEPER_PROBE_TICKS: "1" });

const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "penpot-mock.html"), "utf8")
  .replace("/*FREEZE*/", "").replace(/setTimeout\(\(\) => \{ connected = false[^\n]*\n/, ""); // no simulated drop

describe.skipIf(!process.env.KEEPER_E2E)("keeper test calls and reconnect requests (e2e)", () => {
  it("restarts the browser when Penpot's plugin stops answering, and when asked to reconnect", async () => {
    const srv = http.createServer((_, res) => res.end(html)).listen(0);
    process.env.KEEPER_FILE_URL = `http://localhost:${(srv.address() as { port: number }).port}/workspace?file-id=test`;
    const { runKeeper, requestReconnect, keeperStatus, KEEPER_LOG } = await import("../src/keeper/keeper.js");
    const log = () => (fs.existsSync(KEEPER_LOG) ? fs.readFileSync(KEEPER_LOG, "utf8") : "");
    const waitFor = async (test: () => boolean, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end && !test()) await new Promise((r) => setTimeout(r, 300));
      return test();
    };
    let failing = true;
    const stop = new AbortController();
    const running = runKeeper("http://unused/", {
      signal: stop.signal, by: "test",
      probe: async () => { if (failing) throw new Error("The Penpot plugin tab appears to be suspended by the browser (no heartbeat for 37s)"); },
    });
    try {
      // the dot says connected, but test calls fail twice: restart, then healthy again
      expect(await waitFor(() => /isn't answering\. Restarting the browser/.test(log()), 60_000)).toBe(true);
      const sinceRestart = keeperStatus().since!;
      failing = false;
      expect(await waitFor(() => /isn't answering[\s\S]*MCP connected\.[\s\S]*Test call through Penpot's MCP worked/.test(log()), 60_000)).toBe(true);

      // a tool call saw the stall first: it asks for a reconnect and waits for a fresh connection
      const asked = requestReconnect();
      expect(await waitFor(() => (keeperStatus().since ?? 0) > asked && keeperStatus().state === "connected", 60_000)).toBe(true);
      expect(log()).toMatch(/Asked to reconnect/);
      expect(keeperStatus().since!).toBeGreaterThan(sinceRestart);
    } finally {
      stop.abort();
      await running;
      srv.close();
    }
    expect(log()).toMatch(/Keeper stopped\./);
  }, 150_000);
});

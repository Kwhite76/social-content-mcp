import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The extension starts the keeper on its own: runs the built server (serve) the way Claude Desktop
// does, against a page that mimics Penpot's MCP menu. Needs Chrome or Edge; enable with KEEPER_E2E=1.
const cli = path.join(import.meta.dirname, "..", "dist", "cli.js");
const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "penpot-mock.html"), "utf8").replace("/*FREEZE*/", "");

function setup() {
  const srv = http.createServer((_, res) => res.end(html)).listen(0);
  const port = (srv.address() as { port: number }).port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-auto-"));
  const dir = path.join(home, ".social-content-mcp", "keeper");
  const env = { ...process.env, HOME: home, USERPROFILE: home, KEEPER_HEADLESS: "1", KEEPER_CHECK_MS: "2000",
    KEEPER_FILE_URL: `http://localhost:${port}/workspace?file-id=test`, SCM_PENPOT_MCP_KEY: "test-key", KEEPER_PROBE_TICKS: "0",
    SCM_BRAND_KIT_DIR: path.join(home, "kit") };
  const procs: ChildProcess[] = [];
  const run = (cmd: string) => {
    const p = spawn(process.execPath, [cli, cmd], { env, stdio: ["pipe", "pipe", "pipe"] });
    procs.push(p);
    return p;
  };
  const log = () => (fs.existsSync(path.join(dir, "keeper.log")) ? fs.readFileSync(path.join(dir, "keeper.log"), "utf8") : "");
  const waitFor = async (test: () => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !test()) await new Promise((r) => setTimeout(r, 500));
    return test();
  };
  const browsers = () => {
    try { return execFileSync("pgrep", ["-f", "--", `--user-data-dir=${path.join(dir, "browser-profile")}`]).toString().trim(); }
    catch { return ""; }
  };
  const cleanup = () => { for (const p of procs) p.kill("SIGKILL"); srv.close(); try { execFileSync("pkill", ["-f", home]); } catch {} };
  return { run, log, waitFor, browsers, dir, cleanup };
}

let env: ReturnType<typeof setup> | null = null;
afterEach(() => { env?.cleanup(); env = null; });

describe.skipIf(!process.env.KEEPER_E2E || process.platform === "win32")("keeper started by the extension (e2e)", () => {
  it("starts with the server, blocks a second keeper, and closes its browser when the server stops", async () => {
    env = setup();
    const e = env;
    const server = e.run("serve");
    expect(await e.waitFor(() => /extension\)[\s\S]*MCP connected\./.test(e.log()), 60_000)).toBe(true);

    // someone also runs the keeper by hand: it sees the extension's and leaves
    const second = e.run("keeper");
    const code = await new Promise<number | null>((r) => second.on("exit", r));
    expect(code).toBe(3);

    // Claude Desktop quits: stdin closes
    const exited = new Promise<number | null>((r) => server.on("exit", r));
    server.stdin!.end();
    expect(await exited).toBe(0);
    expect(e.log()).toMatch(/Keeper stopped\./);
    expect(fs.existsSync(path.join(e.dir, "keeper.lock"))).toBe(false);
    expect(await e.waitFor(() => e.browsers() === "", 10_000)).toBe(true);
  }, 120_000);

  it("takes over after the server is killed without cleaning up", async () => {
    env = setup();
    const e = env;
    const first = e.run("serve");
    expect(await e.waitFor(() => /MCP connected\./.test(e.log()), 60_000)).toBe(true);
    expect(e.browsers()).not.toBe("");
    first.kill("SIGKILL"); // no chance to clean up: the lock is left behind (and on some systems the browser)
    await new Promise((r) => setTimeout(r, 1000));
    expect(fs.existsSync(path.join(e.dir, "keeper.lock"))).toBe(true);

    const before = e.log().length;
    e.run("serve");
    expect(await e.waitFor(() => /extension\)[\s\S]*MCP connected\./.test(e.log().slice(before)), 60_000)).toBe(true);
  }, 120_000);
});

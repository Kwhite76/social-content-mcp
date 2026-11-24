// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { keeperStatus, lockOwner, type KeeperStatus } from "./keeper.js";

/**
 * Starts the keeper from the MCP server, so nobody has to run it by hand, and keeps it going:
 * it runs in a worker thread (Claude Desktop's built-in Node can't start Node subprocesses),
 * is restarted with backoff if it crashes, and is stopped cleanly when the server shuts down.
 * If a keeper is already running on this computer (say from the command line), it's left alone,
 * and a watchdog takes over if that one stops.
 */
export class KeeperSupervisor {
  private worker: Worker | null = null;
  private stopping = false;
  private failures = 0;
  private startedAt = 0;
  private retry: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(
    private penpotUrl: string,
    private bridge: { url?: string; key?: string } = {},
    private log: (msg: string) => void = (m) => console.error(m),
  ) {}

  /** Starts the keeper unless one is already running here or elsewhere. Safe to call often. */
  start(): "started" | "already running" | "running elsewhere" {
    this.stopping = false;
    if (!this.watchdog) {
      this.watchdog = setInterval(() => { if (!this.worker && !this.retry && !lockOwner()) this.start(); }, 120_000);
      this.watchdog.unref();
    }
    if (this.worker) return "already running";
    if (lockOwner()) return "running elsewhere";
    const here = fileURLToPath(import.meta.url);
    const isTs = here.endsWith(".ts");
    const w = new Worker(path.join(path.dirname(here), isTs ? "worker.ts" : "worker.js"), {
      workerData: { penpotUrl: this.penpotUrl, bridgeUrl: this.bridge.url, penpotKey: this.bridge.key },
      execArgv: isTs ? ["--import", "tsx"] : [],
      stdout: true, // stdout belongs to MCP: anything the thread prints goes to stderr
    });
    w.stdout.pipe(process.stderr);
    this.worker = w;
    this.startedAt = Date.now();
    w.on("error", (e: Error) => this.log(`keeper thread error: ${e.message}`));
    w.on("exit", (code) => {
      if (this.worker === w) this.worker = null;
      if (this.stopping || code === 3) return; // stopped, or another keeper holds the lock (watchdog covers it)
      if (Date.now() - this.startedAt > 10 * 60_000) this.failures = 0;
      const wait = Math.min(300_000, 5_000 * 2 ** this.failures++);
      this.log(`keeper stopped (code ${code}); restarting in ${Math.round(wait / 1000)} s`);
      this.retry = setTimeout(() => { this.retry = null; if (!this.stopping) this.start(); }, wait);
      this.retry.unref();
    });
    return "started";
  }

  get running() { return this.worker !== null; }

  /**
   * Waits until the keeper reports connected (or needs a sign-in, or time runs out).
   * With after, only a connection made after that time counts (a fresh browser).
   */
  async waitReady(ms: number, after?: number): Promise<KeeperStatus> {
    const deadline = Date.now() + ms;
    for (;;) {
      const st = keeperStatus(8);
      const fresh = !after || (st.since ?? 0) > after;
      if ((st.state === "connected" && fresh) || st.state === "needs_sign_in" || st.state === "paused" || Date.now() >= deadline) return st;
      if (!st.running && !this.worker && !this.retry) this.start();
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /** Closes the keeper's browser and ends its thread. */
  async stop(ms = 20_000): Promise<void> {
    this.stopping = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = this.watchdog = null;
    const w = this.worker;
    if (!w) return;
    const exited = new Promise<void>((r) => w.once("exit", () => r()));
    w.postMessage("stop");
    const t = setTimeout(() => void w.terminate(), ms);
    await exited;
    clearTimeout(t);
  }
}

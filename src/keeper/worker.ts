import { parentPort, workerData } from "node:worker_threads";
import { KeeperBusy, runKeeper } from "./keeper.js";

/** Runs the keeper inside the MCP server's process, in its own thread (see supervisor.ts). */
const { penpotUrl } = workerData as { penpotUrl: string };
const stop = new AbortController();
parentPort?.on("message", (m) => { if (m === "stop") stop.abort(); });

try {
  await runKeeper(penpotUrl, { signal: stop.signal, by: "Social Content extension" });
  process.exit(0);
} catch (e) {
  if (e instanceof KeeperBusy) process.exit(3);
  console.error(`keeper: ${(e as Error).stack ?? e}`);
  process.exit(1);
}

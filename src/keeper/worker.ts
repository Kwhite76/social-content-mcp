import { parentPort, workerData } from "node:worker_threads";
import { PenpotBridge } from "../penpot.js";
import { KeeperBusy, runKeeper } from "./keeper.js";

/** Runs the keeper inside the MCP server's process, in its own thread (see supervisor.ts). */
const { penpotUrl, bridgeUrl, penpotKey } = workerData as { penpotUrl: string; bridgeUrl?: string; penpotKey?: string };
const stop = new AbortController();
parentPort?.on("message", (m) => { if (m === "stop") stop.abort(); });

try {
  await runKeeper(penpotUrl, { signal: stop.signal, by: "Social Content extension", probe: makeProbe(bridgeUrl, penpotKey) });
  process.exit(0);
} catch (e) {
  if (e instanceof KeeperBusy) process.exit(3);
  console.error(`keeper: ${(e as Error).stack ?? e}`);
  process.exit(1);
}

/** A real call through Penpot's MCP with the user's key (none without a key). */
function makeProbe(url?: string, key?: string) {
  if (!url || !key) return undefined;
  const bridge = new PenpotBridge(url, key);
  return async () => {
    try {
      await bridge.execute("return 1;");
    } catch (e) {
      await bridge.close(); // a fresh session next time
      throw e;
    }
  };
}

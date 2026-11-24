import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

async function connect() {
  const cfg = loadConfig({ SCM_BRAND_KIT_DIR: path.join(import.meta.dirname, "fixtures", "kit") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(cfg).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}
const body = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

describe("MCP server", () => {
  it("lists the v0 tools", async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["analyze_brand_kit", "check_batch_plan", "init_brand_kit", "keeper_status", "log_post",
      "penpot_execute", "penpot_status", "plan_batch", "query_history", "render_post", "render_reel"]);
  });

  it("plan_batch returns the rotation", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "plan_batch", arguments: { start: "2026-11-23", days: 3 } }));
    expect(r.slots.map((s: { format: string }) => s.format)).toEqual(["This or That", "Did You Know", "Deck Challenge"]);
  });

  it("check_batch_plan reports a style used twice", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "check_batch_plan", arguments: { posts: [
      { nn: 1, date: "2026-12-01", topic: "Pokémon", format: "Hot Take", reel_style: "spin" },
      { nn: 2, date: "2026-12-02", topic: "One Piece", format: "Collector Q", reel_style: "spin" },
    ] } }));
    expect(r.ok).toBe(false);
    expect(r.violations[0].rule).toBe("style-in-batch");
  });

  it("penpot_status explains a missing key instead of failing", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "penpot_status", arguments: {} }));
    expect(r.key).toBe("missing");
  });
});

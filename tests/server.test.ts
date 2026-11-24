import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

const KIT = path.join(import.meta.dirname, "fixtures", "kit");

async function connect(env: Record<string, string> = {}) {
  const cfg = loadConfig({ SCM_BRAND_KIT_DIR: KIT, ...env });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(cfg).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}
const body = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const tempKit = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "kit-")); fs.cpSync(KIT, d, { recursive: true }); return d; };

describe("MCP server", () => {
  it("lists the tools and the two guides as prompts, with instructions", async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_brand_file", "analyze_brand_kit", "check_batch_plan", "check_caption", "get_guide", "get_insights",
      "init_brand_kit", "keeper_start", "keeper_status", "log_post", "penpot_execute", "penpot_status", "penpot_upload_image",
      "plan_batch", "query_history", "render_post", "render_reel", "save_brand_kit"]);
    expect((await c.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["connect_instagram", "create_posts", "setup"]);
    expect(c.getInstructions()).toMatch(/setup guide/);
    const p = await c.getPrompt({ name: "create_posts", arguments: { days: "3" } });
    expect((p.messages[0].content as { text: string }).text).toMatch(/make a batch of posts[\s\S]*days=3/i);
  });

  it("has no brand of its own: nothing from any one brand in tool descriptions or guides", async () => {
    const c = await connect();
    const all = JSON.stringify(await c.listTools()) + text(await c.callTool({ name: "get_guide", arguments: { name: "setup" } }))
      + text(await c.callTool({ name: "get_guide", arguments: { name: "create_posts" } }))
      + text(await c.callTool({ name: "get_guide", arguments: { name: "connect_instagram" } }));
    expect(all).not.toMatch(/hatchery|pok[eé]mon|one piece|riftbound|tcg|ebay|harbor coffee/i);
  });

  it("plan_batch returns the rotation and the brand's rules", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "plan_batch", arguments: { start: "2026-11-23", days: 3 } }));
    expect(r.slots.map((s: { format: string }) => s.format)).toEqual(["This or That", "Did You Know", "How It's Made"]);
    expect(r.rules.subject_cooldown_days).toBe(30);
    expect(r.backgrounds).toHaveLength(4);
  });

  it("check_batch_plan reports a style used twice", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "check_batch_plan", arguments: { posts: [
      { nn: 1, date: "2026-12-01", topic: "Beans", format: "Hot Take", reel_style: "spin" },
      { nn: 2, date: "2026-12-02", topic: "Brewing", format: "Ask the Audience", reel_style: "spin", subjects: ["V60"] },
    ] } }));
    expect(r.ok).toBe(false);
    expect(r.violations[0].rule).toBe("style-in-batch");
  });

  it("check_caption applies the brand's rules", async () => {
    const c = await connect();
    const good = "We roasted the Guji a little lighter this week, and it tastes like peach tea now. Took three tries and a lot of bad cups to get there. What do you brew it with? #coffee #lightroast";
    expect(body(await c.callTool({ name: "check_caption", arguments: { caption: good } })).ok).toBe(true);
    const bad = body(await c.callTool({ name: "check_caption", arguments: {
      caption: "Big sale today — buy now? Really? 🎉 #a #b #c #d #e", beats: ["one", "two"] } }));
    expect(bad.problems.join("\n")).toMatch(/words[\s\S]*hashtags[\s\S]*questions[\s\S]*emoji[\s\S]*dash[\s\S]*"sale"[\s\S]*"buy"[\s\S]*reel beats/);
  });

  it("save_brand_kit and add_brand_file fill a new kit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    const c = await connect({ SCM_BRAND_KIT_DIR: dir });
    await c.callTool({ name: "init_brand_kit", arguments: {} });
    const brand = YAML.parse(fs.readFileSync(path.join(KIT, "brand.yaml"), "utf8"));
    const pillars = YAML.parse(fs.readFileSync(path.join(KIT, "pillars.yaml"), "utf8"));
    const saved = body(await c.callTool({ name: "save_brand_kit", arguments: { brand, pillars } }));
    expect(saved.written).toEqual(["brand.yaml", "pillars.yaml"]);
    expect(saved.problems).toEqual(["logo/: add the logo as a transparent PNG"]);
    const logo = body(await c.callTool({ name: "add_brand_file", arguments: { kind: "logo", source_path: path.join(KIT, "logo", "logo.png") } }));
    expect(logo.saved).toMatch(/logo\.png$/);
    await c.callTool({ name: "add_brand_file", arguments: { kind: "voice", text: "We say coffee, never java.", file_name: "rules.md" } });
    expect(fs.readFileSync(path.join(dir, "voice", "rules.md"), "utf8")).toContain("never java");
    const notPng = await c.callTool({ name: "add_brand_file", arguments: { kind: "logo", source_path: path.join(dir, "voice", "rules.md") } });
    expect(notPng.isError).toBe(true);
    expect(body(await c.callTool({ name: "analyze_brand_kit", arguments: {} })).ok).toBe(true);
  });

  it("get_insights explains a missing token, and pulls, matches and groups with one", async () => {
    expect(text(await (await connect()).callTool({ name: "get_insights", arguments: {} }))).toMatch(/No Instagram token/);

    const now = Date.now(), iso = (d: number) => new Date(now - d * 86_400_000).toISOString().replace(/\.\d+Z$/, "+0000");
    const media = [
      { id: "m1", caption: "We roasted the Guji lighter this week #coffee", media_type: "VIDEO", media_product_type: "REELS", timestamp: iso(5), permalink: "https://x/1" },
      { id: "m2", caption: "Old photo of our first roaster", media_type: "IMAGE", media_product_type: "FEED", timestamp: iso(9), permalink: "https://x/2" },
      { id: "m3", caption: "brand new", media_type: "IMAGE", media_product_type: "FEED", timestamp: iso(0.5), permalink: "https://x/3" },
    ];
    const seen: string[] = [];
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url!, "http://x");
      seen.push(u.pathname + (u.searchParams.get("metric") ? `?${u.searchParams.get("metric")}` : ""));
      const send = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (u.pathname === "/refresh_access_token") return send({ access_token: "IGnew", expires_in: 5184000 });
      if (u.pathname === "/v25.0/me") return send({ user_id: "17841", username: "harborcoffee", followers_count: 812 });
      if (u.pathname === "/v25.0/me/assigned_instagram_accounts") return send({ data: [{ id: "17841", username: "harborcoffee" }] });
      if (u.pathname === "/v25.0/17841") return send({ id: "17841", username: "harborcoffee", followers_count: 812 });
      if (u.pathname === "/v25.0/17841/media") return send({ data: media });
      if (u.pathname === "/v25.0/17841/insights")
        return send({ data: [{ name: "reach", total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 300 }, { dimension_values: ["NON_FOLLOWER"], value: 700 }] }] } }] });
      const m = u.pathname.match(/\/v25\.0\/(m\d)\/insights/);
      if (m) {
        const metrics = u.searchParams.get("metric")!.split(",");
        if (m[1] === "m2" && metrics.includes("follows")) return send({ error: { message: "unsupported metric", code: 100 } }, 400);
        const v: Record<string, number> = { reach: m[1] === "m1" ? 1000 : 200, saved: 30, shares: 20, likes: 50, comments: 4, views: 1500, total_interactions: 104, ig_reels_avg_watch_time: 6100 };
        return send({ data: metrics.filter((x) => v[x] !== undefined).map((name) => ({ name, values: [{ value: v[name] }] })) });
      }
      send({ error: { message: "not found" } }, 404);
    }).listen(0);
    const port = (srv.address() as { port: number }).port;
    const dir = tempKit();
    fs.writeFileSync(path.join(dir, "history.jsonl"), JSON.stringify({ date: iso(5).slice(0, 10), topic: "Beans", format: "Did You Know", caption: "We roasted the Guji lighter this week #coffee" }) + "\n");
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
    try {
      const c = await connect({ SCM_BRAND_KIT_DIR: dir, SCM_INSTAGRAM_TOKEN: "IGold", SCM_INSTAGRAM_API_BASE: `http://localhost:${port}`, SCM_STATE_DIR: state });
      const r = body(await c.callTool({ name: "get_insights", arguments: {} }));
      expect(r.cached).toBe(false);
      expect(r.account.username).toBe("harborcoffee");
      expect(r.posts).toHaveLength(3);
      const [reel, newest, photo] = [r.posts.find((p: { id: string }) => p.id === "m1"), r.posts.find((p: { id: string }) => p.id === "m3"), r.posts.find((p: { id: string }) => p.id === "m2")];
      expect(reel).toMatchObject({ type: "reel", save_share_rate: 0.05, logged: { topic: "Beans", format: "Did You Know" } });
      expect(reel.metrics.ig_reels_avg_watch_time).toBe(6100);
      expect(photo.metrics.reach).toBe(200); // fell back to the core metrics after "follows" was refused
      expect(newest.too_new).toBe(true);
      expect(r.reach_by_follow_type).toEqual({ followers: 300, non_followers: 700, non_follower_share: 0.7 });
      expect(r.groups.by_type.map((g: { key: string }) => g.key)).toEqual(["photo", "reel"]);
      expect(fs.existsSync(r.saved)).toBe(true);
      expect(seen).toContain("/refresh_access_token");
      expect(JSON.parse(fs.readFileSync(path.join(state, "instagram-token.json"), "utf8")).token).toBe("IGnew");
      expect(body(await c.callTool({ name: "get_insights", arguments: {} })).cached).toBe(true);

      // Unified login (new Meta apps): a system-user token on the Facebook host, never refreshed
      seen.length = 0;
      const u = await connect({ SCM_BRAND_KIT_DIR: dir, SCM_INSTAGRAM_TOKEN: "EAAsystemuser", SCM_INSTAGRAM_API_BASE: `http://localhost:${port}`, SCM_STATE_DIR: state });
      const ru = body(await u.callTool({ name: "get_insights", arguments: { refresh: true } }));
      expect(ru.account).toEqual({ id: "17841", username: "harborcoffee", followers: 812 });
      expect(ru.posts).toHaveLength(3);
      expect(seen).toContain("/v25.0/me/assigned_instagram_accounts");
      expect(seen).not.toContain("/refresh_access_token");
    } finally {
      srv.close();
    }
  });

  it("penpot_status explains a missing key instead of failing", async () => {
    const c = await connect();
    const r = body(await c.callTool({ name: "penpot_status", arguments: {} }));
    expect(r.key).toBe("missing");
  });
});

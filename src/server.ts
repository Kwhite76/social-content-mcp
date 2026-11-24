import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initBrandKit, loadBrandKit } from "./brandkit.js";
import type { Config } from "./config.js";
import { appendHistory, EntrySchema, readHistory } from "./history.js";
import { PenpotBridge } from "./penpot.js";
import { checkPlan, planBatch, RULES } from "./plan.js";
import { REEL_STYLES } from "./reel/styles.js";
import { keeperStatus } from "./keeper/keeper.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });
const today = () => new Date().toISOString().slice(0, 10);

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "social-content-mcp", version: "0.1.0" });
  const penpot = new PenpotBridge(cfg.penpotUrl, cfg.penpotKey);

  const kitProblems = (problems: string[]) => fail(`Brand kit has problems:\n- ${problems.join("\n- ")}`);

  // ---------- brand kit ----------

  server.registerTool("init_brand_kit", {
    title: "Create the brand kit folder",
    description: "Creates the brand kit folder layout (logo/, style/, assets/, voice/, output/) and example brand.yaml and pillars.yaml. Never overwrites existing files.",
    inputSchema: {},
  }, async () => json({ dir: cfg.brandKitDir, created: initBrandKit(cfg.brandKitDir) }));

  server.registerTool("analyze_brand_kit", {
    title: "Check the brand kit",
    description: "Reads and validates the brand kit: brand rules, topics, formats, textures, layouts, reel styles and which reference files exist. Run it first in every session.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const r = loadBrandKit(cfg.brandKitDir);
    return json({ dir: cfg.brandKitDir, ok: r.ok, problems: r.problems, warnings: r.warnings, brand: r.kit?.brand, pillars: r.kit?.pillars, logo: r.kit?.logo, files: r.kit?.files });
  });

  // ---------- planning and history ----------

  server.registerTool("plan_batch", {
    title: "Plan a batch",
    description: "Works out each post's topic and format from the rotation, and returns the recent history the batch has to avoid repeating plus the rules check_batch_plan enforces.",
    inputSchema: {
      start: z.iso.date().optional().describe("First post date, YYYY-MM-DD (default today)"),
      days: z.number().int().min(1).max(31).default(14),
    },
    annotations: { readOnlyHint: true },
  }, async ({ start, days }) => {
    const k = loadBrandKit(cfg.brandKitDir);
    if (!k.kit) return kitProblems(k.problems);
    const first = start ?? today();
    const { entries, badLines } = readHistory(cfg.brandKitDir);
    const since = (n: number) => entries.filter((e) => Date.parse(first) - Date.parse(e.date) < n * 86_400_000);
    return json({
      slots: planBatch(k.kit.pillars, first, days),
      rules: RULES,
      recent: since(RULES.angleCooldownDays).map(({ caption, ...rest }) => rest),
      facts_ever_used: [...new Set(entries.flatMap((e) => e.facts))],
      last_reel_style: [...entries].reverse().find((e) => e.reel_style)?.reel_style ?? null,
      reel_styles: k.kit.pillars.reel_styles,
      textures: k.kit.pillars.textures,
      layouts: k.kit.pillars.layouts,
      history_problems: badLines.length ? `unreadable history lines: ${badLines.join(", ")}` : undefined,
    });
  });

  const Planned = z.object({
    nn: z.number().int(),
    date: z.iso.date(),
    topic: z.string(),
    format: z.string(),
    angle: z.string().optional(),
    cards: z.array(z.string()).optional(),
    facts: z.array(z.string()).optional(),
    texture: z.string().optional(),
    layout: z.string().optional(),
    reel_style: z.enum(REEL_STYLES).optional(),
  });

  server.registerTool("check_batch_plan", {
    title: "Check a batch plan for repeats",
    description: "Checks planned posts against the history and the rotation rules (angles, featured items, facts, textures, layouts, reel styles). Returns every violation; an empty list means the plan is clear.",
    inputSchema: { posts: z.array(Planned).min(1) },
    annotations: { readOnlyHint: true },
  }, async ({ posts }) => {
    const { entries } = readHistory(cfg.brandKitDir);
    const violations = checkPlan(posts, entries);
    return json({ ok: violations.length === 0, violations });
  });

  server.registerTool("log_post", {
    title: "Log a post",
    description: "Adds a finished post to the brand kit's history.jsonl so later batches don't repeat it.",
    inputSchema: { entry: EntrySchema },
  }, async ({ entry }) => json({ logged: appendHistory(cfg.brandKitDir, entry) }));

  server.registerTool("query_history", {
    title: "Read the post history",
    description: "Returns logged posts, newest first, optionally filtered.",
    inputSchema: {
      days: z.number().int().min(1).optional().describe("Only posts from the last N days"),
      topic: z.string().optional(),
      format: z.string().optional(),
      include_captions: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days, topic, format, include_captions }) => {
    const { entries } = readHistory(cfg.brandKitDir);
    const cut = days ? Date.now() - days * 86_400_000 : -Infinity;
    const out = entries
      .filter((e) => Date.parse(e.date) >= cut && (!topic || e.topic === topic) && (!format || e.format === format))
      .reverse()
      .map((e) => (include_captions ? e : { ...e, caption: undefined }));
    return json({ count: out.length, entries: out });
  });

  // ---------- Penpot ----------

  server.registerTool("penpot_status", {
    title: "Check the Penpot connection",
    description: "Checks the Penpot MCP key, whether Penpot answers, which file the plugin has open, and the keeper's state.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const keeper = keeperStatus(5);
    if (!penpot.configured) return json({ key: "missing", keeper });
    try {
      const file = await penpot.execute("return penpot.currentFile ? penpot.currentFile.name : null;");
      return json({ key: "set", reachable: true, open_file: file, keeper });
    } catch (e) {
      return json({ key: "set", reachable: false, error: (e as Error).message, keeper });
    }
  });

  server.registerTool("penpot_execute", {
    title: "Run code in Penpot",
    description: "Runs JavaScript in the Penpot plugin (objects: penpot, penpotUtils, storage) to build or change a post's board. Keep each call to one step.",
    inputSchema: { code: z.string().min(1) },
  }, async ({ code }) => {
    try {
      return { content: [{ type: "text" as const, text: await penpot.execute(code) }] };
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  server.registerTool("render_post", {
    title: "Export a post image",
    description: "Exports a Penpot board to PNG in the brand kit's output folder and reports its size.",
    inputSchema: {
      shape_id: z.string().min(1).describe("Board id"),
      file_name: z.string().regex(/^[\w.-]+\.png$/).describe("e.g. 01_2026-11-23_pokemon_this-or-that.png"),
      mode: z.enum(["shape", "fill"]).default("shape"),
    },
  }, async ({ shape_id, file_name, mode }) => {
    try {
      return json(await penpot.exportPng(shape_id, path.join(cfg.outputDir, file_name), mode));
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  server.registerTool("keeper_status", {
    title: "Check the Penpot keeper",
    description: "Shows whether the keeper (which keeps Penpot's MCP plugin connected) is running and its last log lines.",
    inputSchema: { lines: z.number().int().min(1).max(100).default(15) },
    annotations: { readOnlyHint: true },
  }, async ({ lines }) => json(keeperStatus(lines)));

  return server;
}

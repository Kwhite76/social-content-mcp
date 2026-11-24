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
import { renderReel, renderStills, DURATION } from "./reel/render.js";
import fs from "node:fs";
import { createRequire } from "node:module";

const VERSION: string = createRequire(import.meta.url)("../package.json").version;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });
const today = () => new Date().toISOString().slice(0, 10);

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "social-content-mcp", version: VERSION });
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
    if (!penpot.configured) return json({ version: VERSION, key: "missing", keeper });
    try {
      const file = await penpot.execute("return penpot.currentFile ? penpot.currentFile.name : null;");
      return json({ version: VERSION, key: "set", reachable: true, open_file: file, keeper });
    } catch (e) {
      return json({ version: VERSION, key: "set", reachable: false, error: (e as Error).message, keeper });
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

  // ---------- reels ----------

  const Beat = z.object({
    text: z.string().min(1).max(120).describe("The on-screen line, 14 words or fewer"),
    focus: z.array(z.number().min(0).max(1)).length(2).optional()
      .describe("Point to zoom on: [x, y] as fractions of the image (default center)"),
    zoom: z.number().min(0.8).max(2.5).optional().describe("1.0 = whole image; 1.3-1.9 for a close-up (default 1.6)"),
    image: z.string().optional().describe("Extra photo to show instead of the post image (path)"),
  });

  server.registerTool("render_reel", {
    title: "Render a reel",
    description: "Animates a finished post image into a 1080x1920 reel in one of 14 motion styles, ending on the brand logo. With 3-7 beats it runs 20-30 s (each beat a close-up with a handwritten note); without beats, 7.5 s. Silent audio track; add a sound in the app. Also writes check frames (3.0 s, first and last beat, end) to look at.",
    inputSchema: {
      post_file: z.string().min(1).describe("Post image: a path, or a file name in the output folder"),
      style: z.enum(REEL_STYLES),
      focus: z.array(z.number().min(0).max(1)).length(2).optional()
        .describe("Where the card sits in the post (pan style): [x, y] as fractions"),
      beats: z.array(Beat).max(7).default([]),
      file_name: z.string().regex(/^[\w.-]+\.mp4$/).describe("e.g. 01_2026-11-23_pokemon_this-or-that_reel.mp4"),
      check_frames: z.boolean().default(true),
    },
  }, async ({ post_file, style, focus, beats, file_name, check_frames }) => {
    const k = loadBrandKit(cfg.brandKitDir);
    if (!k.kit?.logo) return kitProblems(k.problems.length ? k.problems : ["no logo in the brand kit"]);
    const post = path.isAbsolute(post_file) ? post_file : path.join(cfg.outputDir, post_file);
    if (!fs.existsSync(post)) return fail(`post image not found: ${post}`);
    for (const b of beats) if (b.image && !fs.existsSync(b.image)) return fail(`beat image not found: ${b.image}`);
    const opts = {
      post, logo: k.kit.logo, style, focus: focus as [number, number] | undefined,
      beats: beats.map((b) => ({ ...b, focus: b.focus as [number, number] | undefined })),
    };
    try {
      const out = path.join(cfg.outputDir, file_name);
      const r = await renderReel(opts, out);
      let frames: string[] = [];
      if (check_frames) {
        const mids = r.beatMidpoints;
        const times = [3.0, ...(mids.length ? [mids[0], mids[mids.length - 1]] : [DURATION / 2]), r.seconds - 0.2];
        frames = (await renderStills(opts, times, path.join(cfg.outputDir, "checks", file_name.replace(/\.mp4$/, "")))).paths;
      }
      return json({ ...r, check_frames: frames });
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

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrandSchema, FONT_FILE, initBrandKit, loadBrandKit, noteFontFile, PillarsObject, saveBrandKit, type BrandKit } from "./brandkit.js";
import { checkCaption } from "./check.js";
import type { Config } from "./config.js";
import { GUIDES, readGuide, type GuideName } from "./guides.js";
import { appendHistory, EntryObject, readHistory } from "./history.js";
import { cachedInsights, pullInsights, saveInsights } from "./insights.js";
import { keeperStatus } from "./keeper/keeper.js";
import type { KeeperSupervisor } from "./keeper/supervisor.js";
import { PenpotBridge } from "./penpot.js";
import { checkPlan, planBatch } from "./plan.js";
import { DURATION, renderReel, renderStills, type NoteOptions } from "./reel/render.js";
import { REEL_STYLES } from "./reel/styles.js";

const VERSION: string = createRequire(import.meta.url)("../package.json").version;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });
const today = () => new Date().toISOString().slice(0, 10);

const INSTRUCTIONS = `Social Content plans, designs and renders social media posts from the user's own brand kit (a folder with brand.yaml, pillars.yaml, a logo, example posts and voice notes), builds the images in the user's Penpot, renders 20-30 s reels and keeps a log so nothing repeats.
- Start every session with analyze_brand_kit.
- New user, or the kit has problems: follow the setup guide (get_guide name "setup", or the "setup" prompt). It interviews the user and fills the kit in for them.
- To make posts: follow the create_posts guide (get_guide name "create_posts", or the "create_posts" prompt).
- Never invent facts about the brand; everything brand-specific comes from the kit.`;

export function createServer(cfg: Config, deps: { keeper?: KeeperSupervisor } = {}): McpServer {
  const server = new McpServer({ name: "social-content-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const penpot = new PenpotBridge(cfg.penpotUrl, cfg.penpotKey);
  const keeper = deps.keeper;

  const kitProblems = (problems: string[]) => fail(`Brand kit has problems:\n- ${problems.join("\n- ")}\nThe setup guide (get_guide name "setup") walks the user through fixing them.`);
  const withKit = <T>(fn: (kit: BrandKit) => T) => {
    const k = loadBrandKit(cfg.brandKitDir);
    return k.kit ? fn(k.kit) : kitProblems(k.problems);
  };

  /** What the keeper needs from the person, if anything; null when it's fine. */
  const keeperHint = (st: ReturnType<typeof keeperStatus>) =>
    st.state === "needs_sign_in"
      ? "Penpot needs a sign-in: the keeper opened a Penpot window on this computer. Sign in there (and open the design file if asked); it switches back to running hidden on its own."
      : st.state === "paused"
        ? "The keeper is paused (a PAUSE file is in ~/.social-content-mcp/keeper). Delete it to resume."
        : !keeper && !st.running
          ? "The keeper isn't running and the extension isn't set to start it (Auto-start keeper is off, or no Penpot key). Start it with: node dist/cli.js keeper"
          : null;

  /**
   * Runs a Penpot call; if it fails while the plugin isn't connected, gets the keeper going,
   * waits for it to reconnect and tries once more. A failure while connected is the code's own.
   */
  const withPenpot = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (e) {
      const before = keeperStatus(1);
      if (!keeper || before.state === "connected" || before.state === "paused") throw e;
      keeper.start();
      const st = await keeper.waitReady(150_000);
      if (st.state !== "connected") {
        const hint = keeperHint(st) ?? `The keeper couldn't reconnect Penpot yet (state: ${st.state}). Last log: ${st.lastLines.slice(-3).join(" | ")}`;
        throw new Error(`${(e as Error).message}\n${hint}`);
      }
      await new Promise((r) => setTimeout(r, 2000)); // let the plugin settle
      return await call();
    }
  };

  // ---------- guides ----------

  for (const [name, description] of Object.entries(GUIDES) as Array<[GuideName, string]>) {
    server.registerPrompt(name, {
      title: name === "setup" ? "Set up Social Content" : "Make a batch of posts",
      description,
      argsSchema: name === "create_posts"
        ? { start: z.string().optional().describe("First post date, YYYY-MM-DD"), days: z.string().optional().describe("How many days, 1-14") }
        : {},
    }, (args: { start?: string; days?: string }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: readGuide(name) + (args?.start || args?.days ? `\n\nThis run: start=${args.start ?? "default"} days=${args.days ?? "default"}` : ""),
        },
      }],
    }));
  }

  server.registerTool("get_guide", {
    title: "Read a workflow guide",
    description: `Returns a step-by-step guide to follow: ${Object.entries(GUIDES).map(([k, v]) => `"${k}" (${v})`).join("; ")}.`,
    inputSchema: { name: z.enum(Object.keys(GUIDES) as [GuideName, ...GuideName[]]) },
    annotations: { readOnlyHint: true },
  }, async ({ name }) => ({ content: [{ type: "text" as const, text: readGuide(name) }] }));

  // ---------- brand kit ----------

  server.registerTool("init_brand_kit", {
    title: "Create the brand kit folder",
    description: "Creates the brand kit folder layout (logo/, style/, assets/, voice/, fonts/, output/) and example brand.yaml and pillars.yaml. Never overwrites existing files.",
    inputSchema: {},
  }, async () => json({ dir: cfg.brandKitDir, created: initBrandKit(cfg.brandKitDir) }));

  server.registerTool("analyze_brand_kit", {
    title: "Check the brand kit",
    description: "Reads and validates the brand kit: brand, voice, design and reel note settings, topics, formats, backgrounds, layouts, rules, and which reference files exist. Run it first in every session.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const r = loadBrandKit(cfg.brandKitDir);
    return json({ dir: cfg.brandKitDir, ok: r.ok, problems: r.problems, warnings: r.warnings, brand: r.kit?.brand, pillars: r.kit?.pillars, logo: r.kit?.logo, files: r.kit?.files });
  });

  server.registerTool("save_brand_kit", {
    title: "Save the brand settings",
    description: "Validates and writes brand.yaml and/or pillars.yaml, usually at the end of the setup interview. Replacing settings the user already has needs overwrite: true (the old file is kept as .bak).",
    inputSchema: {
      brand: BrandSchema.optional().describe("Who the brand is, how it writes, how posts look, the reel note style"),
      pillars: PillarsObject.optional().describe("Topics, formats with angles, backgrounds, layouts, reel styles, repeat rules"),
      overwrite: z.boolean().default(false),
    },
  }, async ({ brand, pillars, overwrite }) => {
    if (!brand && !pillars) return fail("Give brand, pillars or both.");
    const r = saveBrandKit(cfg.brandKitDir, { brand, pillars, overwrite });
    if (r.problems.length) return fail(r.problems.join("\n"));
    const k = loadBrandKit(cfg.brandKitDir);
    return json({ written: r.written, kit_ok: k.ok, problems: k.problems, warnings: k.warnings });
  });

  const KIND_RULES: Record<string, { dir: string; re: RegExp; what: string }> = {
    logo: { dir: "logo", re: /\.png$/i, what: "a PNG (transparent background works best)" },
    style: { dir: "style", re: /\.(png|jpe?g|webp)$/i, what: "an image" },
    assets: { dir: "assets", re: /\.(png|jpe?g|webp)$/i, what: "an image" },
    voice: { dir: "voice", re: /\.(md|txt)$/i, what: "a .md or .txt file" },
    fonts: { dir: "fonts", re: FONT_FILE, what: "a .ttf, .otf, .woff or .woff2 font" },
  };

  server.registerTool("add_brand_file", {
    title: "Add a file to the brand kit",
    description: "Puts a logo, example post, photo or background, voice note or font into the brand kit: copied from a path on this computer, downloaded from a URL, or (voice notes) written from text.",
    inputSchema: {
      kind: z.enum(["logo", "style", "assets", "voice", "fonts"]),
      source_path: z.string().optional().describe("A file on this computer"),
      url: z.string().url().optional().describe("Download from this URL (only images the brand may use)"),
      text: z.string().optional().describe("For voice notes: the text to save"),
      file_name: z.string().regex(/^[\w .()-]+\.\w+$/).optional().describe("Name in the kit (default: the source's name)"),
    },
  }, async ({ kind, source_path, url, text, file_name }) => {
    const rule = KIND_RULES[kind];
    if ([source_path, url, text].filter((x) => x !== undefined).length !== 1) return fail("Give exactly one of source_path, url or text.");
    if (text !== undefined && kind !== "voice") return fail("text is only for voice notes.");
    let name = file_name ?? (source_path ? path.basename(source_path) : url ? path.basename(new URL(url).pathname) || "download" : "notes.md");
    if (kind === "logo") name = "logo.png";
    if (!rule.re.test(name)) return fail(`${kind} needs ${rule.what}; got ${name}`);
    const dir = path.join(cfg.brandKitDir, rule.dir);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    try {
      let data: Buffer;
      if (source_path) {
        if (!fs.existsSync(source_path)) return fail(`file not found: ${source_path}`);
        data = fs.readFileSync(source_path);
      } else if (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return fail(`download failed: HTTP ${res.status}`);
        data = Buffer.from(await res.arrayBuffer());
      } else {
        data = Buffer.from(text! + (text!.endsWith("\n") ? "" : "\n"), "utf8");
      }
      if (kind === "logo" && (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47)) return fail("The logo must be a PNG file.");
      if (kind === "logo") // keep one logo: set any other aside (not deleted)
        for (const f of fs.readdirSync(dir)) if (/\.png$/i.test(f) && f !== name) fs.renameSync(path.join(dir, f), path.join(dir, f + ".old"));
      if (fs.existsSync(dest)) fs.copyFileSync(dest, dest + ".bak");
      fs.writeFileSync(dest, data);
      return json({ saved: dest, bytes: data.length });
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  // ---------- planning, writing and history ----------

  server.registerTool("plan_batch", {
    title: "Plan a batch",
    description: "Works out each post's topic and format from the rotation, and returns the recent history the batch has to avoid repeating plus the rules check_batch_plan enforces.",
    inputSchema: {
      start: z.iso.date().optional().describe("First post date, YYYY-MM-DD (default today)"),
      days: z.number().int().min(1).max(31).default(7),
    },
    annotations: { readOnlyHint: true },
  }, async ({ start, days }) => withKit((kit) => {
    const first = start ?? today();
    const { entries, badLines } = readHistory(cfg.brandKitDir);
    const rules = kit.pillars.rules;
    const since = (n: number) => entries.filter((e) => Date.parse(first) - Date.parse(e.date) < n * 86_400_000);
    return json({
      slots: planBatch(kit.pillars, first, days),
      rules,
      recent: since(Math.max(rules.angle_cooldown_days, rules.subject_cooldown_days)).map(({ caption, ...rest }) => rest),
      facts_ever_used: [...new Set(entries.flatMap((e) => e.facts))],
      last_reel_style: [...entries].reverse().find((e) => e.reel_style)?.reel_style ?? null,
      formats: kit.pillars.formats,
      reel_styles: kit.pillars.reel_styles,
      backgrounds: kit.pillars.backgrounds,
      layouts: kit.pillars.layouts,
      history_problems: badLines.length ? `unreadable history lines: ${badLines.join(", ")}` : undefined,
    });
  }));

  const Planned = z.object({
    nn: z.number().int(),
    date: z.iso.date(),
    topic: z.string(),
    format: z.string(),
    angle: z.string().optional(),
    subjects: z.array(z.string()).optional().describe("Featured products, people, places or items"),
    facts: z.array(z.string()).optional(),
    background: z.string().optional(),
    layout: z.string().optional(),
    reel_style: z.enum(REEL_STYLES).optional(),
  });

  server.registerTool("check_batch_plan", {
    title: "Check a batch plan for repeats",
    description: "Checks planned posts against the history and the brand's repeat rules (angles, featured subjects, facts, backgrounds, layouts, reel styles). Returns every violation; an empty list means the plan is clear.",
    inputSchema: { posts: z.array(Planned).min(1) },
    annotations: { readOnlyHint: true },
  }, async ({ posts }) => withKit((kit) => {
    const { entries } = readHistory(cfg.brandKitDir);
    const violations = checkPlan(posts, entries, kit.pillars.rules);
    return json({ ok: violations.length === 0, violations });
  }));

  server.registerTool("check_caption", {
    title: "Check a caption against the brand's rules",
    description: "Checks a caption (and optionally its reel beat lines) against the brand kit: length, hashtag count, questions, emoji, dashes, curly quotes and words the brand never mentions.",
    inputSchema: {
      caption: z.string().min(1).describe("The full caption, hashtags included"),
      beats: z.array(z.string()).default([]),
      platform: z.enum(["instagram", "facebook", "tiktok", "threads"]).default("instagram"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ caption, beats, platform }) => withKit((kit) => json(checkCaption(kit.brand, caption, beats, platform))));

  server.registerTool("log_post", {
    title: "Log a post",
    description: "Adds a finished post to the brand kit's history.jsonl so later batches don't repeat it.",
    inputSchema: { entry: EntryObject },
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

  // ---------- Instagram ----------

  server.registerTool("get_insights", {
    title: "Read Instagram Insights",
    description: "Pulls recent posts and their insights (reach, views, likes, comments, saves, shares, watch time) with the user's Instagram token, matches them to logged posts, and groups the results by post type, topic and format. Read-only. Reuses a pull from the last few days unless refresh is set; each pull is saved in the brand kit's insights/ folder.",
    inputSchema: {
      days: z.number().int().min(1).max(365).default(60),
      max_posts: z.number().int().min(1).max(100).default(30),
      max_age_days: z.number().int().min(0).default(3).describe("Reuse a saved pull up to this old"),
      refresh: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days, max_posts, max_age_days, refresh }) => {
    if (!cfg.instagramToken)
      return fail("No Instagram token is set, so Insights are skipped. The setup guide (get_guide name \"setup\", section Connections) explains how to get one; it goes in the extension's settings.");
    if (!refresh) {
      const hit = cachedInsights(cfg.brandKitDir, max_age_days);
      if (hit) return json({ cached: true, ...hit });
    }
    try {
      const r = await pullInsights({ token: cfg.instagramToken, stateDir: cfg.stateDir, apiBase: cfg.instagramApiBase, accountId: cfg.instagramAccountId },
        readHistory(cfg.brandKitDir).entries, days, max_posts);
      const saved = saveInsights(cfg.brandKitDir, r);
      return json({ cached: false, saved, ...r });
    } catch (e) {
      return fail(`Instagram: ${(e as Error).message}`);
    }
  });

  // ---------- Penpot ----------

  server.registerTool("penpot_status", {
    title: "Check the Penpot connection",
    description: "Checks the Penpot MCP key, whether Penpot answers, which file the plugin has open, and the keeper's state.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!penpot.configured) return json({ version: VERSION, key: "missing", keeper: keeperStatus(5) });
    const started = keeper && !keeperStatus(1).running ? keeper.start() : undefined;
    try {
      const file = await withPenpot(() => penpot.execute("return penpot.currentFile ? penpot.currentFile.name : null;"));
      return json({ version: VERSION, key: "set", reachable: true, open_file: file, keeper: { ...keeperStatus(5), started } });
    } catch (e) {
      const st = keeperStatus(5);
      return json({ version: VERSION, key: "set", reachable: false, error: (e as Error).message, keeper: { ...st, started }, action_needed: keeperHint(st) });
    }
  });

  server.registerTool("penpot_execute", {
    title: "Run code in Penpot",
    description: "Runs JavaScript in the Penpot plugin (objects: penpot, penpotUtils, storage) to build or change a post's board. Keep each call to one step.",
    inputSchema: { code: z.string().min(1) },
  }, async ({ code }) => {
    try {
      return { content: [{ type: "text" as const, text: await withPenpot(() => penpot.execute(code)) }] };
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  server.registerTool("penpot_upload_image", {
    title: "Upload a local image to Penpot",
    description: "Uploads an image from this computer (for example a photo in the brand kit's assets/ or style/ folder) into the open Penpot file and keeps the result in the plugin's storage under storage_key, ready to use as a fill: {fillOpacity: 1, fillImage: storage[storage_key]}.",
    inputSchema: {
      file: z.string().min(1).describe("A path, or a path inside the brand kit such as assets/photo.jpg"),
      storage_key: z.string().regex(/^\w+$/).describe("e.g. p03_photo"),
      name: z.string().optional(),
    },
  }, async ({ file, storage_key, name }) => {
    const p = path.isAbsolute(file) ? file : path.join(cfg.brandKitDir, file);
    if (!fs.existsSync(p)) return fail(`file not found: ${p}`);
    const mime = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.jpe?g$/i.test(p) ? "image/jpeg" : null;
    if (!mime) return fail("Use a PNG, JPEG or WebP image.");
    const data = fs.readFileSync(p);
    if (data.length > 8_000_000) return fail("That image is over 8 MB; use a smaller copy.");
    try {
      return { content: [{ type: "text" as const, text: await withPenpot(() => penpot.execute(uploadCode(data, mime, name ?? path.basename(p), storage_key))) }] };
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  server.registerTool("render_post", {
    title: "Export a post image",
    description: "Exports a Penpot board to PNG in the brand kit's output folder and reports its size.",
    inputSchema: {
      shape_id: z.string().min(1).describe("Board id"),
      file_name: z.string().regex(/^[\w.-]+\.png$/).describe("e.g. 01_2026-03-02_coffee_did-you-know.png"),
      mode: z.enum(["shape", "fill"]).default("shape"),
    },
  }, async ({ shape_id, file_name, mode }) => {
    try {
      return json(await withPenpot(() => penpot.exportPng(shape_id, path.join(cfg.outputDir, file_name), mode)));
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
    description: "Animates a finished post image into a 1080x1920 reel in one of 14 motion styles, ending on the brand's logo. With 3-7 beats it runs 20-30 s (each beat a close-up with a note in the brand's note style); without beats, 7.5 s. Silent audio track; add a sound in the app. Also writes check frames (3.0 s, first and last beat, end) to look at.",
    inputSchema: {
      post_file: z.string().min(1).describe("Post image: a path, or a file name in the output folder"),
      style: z.enum(REEL_STYLES),
      focus: z.array(z.number().min(0).max(1)).length(2).optional()
        .describe("Where the subject sits in the post (pan style): [x, y] as fractions"),
      beats: z.array(Beat).max(7).default([]),
      file_name: z.string().regex(/^[\w.-]+\.mp4$/).describe("e.g. 01_2026-03-02_coffee_did-you-know_reel.mp4"),
      check_frames: z.boolean().default(true),
    },
  }, async ({ post_file, style, focus, beats, file_name, check_frames }) => {
    const k = loadBrandKit(cfg.brandKitDir);
    if (!k.kit?.logo) return kitProblems(k.problems.length ? k.problems : ["no logo in the brand kit"]);
    const post = path.isAbsolute(post_file) ? post_file : path.join(cfg.outputDir, post_file);
    if (!fs.existsSync(post)) return fail(`post image not found: ${post}`);
    for (const b of beats) if (b.image && !fs.existsSync(b.image)) return fail(`beat image not found: ${b.image}`);
    const n = k.kit.brand.reel.note;
    const note: NoteOptions = { style: n.style, fontFile: noteFontFile(k.kit), background: n.background, text: n.text, tape: n.tape, tapeColor: n.tape_color };
    const opts = {
      post, logo: k.kit.logo, style, focus: focus as [number, number] | undefined, note,
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

  // ---------- keeper ----------

  server.registerTool("keeper_status", {
    title: "Check the Penpot keeper",
    description: "Shows whether the keeper (which keeps Penpot's MCP plugin connected) is running, who started it, and its last log lines.",
    inputSchema: { lines: z.number().int().min(1).max(100).default(15) },
    annotations: { readOnlyHint: true },
  }, async ({ lines }) => {
    const st = keeperStatus(lines);
    return json({ ...st, auto_start: !!keeper, action_needed: keeperHint(st) });
  });

  server.registerTool("keeper_start", {
    title: "Start the Penpot keeper",
    description: "Starts the keeper if it isn't running (the extension normally starts it on its own) and waits until Penpot's MCP plugin is connected. If Penpot needs a sign-in, says so instead of waiting.",
    inputSchema: { wait_seconds: z.number().int().min(0).max(300).default(120) },
  }, async ({ wait_seconds }) => {
    if (!keeper) return fail(keeperHint(keeperStatus(1)) ?? "The keeper is running outside the extension.");
    const started = keeper.start();
    const st = wait_seconds ? await keeper.waitReady(wait_seconds * 1000) : keeperStatus(8);
    return json({ started, ...st, action_needed: keeperHint(st) });
  });

  return server;
}

/** Plugin code that uploads image bytes to the open Penpot file and keeps the result in storage. */
export function uploadCode(data: Buffer, mime: string, name: string, key: string): string {
  return `const b64 = ${JSON.stringify(data.toString("base64"))};
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
const out = new Uint8Array((b64.length / 4) * 3 - pad);
for (let i = 0, j = 0; i < b64.length; i += 4) {
  const n = (A.indexOf(b64[i]) << 18) | (A.indexOf(b64[i + 1]) << 12) | ((A.indexOf(b64[i + 2]) & 63) << 6) | (A.indexOf(b64[i + 3]) & 63);
  if (j < out.length) out[j++] = (n >> 16) & 255;
  if (j < out.length) out[j++] = (n >> 8) & 255;
  if (j < out.length) out[j++] = n & 255;
}
const img = await penpot.uploadMediaData(${JSON.stringify(name)}, out, ${JSON.stringify(mime)});
storage[${JSON.stringify(key)}] = img;
return { storage_key: ${JSON.stringify(key)}, id: img.id, width: img.width, height: img.height };`;
}

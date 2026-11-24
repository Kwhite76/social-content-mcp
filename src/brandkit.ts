import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { BUNDLED_FONTS, bundledFontPath } from "./reel/fonts.js";
import { REEL_STYLES } from "./reel/styles.js";

/**
 * A brand kit is a folder the user owns:
 *   logo/        transparent PNG logo (shown on the reel's end screen)
 *   style/       posts they love (reference for the look)
 *   assets/      their own photos and backgrounds
 *   voice/       past captions and do/don't notes
 *   fonts/       optional font files (.ttf, .otf, .woff, .woff2) for reel notes
 *   brand.yaml   who they are, how they write, how posts look
 *   pillars.yaml topics, formats and the rotation
 * Everything about a particular brand lives here; the server has no brand of its own.
 */

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a color like #1E1E1E");

const DesignSchema = z.object({
  look: z.string().default("").describe("How posts look, in plain words"),
  colors: z.record(z.string(), Color).default({}),
  fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).prefault({}),
  avoid: z.array(z.string()).default([]),
  penpot_file: z.string().optional().describe("Name of the Penpot file posts are built in"),
});

const WritingSchema = z.object({
  emoji: z.boolean().default(true),
  dashes: z.boolean().default(false).describe("em and en dashes, a common AI tell"),
  max_questions: z.number().int().min(0).default(1),
  rules: z.array(z.string()).default([]).describe("Extra writing rules in plain words"),
});

const NoteSchema = z.object({
  style: z.enum(["card", "paper", "plain"]).default("card"),
  font: z.string().default("Inter").describe(`A bundled font (${Object.keys(BUNDLED_FONTS).join(", ")}) or a file in fonts/`),
  background: Color.default("#FFFFFF"),
  text: Color.default("#1E1E1E"),
  tape: z.boolean().default(false),
  tape_color: Color.optional(),
});

export const BrandSchema = z.object({
  name: z.string().min(1),
  handle: z.string().optional(),
  about: z.string().default("").describe("What the brand does and who follows it"),
  platforms: z.array(z.enum(["instagram", "facebook", "tiktok", "threads"])).min(1),
  voice: z.string().default("friendly and plain, first person"),
  never_mention: z.array(z.string()).default([]),
  hashtags: z.object({ min: z.number().int().min(0), max: z.number().int().max(30) }).default({ min: 2, max: 5 }),
  caption_words: z.object({ min: z.number().int(), max: z.number().int() }).default({ min: 30, max: 220 }),
  ai_score_target: z.number().min(0).max(1).default(0.15),
  writing: WritingSchema.prefault({}),
  design: DesignSchema.prefault({}),
  reel: z.object({ note: NoteSchema.prefault({}) }).prefault({}),
});

const FormatSchema = z.object({
  name: z.string().min(1),
  angles: z.array(z.string()).default([]),
  reel_styles: z.array(z.enum(REEL_STYLES)).optional(), // styles that suit this format
});

const BackgroundSchema = z.object({
  name: z.string().min(1),
  url: z.string().optional(),
  file: z.string().optional().describe("an image in assets/"),
  text_colors: z.record(z.string(), z.string()).default({}),
}).refine((b) => b.url || b.file, "give a url or a file in assets/");

const RulesSchema = z.object({
  angle_cooldown_days: z.number().int().min(0).default(42),
  subject_cooldown_days: z.number().int().min(0).default(30),
  background_max_in_7: z.number().int().min(1).max(7).default(2),
});

export const PillarsObject = z.object({
  anchor_date: z.iso.date().describe("Day 0 of the rotation"),
  topics: z.array(z.string().min(1)).min(1),
  formats: z.array(FormatSchema).min(1),
  backgrounds: z.array(BackgroundSchema).default([]),
  layouts: z.array(z.string()).default([]),
  reel_styles: z.array(z.enum(REEL_STYLES)).default([...REEL_STYLES]),
  rules: RulesSchema.prefault({}),
});

/** PillarsObject, also reading older kits, which called backgrounds "textures" */
export const PillarsSchema = z.preprocess(
  (raw) => (raw && typeof raw === "object" && "textures" in raw && !("backgrounds" in raw)
    ? { ...(raw as object), backgrounds: (raw as { textures: unknown }).textures } : raw),
  PillarsObject,
);

export type Brand = z.infer<typeof BrandSchema>;
export type Pillars = z.infer<typeof PillarsSchema>;
export type Rules = Pillars["rules"];
export type NoteStyle = Brand["reel"]["note"];

export interface BrandKit {
  dir: string;
  brand: Brand;
  pillars: Pillars;
  logo?: string;
  files: Record<"style" | "assets" | "voice" | "fonts", string[]>;
}

export interface KitReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  kit?: BrandKit;
}

const IMG = /\.(png|jpe?g|webp)$/i;
export const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

function list(dir: string, re?: RegExp): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith(".") && (!re || re.test(f))).sort();
  } catch {
    return [];
  }
}

function readYaml(file: string, problems: string[]): unknown {
  try {
    return YAML.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${path.basename(file)}: ${fs.existsSync(file) ? (e as Error).message : "missing"}`);
    return undefined;
  }
}

export function zodProblems(file: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** The font file for reel notes: a file in the kit's fonts/ folder, or a bundled font. */
export function noteFontFile(kit: BrandKit): string {
  const f = kit.brand.reel.note.font;
  return FONT_FILE.test(f) ? path.join(kit.dir, "fonts", path.basename(f)) : bundledFontPath(f);
}

export function loadBrandKit(dir: string): KitReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(dir)) return { ok: false, problems: [`brand kit folder not found: ${dir}`], warnings };

  const brandRaw = readYaml(path.join(dir, "brand.yaml"), problems);
  const pillarsRaw = readYaml(path.join(dir, "pillars.yaml"), problems);
  const brand = brandRaw === undefined ? undefined : BrandSchema.safeParse(brandRaw);
  const pillars = pillarsRaw === undefined ? undefined : PillarsSchema.safeParse(pillarsRaw);
  if (brand && !brand.success) problems.push(...zodProblems("brand.yaml", brand.error));
  if (pillars && !pillars.success) problems.push(...zodProblems("pillars.yaml", pillars.error));

  const logos = list(path.join(dir, "logo"), /\.png$/i);
  if (logos.length === 0) problems.push("logo/: add the logo as a transparent PNG");
  if (logos.length > 1) warnings.push(`logo/: ${logos.length} PNGs found, using ${logos[0]}`);

  const files = {
    style: list(path.join(dir, "style"), IMG),
    assets: list(path.join(dir, "assets"), IMG),
    voice: list(path.join(dir, "voice")),
    fonts: list(path.join(dir, "fonts"), FONT_FILE),
  };
  if (files.style.length === 0) warnings.push("style/: no example posts yet; designs follow brand.yaml's design section only");
  if (files.voice.length === 0) warnings.push("voice/: no past captions yet; the voice will be generic until some are added");

  if (brand?.success) {
    const f = brand.data.reel.note.font;
    if (FONT_FILE.test(f) ? !files.fonts.includes(path.basename(f)) : !BUNDLED_FONTS[f])
      problems.push(`brand.yaml: reel.note.font: "${f}" is neither a bundled font (${Object.keys(BUNDLED_FONTS).join(", ")}) nor a file in fonts/`);
    if (!brand.data.design.look) warnings.push("brand.yaml: design.look is empty; describe how posts should look");
  }

  if (pillars?.success) {
    const p = pillars.data;
    const n = p.formats.length;
    if (p.reel_styles.length < Math.min(n, REEL_STYLES.length))
      warnings.push(`pillars.yaml: ${p.reel_styles.length} reel styles for ${n} formats, so some will repeat within a rotation`);
    if (p.backgrounds.length > 0 && p.backgrounds.length * p.rules.background_max_in_7 < 7)
      warnings.push(`pillars.yaml: ${p.backgrounds.length} backgrounds can't fill 7 posts at ${p.rules.background_max_in_7} uses each`);
    for (const b of p.backgrounds)
      if (b.file && !files.assets.includes(b.file)) problems.push(`pillars.yaml: background "${b.name}": assets/${b.file} not found`);
    if (p.layouts.length === 1) warnings.push("pillars.yaml: only one layout, so layouts will repeat back to back");
  }

  const ok = problems.length === 0 && !!brand?.success && !!pillars?.success;
  return {
    ok,
    problems,
    warnings,
    kit: ok
      ? { dir, brand: brand!.data!, pillars: pillars!.data!, logo: path.join(dir, "logo", logos[0]), files }
      : undefined,
  };
}

const BRAND_TEMPLATE = `# Who the posts are for, how they're written and how they look.
# Easiest: ask Claude to run the "setup" interview, which fills this in for you.
name: Your Brand
handle: yourhandle
about: what you do and who follows you
platforms: [instagram]
voice: friendly and plain, first person
# words that must never appear in a caption
never_mention: []
hashtags: { min: 2, max: 5 }
caption_words: { min: 30, max: 220 }
ai_score_target: 0.15
writing:
  emoji: true
  dashes: false
  max_questions: 1
  rules: []
design:
  look: describe how your posts look, e.g. bright product photos on soft color backgrounds, bold headings
  colors: { primary: "#1E1E1E", accent: "#FF6B35", background: "#F4F1EA" }
  fonts: { heading: Inter, body: Inter }
  avoid: []
reel:
  note: { style: card, font: Inter, background: "#FFFFFF", text: "#1E1E1E", tape: false }
`;

const PILLARS_TEMPLATE = `# The rotation: day N gets topics[N mod topics] and formats[N mod formats], counted from anchor_date
anchor_date: ${new Date().toISOString().slice(0, 10)}
topics: [Topic A, Topic B]
formats:
  - name: This or That
    angles: [two versions of the same thing, old vs new]
  - name: Did You Know
    angles: [a verified fun fact]
  - name: Behind the Scenes
    angles: [how something is made, a day in the work]
  - name: Hot Take
    angles: [a light, debatable opinion]
backgrounds: []
layouts: [subject left with text right, subject right with text left, centered subject with text underneath]
rules: { angle_cooldown_days: 42, subject_cooldown_days: 30, background_max_in_7: 2 }
`;

/** Create the folder layout and example YAML files. Never overwrites existing files. */
export function initBrandKit(dir: string): string[] {
  const created: string[] = [];
  for (const sub of ["logo", "style", "assets", "voice", "fonts", "output"]) {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
      created.push(`${sub}/`);
    }
  }
  for (const [name, body] of [["brand.yaml", BRAND_TEMPLATE], ["pillars.yaml", PILLARS_TEMPLATE]] as const) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, body);
      created.push(name);
    }
  }
  return created;
}

/**
 * Validates and writes brand.yaml and/or pillars.yaml (from the setup interview). Existing files
 * are replaced only with overwrite; the old one is kept as <name>.bak. Returns problems instead
 * of writing anything when either doesn't validate.
 */
export function saveBrandKit(dir: string, input: { brand?: unknown; pillars?: unknown; overwrite?: boolean }):
  { written: string[]; problems: string[] } {
  const problems: string[] = [];
  const out: Array<[string, unknown]> = [];
  if (input.brand !== undefined) {
    const r = BrandSchema.safeParse(input.brand);
    if (r.success) out.push(["brand.yaml", input.brand]); else problems.push(...zodProblems("brand", r.error));
  }
  if (input.pillars !== undefined) {
    const r = PillarsSchema.safeParse(input.pillars);
    if (r.success) out.push(["pillars.yaml", input.pillars]); else problems.push(...zodProblems("pillars", r.error));
  }
  if (problems.length) return { written: [], problems };
  fs.mkdirSync(dir, { recursive: true });
  for (const [name] of out)
    if (fs.existsSync(path.join(dir, name)) && !input.overwrite && !isTemplate(path.join(dir, name)))
      problems.push(`${name} already exists; pass overwrite: true to replace it (the old one is kept as ${name}.bak)`);
  if (problems.length) return { written: [], problems };
  const written: string[] = [];
  for (const [name, data] of out) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 0 }));
    written.push(name);
  }
  initBrandKit(dir); // make sure the folders exist
  return { written, problems };
}

/** True while a YAML file is still init_brand_kit's untouched example. */
function isTemplate(file: string): boolean {
  const body = fs.readFileSync(file, "utf8");
  return body === BRAND_TEMPLATE || body.startsWith("# The rotation: day N gets") && body.includes("topics: [Topic A, Topic B]");
}

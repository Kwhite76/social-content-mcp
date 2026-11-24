import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { REEL_STYLES } from "./reel/styles.js";

/**
 * A brand kit is a folder the user owns:
 *   logo/        transparent PNG logo (shown only on the reel's end screen)
 *   style/       posts they love (reference only)
 *   assets/      their own photos and surface textures
 *   voice/       past captions and do/don't notes
 *   brand.yaml   name, platforms, writing rules
 *   pillars.yaml topics, formats and the rotation
 */

export const BrandSchema = z.object({
  name: z.string().min(1),
  handle: z.string().optional(),
  platforms: z.array(z.enum(["instagram", "facebook", "tiktok", "threads"])).min(1),
  voice: z.string().default("first person, one fan talking to other fans"),
  never_mention: z.array(z.string()).default([]),
  hashtags: z.object({ min: z.number().int().min(0), max: z.number().int().max(30) }).default({ min: 2, max: 4 }),
  caption_words: z.object({ min: z.number().int(), max: z.number().int() }).default({ min: 30, max: 220 }),
  ai_score_target: z.number().min(0).max(1).default(0.15),
});

const FormatSchema = z.object({
  name: z.string().min(1),
  angles: z.array(z.string()).default([]),
  reel_styles: z.array(z.enum(REEL_STYLES)).optional(), // styles that suit this format
});

const TextureSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  text_colors: z.record(z.string(), z.string()).default({}),
});

export const PillarsSchema = z.object({
  anchor_date: z.iso.date(),
  topics: z.array(z.string().min(1)).min(1),
  formats: z.array(FormatSchema).min(1),
  textures: z.array(TextureSchema).default([]),
  layouts: z.array(z.string()).default([]),
  reel_styles: z.array(z.enum(REEL_STYLES)).default([...REEL_STYLES]),
});

export type Brand = z.infer<typeof BrandSchema>;
export type Pillars = z.infer<typeof PillarsSchema>;

export interface BrandKit {
  dir: string;
  brand: Brand;
  pillars: Pillars;
  logo?: string;
  files: Record<"style" | "assets" | "voice", string[]>;
}

export interface KitReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  kit?: BrandKit;
}

const IMG = /\.(png|jpe?g|webp)$/i;

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

function zodProblems(file: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join(".") || "(root)"}: ${i.message}`);
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
  };
  if (files.style.length === 0) warnings.push("style/: no example posts yet; designs will follow the defaults");
  if (files.voice.length === 0) warnings.push("voice/: no past captions yet; the voice will be generic until some are added");

  if (pillars?.success) {
    const p = pillars.data;
    const n = p.formats.length;
    if (p.reel_styles.length < Math.min(n, REEL_STYLES.length))
      warnings.push(`pillars.yaml: ${p.reel_styles.length} reel styles for ${n} formats, so some will repeat within a rotation`);
    if (p.textures.length > 0 && p.textures.length < 3)
      warnings.push("pillars.yaml: fewer than 3 textures makes the 'no texture twice in 7 posts' rule impossible");
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

const BRAND_TEMPLATE = `# Who the posts are for and the rules every post follows
name: Your Brand
handle: yourhandle
platforms: [instagram]
voice: first person, one fan talking to other fans
# words that must never appear in a caption (store names, sales words)
never_mention: [shop, store, price, buy, sale, link, bio]
hashtags: { min: 2, max: 4 }
caption_words: { min: 30, max: 220 }
ai_score_target: 0.15
`;

const PILLARS_TEMPLATE = `# The rotation: day N gets topics[N mod topics] and formats[N mod formats], counted from anchor_date
anchor_date: ${new Date().toISOString().slice(0, 10)}
topics: [Topic A, Topic B]
formats:
  - name: This or That
    angles: [two versions of the same thing, two eras]
  - name: Did You Know
    angles: [a verified fun fact]
  - name: Hot Take
    angles: [a light, debatable opinion]
textures:
  - name: Kraft cardboard
    url: https://www.photos-public-domain.com/wp-content/uploads/2011/01/cardboard-texture.jpg
    text_colors: { main: "#2D251B" }
layouts: [product left with notes right, product right with notes left, centered with notes underneath]
`;

/** Create the folder layout and example YAML files. Never overwrites existing files. */
export function initBrandKit(dir: string): string[] {
  const created: string[] = [];
  for (const sub of ["logo", "style", "assets", "voice", "output"]) {
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

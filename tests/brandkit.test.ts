import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { initBrandKit, loadBrandKit, saveBrandKit } from "../src/brandkit.js";

const KIT = path.join(import.meta.dirname, "fixtures", "kit");
const copyKit = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
  fs.cpSync(KIT, dir, { recursive: true });
  return dir;
};

describe("brand kit", () => {
  it("loads the fixture, with defaults filled in", () => {
    const r = loadBrandKit(KIT);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.kit!.brand.name).toBe("Harbor Coffee");
    expect(r.kit!.brand.reel.note).toMatchObject({ style: "paper", font: "Kalam", tape: true });
    expect(r.kit!.pillars.formats).toHaveLength(14);
    expect(r.kit!.pillars.reel_styles).toHaveLength(14); // default: all styles
    expect(r.kit!.pillars.rules).toEqual({ angle_cooldown_days: 42, subject_cooldown_days: 30, background_max_in_7: 2 });
    expect(r.kit!.logo).toMatch(/logo\.png$/);
  });

  it("reads older kits that called backgrounds textures", () => {
    const dir = copyKit();
    const p = YAML.parse(fs.readFileSync(path.join(dir, "pillars.yaml"), "utf8"));
    p.textures = p.backgrounds; delete p.backgrounds;
    fs.writeFileSync(path.join(dir, "pillars.yaml"), YAML.stringify(p));
    expect(loadBrandKit(dir).kit!.pillars.backgrounds).toHaveLength(4);
  });

  it("reports a missing folder", () => {
    const r = loadBrandKit(path.join(os.tmpdir(), "no-such-kit-" + Date.now()));
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not found/);
  });

  it("init creates a kit that validates once a logo is added, and never overwrites", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    expect(initBrandKit(dir)).toEqual(expect.arrayContaining(["brand.yaml", "pillars.yaml", "logo/", "fonts/"]));
    expect(loadBrandKit(dir).problems).toEqual(["logo/: add the logo as a transparent PNG"]);
    fs.copyFileSync(path.join(KIT, "logo", "logo.png"), path.join(dir, "logo", "logo.png"));
    expect(loadBrandKit(dir).ok).toBe(true);
    fs.writeFileSync(path.join(dir, "brand.yaml"), "name: Mine\nplatforms: [instagram]\n");
    expect(initBrandKit(dir)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "brand.yaml"), "utf8")).toContain("Mine");
  });

  it("explains schema problems with the field path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    initBrandKit(dir);
    fs.writeFileSync(path.join(dir, "pillars.yaml"), "anchor_date: not-a-date\ntopics: []\nformats: []\n");
    const r = loadBrandKit(dir);
    expect(r.problems.some((p) => p.startsWith("pillars.yaml: anchor_date"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("pillars.yaml: topics"))).toBe(true);
  });

  it("flags a note font that isn't bundled or in fonts/, and a missing background file", () => {
    const dir = copyKit();
    const b = YAML.parse(fs.readFileSync(path.join(dir, "brand.yaml"), "utf8"));
    b.reel.note.font = "Comic Sans";
    fs.writeFileSync(path.join(dir, "brand.yaml"), YAML.stringify(b));
    const p = YAML.parse(fs.readFileSync(path.join(dir, "pillars.yaml"), "utf8"));
    p.backgrounds[0] = { name: "Mine", file: "mine.jpg" };
    fs.writeFileSync(path.join(dir, "pillars.yaml"), YAML.stringify(p));
    const r = loadBrandKit(dir);
    expect(r.problems.some((x) => /reel\.note\.font/.test(x))).toBe(true);
    expect(r.problems.some((x) => /assets\/mine\.jpg not found/.test(x))).toBe(true);
  });

  it("save writes valid settings over the example, refuses to overwrite real ones without overwrite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    initBrandKit(dir);
    const brand = YAML.parse(fs.readFileSync(path.join(KIT, "brand.yaml"), "utf8"));
    expect(saveBrandKit(dir, { brand }).written).toEqual(["brand.yaml"]); // the example can be replaced
    expect(saveBrandKit(dir, { brand: { ...brand, name: "Other" } }).problems[0]).toMatch(/already exists/);
    expect(saveBrandKit(dir, { brand: { ...brand, name: "Other" }, overwrite: true }).written).toEqual(["brand.yaml"]);
    expect(fs.existsSync(path.join(dir, "brand.yaml.bak"))).toBe(true);
    expect(saveBrandKit(dir, { brand: { platforms: [] } }).problems.length).toBeGreaterThan(0);
  });
});

import { loadConfig } from "../src/config.js";
describe("settings", () => {
  it("treats an unfilled ${user_config.x} placeholder as blank", () => {
    const c = loadConfig({ SCM_BRAND_KIT_DIR: "/kit", SCM_INSTAGRAM_ACCOUNT_ID: "${user_config.instagram_account_id}",
      SCM_INSTAGRAM_TOKEN: " ${user_config.instagram_token} ", SCM_AUTO_KEEPER: "${user_config.auto_keeper}", SCM_PENPOT_URL: "${user_config.penpot_url}" });
    expect(c.instagramAccountId).toBeUndefined();
    expect(c.instagramToken).toBeUndefined();
    expect(c.autoKeeper).toBe(true);
    expect(c.penpotUrl).toBe("https://design.penpot.app");
    expect(loadConfig({ SCM_INSTAGRAM_ACCOUNT_ID: "1784" }).instagramAccountId).toBe("1784");
  });
});

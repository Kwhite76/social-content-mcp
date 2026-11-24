import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initBrandKit, loadBrandKit } from "../src/brandkit.js";

const KIT = path.join(import.meta.dirname, "fixtures", "kit");

describe("brand kit", () => {
  it("loads the Hatchery fixture", () => {
    const r = loadBrandKit(KIT);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.kit!.brand.name).toBe("The Hatchery");
    expect(r.kit!.pillars.formats).toHaveLength(14);
    expect(r.kit!.pillars.reel_styles).toHaveLength(14); // default: all styles
    expect(r.kit!.logo).toMatch(/logo\.png$/);
  });

  it("reports a missing folder", () => {
    const r = loadBrandKit(path.join(os.tmpdir(), "no-such-kit-" + Date.now()));
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not found/);
  });

  it("init creates a kit that validates once a logo is added, and never overwrites", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    expect(initBrandKit(dir)).toEqual(expect.arrayContaining(["brand.yaml", "pillars.yaml", "logo/"]));
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
});

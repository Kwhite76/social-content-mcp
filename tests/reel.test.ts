import fs from "node:fs";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { bundledFontPath } from "../src/reel/fonts.js";
import { crc32, renderStills } from "../src/reel/render.js";
import { LOGO, makePost } from "./helpers.js";

const beats = [
  { text: "This bag says washed process on the front", focus: [0.3, 0.42] as [number, number], zoom: 1.8 },
  { text: "The cherries were fermented in water for two days", focus: [0.72, 0.5] as [number, number] },
  { text: "That's where the clean taste comes from" },
  { text: "It tastes like black tea with lemon to me", zoom: 1.3 },
  { text: "Brew it a little hotter than you would a natural" },
];

describe("reel renderer", () => {
  const post = makePost();

  it("crc32 matches zlib, so direction matches the Python renderer", () => {
    expect(crc32("02_2026-11-24_brewing_did-you-know.png")).toBe(4172172768);
    expect(crc32("Café.png")).toBe(600728036);
  });

  it("is 7.5 s without beats and lands in 20-30 s with them", async () => {
    const dir = path.dirname(post);
    const none = await renderStills({ post, logo: LOGO, style: "pushin" }, [], path.join(dir, "a"));
    expect(none.seconds).toBe(7.5);
    const five = await renderStills({ post, logo: LOGO, style: "pushin", beats }, [], path.join(dir, "b"));
    expect(five.seconds).toBeGreaterThanOrEqual(20);
    expect(five.seconds).toBeLessThanOrEqual(30);
    expect(five.beatMidpoints).toHaveLength(5);
    const one = await renderStills({ post, logo: LOGO, style: "pushin", beats: beats.slice(0, 1) }, [], path.join(dir, "c"));
    expect(one.seconds).toBeGreaterThan(7.5); // short beat lists stretch toward 20 s within the per-beat cap
  });

  it("draws 1080x1920 frames, and different styles look different", async () => {
    const dir = path.dirname(post);
    const a = await renderStills({ post, logo: LOGO, style: "spin" }, [0.5, 7.4], path.join(dir, "spin"));
    const b = await renderStills({ post, logo: LOGO, style: "drop" }, [0.5], path.join(dir, "drop"));
    const img = await loadImage(fs.readFileSync(a.paths[0]));
    expect([img.width, img.height]).toEqual([1080, 1920]);
    expect(fs.readFileSync(a.paths[0]).equals(fs.readFileSync(b.paths[0]))).toBe(false);
  });

  it("draws beat notes in the brand's note style", async () => {
    const dir = path.dirname(post);
    const at = async (note: Parameters<typeof renderStills>[0]["note"], name: string) => {
      const r = await renderStills({ post, logo: LOGO, style: "pushin", beats: beats.slice(0, 3), note }, [], path.join(dir, name));
      const t = r.beatMidpoints[0];
      return fs.readFileSync((await renderStills({ post, logo: LOGO, style: "pushin", beats: beats.slice(0, 3), note }, [t], path.join(dir, name))).paths[0]);
    };
    const card = await at(undefined, "note_card");
    const paper = await at({ style: "paper", background: "#F3E9D2", text: "#2B2118", tape: true, fontFile: bundledFontPath("Kalam") }, "note_paper");
    const plain = await at({ style: "plain", background: "#000000", text: "#FFFFFF", tape: false }, "note_plain");
    expect(card.equals(paper)).toBe(false);
    expect(card.equals(plain)).toBe(false);
    expect(paper.equals(plain)).toBe(false);
  }, 60_000);

  it("renders every style and every beat transition without throwing", async () => {
    const dir = path.dirname(post);
    for (const style of ["pushin", "slide", "pan", "drop", "shine", "flip", "rise", "spin", "focus", "deal", "wipe", "scan", "flash", "handheld"] as const) {
      const r = await renderStills({ post, logo: LOGO, style, beats: beats.slice(0, 3) }, [1.0, 7.9, 12.0], path.join(dir, `all_${style}`));
      expect(r.paths).toHaveLength(3);
    }
  }, 120_000);
});

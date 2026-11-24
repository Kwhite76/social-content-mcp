import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBrandKit } from "../src/brandkit.js";
import type { Entry } from "../src/history.js";
import { checkPlan, planBatch, type PlannedPost } from "../src/plan.js";

const kit = loadBrandKit(path.join(import.meta.dirname, "fixtures", "kit")).kit!;
const entry = (e: Partial<Entry> & Pick<Entry, "date" | "format">): Entry =>
  ({ topic: "Pokémon", angle: "", cards: [], facts: [], sources: [], ...e }) as Entry;
const rules = (plan: PlannedPost[], history: Entry[] = []) => checkPlan(plan, history).map((v) => `${v.nn}:${v.rule}`);

describe("planBatch", () => {
  it("matches the Hatchery rotation (anchor Mon 2026-11-23)", () => {
    const s = planBatch(kit.pillars, "2026-11-23", 14);
    expect(s[0]).toMatchObject({ nn: 1, weekday: "Mon", topic: "Pokémon", format: "This or That" });
    expect(s[1]).toMatchObject({ topic: "One Piece", format: "Did You Know" });
    expect(s[2]).toMatchObject({ topic: "Riftbound", format: "Deck Challenge" });
    expect(s[13]).toMatchObject({ date: "2026-12-06", topic: "One Piece", format: "Lore Drop" });
  });

  it("works before the anchor date (true modulo)", () => {
    const [s] = planBatch(kit.pillars, "2026-11-22", 1);
    expect(s).toMatchObject({ topic: "Riftbound", format: "Lore Drop" });
  });
});

describe("checkPlan", () => {
  const base = { topic: "Pokémon", format: "Hot Take" };

  it("passes a clean plan", () => {
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, cards: ["Dratini"], texture: "Kraft cardboard", layout: "a", reel_style: "drop" },
      { nn: 2, date: "2026-12-02", ...base, cards: ["Neeko"], texture: "Dark walnut", layout: "b", reel_style: "pan" },
    ])).toEqual([]);
  });

  it("flags a repeated angle within 42 days, but not after", () => {
    const h = [entry({ date: "2026-11-01", format: "Hot Take", angle: "Best alt art" })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, angle: "best  ALT art" }], h)).toEqual(["1:angle-42d"]);
    expect(rules([{ nn: 1, date: "2026-12-20", ...base, angle: "Best alt art" }], h)).toEqual([]);
  });

  it("flags a card within 30 days and any card repeated in the batch", () => {
    const h = [entry({ date: "2026-11-20", format: "Rank It", cards: ["Gol.D.Roger"] })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, cards: ["gol.d.roger"] }], h)).toEqual(["1:card-30d"]);
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, cards: ["Neeko"] },
      { nn: 2, date: "2026-12-29", ...base, cards: ["Neeko"] },
    ])).toEqual(["2:card-in-batch"]);
  });

  it("never allows a fact to be reused", () => {
    const h = [entry({ date: "2024-01-01", format: "Did You Know", facts: ["Roger is -2000 until 10 DON"] })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, facts: ["Roger is -2000 until 10 DON"] }], h)).toEqual(["1:fact-reused"]);
  });

  it("textures: not twice in a row, at most twice in 7", () => {
    const t = (nn: number, texture: string): PlannedPost => ({ nn, date: `2026-12-0${nn}`, ...base, texture });
    expect(rules([t(1, "A"), t(2, "A")])).toEqual(["2:texture-repeat"]);
    expect(rules([t(1, "A"), t(2, "B"), t(3, "A"), t(4, "C"), t(5, "A")])).toEqual(["5:texture-7"]);
  });

  it("layouts: not twice in a row", () => {
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, layout: "card left" },
      { nn: 2, date: "2026-12-02", ...base, layout: "card left" },
    ])).toEqual(["2:layout-repeat"]);
  });

  it("reel styles: unique in the batch, first differs from last logged, format differs from its last", () => {
    const h = [
      entry({ date: "2026-11-20", format: "Hot Take", reel_style: "spin" }),
      entry({ date: "2026-11-22", format: "Rank It", reel_style: "flash" }),
    ];
    expect(rules([
      { nn: 1, date: "2026-12-01", topic: "Pokémon", format: "Guess It", reel_style: "flash" },
      { nn: 2, date: "2026-12-02", ...base, reel_style: "spin" },
      { nn: 3, date: "2026-12-03", topic: "Pokémon", format: "Lore Drop", reel_style: "spin" },
    ], h)).toEqual(["1:style-first", "2:style-format", "3:style-in-batch"]);
  });
});

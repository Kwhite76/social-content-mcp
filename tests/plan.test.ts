import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBrandKit } from "../src/brandkit.js";
import type { Entry } from "../src/history.js";
import { checkPlan, DEFAULT_RULES, planBatch, type PlannedPost } from "../src/plan.js";

const kit = loadBrandKit(path.join(import.meta.dirname, "fixtures", "kit")).kit!;
const entry = (e: Partial<Entry> & Pick<Entry, "date" | "format">): Entry =>
  ({ topic: "Beans", angle: "", subjects: [], facts: [], sources: [], ...e }) as Entry;
const rules = (plan: PlannedPost[], history: Entry[] = [], r = DEFAULT_RULES) => checkPlan(plan, history, r).map((v) => `${v.nn}:${v.rule}`);

describe("planBatch", () => {
  it("rotates topics and formats from the anchor date", () => {
    const s = planBatch(kit.pillars, "2026-11-23", 14);
    expect(s[0]).toMatchObject({ nn: 1, weekday: "Mon", topic: "Beans", format: "This or That" });
    expect(s[1]).toMatchObject({ topic: "Brewing", format: "Did You Know" });
    expect(s[2]).toMatchObject({ topic: "Cafe", format: "How It's Made" });
    expect(s[13]).toMatchObject({ date: "2026-12-06", topic: "Brewing", format: "Tip or How-To" });
  });

  it("works before the anchor date (true modulo)", () => {
    const [s] = planBatch(kit.pillars, "2026-11-22", 1);
    expect(s).toMatchObject({ topic: "Cafe", format: "Tip or How-To" });
  });
});

describe("checkPlan", () => {
  const base = { topic: "Beans", format: "Hot Take" };

  it("passes a clean plan", () => {
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, subjects: ["Ethiopia Guji"], background: "Light oak", layout: "a", reel_style: "drop" },
      { nn: 2, date: "2026-12-02", ...base, subjects: ["Colombia Huila"], background: "Slate", layout: "b", reel_style: "pan" },
    ])).toEqual([]);
  });

  it("flags a repeated angle within the cooldown, but not after", () => {
    const h = [entry({ date: "2026-11-01", format: "Hot Take", angle: "Light roasts are better" })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, angle: "light  ROASTS are better" }], h)).toEqual(["1:angle-cooldown"]);
    expect(rules([{ nn: 1, date: "2026-12-20", ...base, angle: "Light roasts are better" }], h)).toEqual([]);
  });

  it("flags a subject within the cooldown and any subject repeated in the batch", () => {
    const h = [entry({ date: "2026-11-20", format: "Rank It", subjects: ["Kenya AA"] })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, subjects: ["kenya aa"] }], h)).toEqual(["1:subject-cooldown"]);
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, subjects: ["Espresso blend"] },
      { nn: 2, date: "2026-12-29", ...base, subjects: ["Espresso blend"] },
    ])).toEqual(["2:subject-in-batch"]);
  });

  it("never allows a fact to be reused", () => {
    const h = [entry({ date: "2024-01-01", format: "Did You Know", facts: ["coffee cherries are fruit"] })];
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, facts: ["Coffee cherries are fruit"] }], h)).toEqual(["1:fact-reused"]);
  });

  it("backgrounds: not twice in a row, at most twice in 7", () => {
    const t = (nn: number, background: string): PlannedPost => ({ nn, date: `2026-12-0${nn}`, ...base, background });
    expect(rules([t(1, "A"), t(2, "A")])).toEqual(["2:background-repeat"]);
    expect(rules([t(1, "A"), t(2, "B"), t(3, "A"), t(4, "C"), t(5, "A")])).toEqual(["5:background-7"]);
  });

  it("uses the brand's own rules when they differ from the defaults", () => {
    const h = [entry({ date: "2026-11-20", format: "Rank It", subjects: ["Kenya AA"] })];
    const strict = { ...DEFAULT_RULES, subject_cooldown_days: 5, background_max_in_7: 3 };
    expect(rules([{ nn: 1, date: "2026-12-01", ...base, subjects: ["Kenya AA"] }], h, strict)).toEqual([]);
    const t = (nn: number, background: string): PlannedPost => ({ nn, date: `2026-12-0${nn}`, ...base, background });
    expect(rules([t(1, "A"), t(2, "B"), t(3, "A"), t(4, "C"), t(5, "A")], [], strict)).toEqual([]);
  });

  it("layouts: not twice in a row", () => {
    expect(rules([
      { nn: 1, date: "2026-12-01", ...base, layout: "subject left" },
      { nn: 2, date: "2026-12-02", ...base, layout: "subject left" },
    ])).toEqual(["2:layout-repeat"]);
  });

  it("reel styles: unique in the batch, first differs from last logged, format differs from its last", () => {
    const h = [
      entry({ date: "2026-11-20", format: "Hot Take", reel_style: "spin" }),
      entry({ date: "2026-11-22", format: "Rank It", reel_style: "flash" }),
    ];
    expect(rules([
      { nn: 1, date: "2026-12-01", topic: "Beans", format: "Guess It", reel_style: "flash" },
      { nn: 2, date: "2026-12-02", ...base, reel_style: "spin" },
      { nn: 3, date: "2026-12-03", topic: "Beans", format: "Story Time", reel_style: "spin" },
    ], h)).toEqual(["1:style-first", "2:style-format", "3:style-in-batch"]);
  });
});

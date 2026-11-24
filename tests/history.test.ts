import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendHistory, historyFile, readHistory } from "../src/history.js";
import { pngSize } from "../src/penpot.js";

describe("history", () => {
  it("appends, reads back sorted by date, and reports bad lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
    appendHistory(dir, { date: "2026-11-24", topic: "Brewing", format: "Did You Know", angle: "", subjects: ["V60"], facts: [], sources: [] });
    appendHistory(dir, { date: "2026-11-23", topic: "Beans", format: "This or That", angle: "", subjects: ["Kenya AA"], facts: [], sources: [], reel_style: "drop" });
    fs.appendFileSync(historyFile(dir), "{not json\n");
    const { entries, badLines } = readHistory(dir);
    expect(entries.map((e) => e.date)).toEqual(["2026-11-23", "2026-11-24"]);
    expect(entries[0].logged_at).toBeTruthy();
    expect(badLines).toEqual([3]);
  });

  it("reads older logs that said cards and texture", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
    fs.writeFileSync(historyFile(dir), JSON.stringify({ date: "2026-11-23", topic: "Beans", format: "Rank It", cards: ["Kenya AA"], texture: "Slate" }) + "\n");
    const [e] = readHistory(dir).entries;
    expect(e.subjects).toEqual(["Kenya AA"]);
    expect(e.background).toBe("Slate");
  });

  it("rejects an unknown reel style", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
    expect(() => appendHistory(dir, { date: "2026-11-23", topic: "x", format: "y", reel_style: "zoomy" as never, angle: "", subjects: [], facts: [], sources: [] })).toThrow();
  });
});

describe("pngSize", () => {
  it("reads width and height", () => {
    const png = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "kit", "logo", "logo.png"));
    expect(pngSize(png)).toEqual({ width: 8, height: 8 });
    expect(() => pngSize(Buffer.from("nope"))).toThrow();
  });
});

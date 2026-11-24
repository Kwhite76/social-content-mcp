import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendHistory, historyFile, readHistory } from "../src/history.js";
import { pngSize } from "../src/penpot.js";

describe("history", () => {
  it("appends, reads back sorted by date, and reports bad lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
    appendHistory(dir, { date: "2026-11-24", topic: "One Piece", format: "Did You Know", angle: "", cards: ["Roger"], facts: [], sources: [] });
    appendHistory(dir, { date: "2026-11-23", topic: "Pokémon", format: "This or That", angle: "", cards: ["Dratini"], facts: [], sources: [], reel_style: "drop" });
    fs.appendFileSync(historyFile(dir), "{not json\n");
    const { entries, badLines } = readHistory(dir);
    expect(entries.map((e) => e.date)).toEqual(["2026-11-23", "2026-11-24"]);
    expect(entries[0].logged_at).toBeTruthy();
    expect(badLines).toEqual([3]);
  });

  it("rejects an unknown reel style", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
    expect(() => appendHistory(dir, { date: "2026-11-23", topic: "x", format: "y", reel_style: "zoomy" as never, angle: "", cards: [], facts: [], sources: [] })).toThrow();
  });
});

describe("pngSize", () => {
  it("reads width and height", () => {
    const png = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "kit", "logo", "logo.png"));
    expect(pngSize(png)).toEqual({ width: 8, height: 8 });
    expect(() => pngSize(Buffer.from("nope"))).toThrow();
  });
});

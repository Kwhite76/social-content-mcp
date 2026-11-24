import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

/** A synthetic 1080x1350 "post": wood-ish background, a card-shaped block and a heading. */
export function makePost(dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-"))): string {
  const c = createCanvas(1080, 1350), x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, "#5a3520"); g.addColorStop(1, "#2b170c");
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = "#c0392b"; x.fillRect(120, 300, 420, 590);
  x.fillStyle = "#f6eedd"; x.font = "80px sans-serif"; x.fillText("7000 power", 140, 180);
  const file = path.join(dir, "01_2026-11-23_test_post.png");
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

export const LOGO = path.join(import.meta.dirname, "fixtures", "kit", "logo", "logo.png");

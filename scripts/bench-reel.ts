// Times a full ~29 s reel (5 beats) on this machine.  Run: npm run bench:reel
import os from "node:os";
import path from "node:path";
import { renderReel } from "../src/reel/render.js";
import { LOGO, makePost } from "../tests/helpers.js";

const post = makePost();
const beats = [
  { text: "This bag says washed process on the front", focus: [0.3, 0.42] as [number, number], zoom: 1.8 },
  { text: "The cherries were fermented in water for two days", focus: [0.72, 0.5] as [number, number] },
  { text: "That's where the clean taste comes from" },
  { text: "It tastes like black tea with lemon to me", zoom: 1.3 },
  { text: "Brew it a little hotter than you would a natural" },
];
const r = await renderReel({ post, logo: LOGO, style: "flip", beats }, path.join(path.dirname(post), "bench.mp4"));
console.log(`${os.availableParallelism()} cores, ${r.workers} workers: ${r.seconds}s reel (${r.frames} frames) in ${(r.renderMs / 1000).toFixed(1)}s -> ${r.path}`);

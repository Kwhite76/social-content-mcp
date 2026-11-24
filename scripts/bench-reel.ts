// Times a full ~29 s reel (5 beats) on this machine.  Run: npm run bench:reel
import os from "node:os";
import path from "node:path";
import { renderReel } from "../src/reel/render.js";
import { LOGO, makePost } from "../tests/helpers.js";

const post = makePost();
const beats = [
  { text: "Roger's Leader card says 7000 power", focus: [0.3, 0.42] as [number, number], zoom: 1.8 },
  { text: "But he's -2000 until all 10 DON are on the field", focus: [0.72, 0.5] as [number, number] },
  { text: "A DON deck is only 10 cards" },
  { text: "So he sits at 5000 for most of the early game", zoom: 1.3 },
  { text: "His first line gives you a free DON every turn though" },
];
const r = await renderReel({ post, logo: LOGO, style: "flip", beats }, path.join(path.dirname(post), "bench.mp4"));
console.log(`${os.availableParallelism()} cores, ${r.workers} workers: ${r.seconds}s reel (${r.frames} frames) in ${(r.renderMs / 1000).toFixed(1)}s -> ${r.path}`);

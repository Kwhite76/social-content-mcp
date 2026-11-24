// Renders one reel segment in its own process. Input (stdin): {options, start, end, out}.
import { renderSegment, type ReelOptions } from "./render.js";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
const job = JSON.parse(raw) as { options: ReelOptions; start: number; end: number; out: string };
await renderSegment(job.options, job.start, job.end, job.out);

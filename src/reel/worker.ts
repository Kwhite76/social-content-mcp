// Renders one reel segment in its own process. Input (stdin): {options, start, end, out}.
import { renderSegment, type ReelOptions } from "./render.js";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
const job = JSON.parse(raw) as { options: ReelOptions; start: number; end: number; out: string };
// test hook: fail the segment starting at SCM_TEST_FAIL_SEGMENT once (marker file next to the output)
if (process.env.SCM_TEST_FAIL_SEGMENT && Number(process.env.SCM_TEST_FAIL_SEGMENT) === job.start) {
  const fs = await import("node:fs");
  const marker = job.out + ".failed-once";
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, ""); process.stderr.write("simulated crash\n"); process.exit(3); }
}

try {
  await renderSegment(job.options, job.start, job.end, job.out);
} catch (e) {
  process.stderr.write(`${(e as Error).stack ?? e}\n`);
  process.exit(1);
}

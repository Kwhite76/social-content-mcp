// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
// Renders one reel segment in a worker thread (workerData: {options, start, end, out}).
import fs from "node:fs";
import { workerData } from "node:worker_threads";
import { renderSegment, type ReelOptions } from "./render.js";

const job = workerData as { options: ReelOptions; start: number; end: number; out: string };

// test hook: fail the segment starting at SCM_TEST_FAIL_SEGMENT once (marker file next to the output)
if (process.env.SCM_TEST_FAIL_SEGMENT && Number(process.env.SCM_TEST_FAIL_SEGMENT) === job.start) {
  const marker = job.out + ".failed-once";
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, ""); process.stderr.write("simulated crash\n"); process.exit(3); }
}

await renderSegment(job.options, job.start, job.end, job.out);

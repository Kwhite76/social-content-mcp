import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOGO, makePost } from "./helpers.js";

// Full encode through worker processes (needs the built dist/). Enable with REEL_E2E=1 (CI does).
describe.skipIf(!process.env.REEL_E2E)("reel encode (e2e)", () => {
  it("writes an MP4 with exactly the expected frames and a silent audio track", async () => {
    const { renderReel } = await import("../dist/reel/render.js");
    const post = makePost();
    const out = path.join(path.dirname(post), "reel.mp4");
    const r = await renderReel({ post, logo: LOGO, style: "flash", beats: [{ text: "One beat to check the join" }] }, out, { workers: 2 });
    const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
    const probe = spawnSync(ffmpeg, ["-i", out, "-map", "0:v", "-f", "null", "-progress", "pipe:1", "-"], { encoding: "utf8" });
    const frames = Number([...probe.stdout.matchAll(/frame=\s*(\d+)/g)].pop()?.[1]);
    expect(frames).toBe(r.frames);
    expect(probe.stderr).toMatch(/Stream #0:1.*Audio: aac/);
    expect(probe.stderr).toMatch(/1080x1920/);
  }, 180_000);

  it("retries a segment whose worker crashed and still keeps every frame", async () => {
    const { renderReel } = await import("../dist/reel/render.js");
    const post = makePost();
    const out = path.join(path.dirname(post), "retry.mp4");
    process.env.SCM_TEST_FAIL_SEGMENT = "60";
    try {
      const r = await renderReel({ post, logo: LOGO, style: "drop" }, out, { workers: 2 });
      const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
      const probe = spawnSync(ffmpeg, ["-i", out, "-map", "0:v", "-f", "null", "-progress", "pipe:1", "-"], { encoding: "utf8" });
      expect(Number([...probe.stdout.matchAll(/frame=\s*(\d+)/g)].pop()?.[1])).toBe(r.frames);
    } finally {
      delete process.env.SCM_TEST_FAIL_SEGMENT;
    }
  }, 180_000);
});

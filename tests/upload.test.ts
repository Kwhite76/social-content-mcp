import crypto from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { fitImage, uploadSteps } from "../src/server.js";

// Runs the steps the way Penpot's plugin would: each one a separate call sharing `storage`.
async function runInFakePlugin(steps: string[]) {
  const storage: Record<string, unknown> = {};
  let received: { name: string; bytes: Uint8Array; mime: string } | undefined;
  const penpot = { uploadMediaData: async (name: string, bytes: Uint8Array, mime: string) => { received = { name, bytes, mime }; return { id: "img1", width: 10, height: 10 }; } };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  let last: unknown;
  for (const code of steps) last = await new AsyncFunction("penpot", "storage", code)(penpot, storage);
  return { storage, received, last };
}

describe("penpot_upload_image", () => {
  it("sends the image in pieces small enough for Penpot's MCP, and they rebuild exactly", async () => {
    for (const size of [1, 2, 3, 59_999, 45_000 * 3 + 1, 400_000]) {
      const data = crypto.randomBytes(size);
      const steps = uploadSteps(data, "image/png", "test.png", "p01_photo");
      for (const s of steps) expect(Buffer.byteLength(JSON.stringify({ code: s }))).toBeLessThan(90_000);
      const { storage, received, last } = await runInFakePlugin(steps);
      expect(Buffer.from(received!.bytes).equals(data)).toBe(true);
      expect(received!.mime).toBe("image/png");
      expect(storage.p01_photo).toMatchObject({ id: "img1" });
      expect(Object.keys(storage)).toEqual(["p01_photo"]); // the upload buffer is cleaned up
      expect(last).toMatchObject({ storage_key: "p01_photo" });
    }
  });

  it("shrinks big images, keeping PNG for transparency and JPEG otherwise", async () => {
    const c = createCanvas(4000, 2000);
    c.getContext("2d").fillRect(0, 0, 10, 10);
    const png = await fitImage(await c.encode("png"), "image/png");
    expect([png.width, png.height, png.mime]).toEqual([2048, 1024, "image/png"]);
    const jpg = await fitImage(await c.encode("jpeg"), "image/jpeg");
    expect([jpg.width, jpg.mime]).toEqual([2048, "image/jpeg"]);
    const small = await c.encode("png");
    const s = createCanvas(800, 600);
    const kept = await fitImage(await s.encode("png"), "image/png");
    expect(kept.width).toBe(800);
    expect(small.length).toBeGreaterThan(0);
  });
});

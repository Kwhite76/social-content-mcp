// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

describe("license and credit", () => {
  it("ships the unmodified Apache 2.0 text and a NOTICE crediting Kwhite76", () => {
    // md5 of the text published at apache.org/licenses/LICENSE-2.0.txt (git on Windows may check it out with CRLF)
    expect(crypto.createHash("md5").update(read("LICENSE").replace(/\r\n/g, "\n")).digest("hex")).toBe("3b83ef96387f14655fc854ddc3c6bd57");
    expect(read("NOTICE")).toMatch(/Copyright 2026 Kwhite76/);
  });

  it("names the license and author in package.json and manifest.json", () => {
    const pkg = JSON.parse(read("package.json")), man = JSON.parse(read("manifest.json"));
    expect([pkg.license, man.license]).toEqual(["Apache-2.0", "Apache-2.0"]);
    expect([pkg.author, man.author.name]).toEqual(["Kwhite76", "Kwhite76"]);
  });

  it("every source file and script carries the copyright header", () => {
    const files = [...walk("src"), ...walk("scripts")].filter((f) => /\.(ts|mjs|py)$/.test(f));
    const missing = files.filter((f) => !/Copyright 2026 Kwhite76[\s\S]{0,8}SPDX-License-Identifier: Apache-2\.0/.test(read(f).slice(0, 300)));
    expect(missing).toEqual([]);
  });
});

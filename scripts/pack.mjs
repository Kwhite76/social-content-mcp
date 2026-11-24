// Builds social-content-mcp.mcpb for THIS platform (the canvas and ffmpeg binaries are per-OS).
// Run on the machine that will use it:  npm run pack
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, "build", "mcpb");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", shell: true });

run("npm run build");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["manifest.json", "package.json", "package-lock.json", "README.md"]) fs.copyFileSync(path.join(root, f), path.join(stage, f));
fs.cpSync(path.join(root, "dist"), path.join(stage, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") });
run("npm ci --omit=dev --no-audit --no-fund", stage);
const out = path.join(root, "social-content-mcp.mcpb");
run(`npx -y @anthropic-ai/mcpb pack "${stage}" "${out}"`);
console.log(`\nBuilt ${out}\nDouble-click it to install in Claude Desktop.`);

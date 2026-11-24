// Builds the .mcpb extension for one platform (the canvas and ffmpeg binaries are per-OS).
//   npm run pack                          this computer's platform
//   npm run pack -- --target darwin-x64   another platform (packaging only; nothing runs)
// Output: social-content-mcp-<version>-<platform>-<arch>.mcpb
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [platform, arch] = (arg("--target") ?? `${os.platform()}-${os.arch()}`).split("-");
const cross = platform !== os.platform() || arch !== os.arch();
const stage = path.join(root, "build", `mcpb-${platform}-${arch}`);
const run = (cmd, cwd = root, env = {}) => execSync(cmd, { cwd, stdio: "inherit", shell: true, env: { ...process.env, ...env } });

if (!arg("--no-build")) run("npm run build");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["package.json", "package-lock.json", "README.md", "LICENSE"])
  if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
for (const d of ["dist", "guides"]) fs.cpSync(path.join(root, d), path.join(stage, d), { recursive: true, filter: (p) => !p.endsWith(".map") });

// this bundle only runs on its own platform
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.compatibility = { ...manifest.compatibility, platforms: [platform] };
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// npm picks @napi-rs/canvas's binary from --os/--cpu; ffmpeg-static's installer reads npm_config_platform/arch
run(`npm ci --omit=dev --no-audit --no-fund --os=${platform} --cpu=${arch}`, stage,
  cross ? { npm_config_platform: platform, npm_config_arch: arch } : {});

const out = path.join(root, `social-content-mcp-${manifest.version}-${platform}-${arch}.mcpb`);
run(`npx -y @anthropic-ai/mcpb pack "${stage}" "${out}"`);
console.log(`\nBuilt ${out}\nDouble-click it to install in Claude Desktop.`);

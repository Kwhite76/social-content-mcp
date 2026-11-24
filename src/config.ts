import os from "node:os";
import path from "node:path";

/** Settings come from the .mcpb settings screen (passed in as environment variables). */
export interface Config {
  brandKitDir: string;
  outputDir: string;
  penpotUrl: string;
  penpotKey?: string;
  instagramToken?: string;
  /** start the Penpot keeper with the server (default on) */
  autoKeeper: boolean;
}

export const APP_DIR = path.join(os.homedir(), ".social-content-mcp");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const brandKitDir = env.SCM_BRAND_KIT_DIR || path.join(APP_DIR, "brand-kit");
  return {
    brandKitDir,
    outputDir: env.SCM_OUTPUT_DIR || path.join(brandKitDir, "output"),
    penpotUrl: (env.SCM_PENPOT_URL || "https://design.penpot.app").replace(/\/+$/, ""),
    penpotKey: env.SCM_PENPOT_MCP_KEY || undefined,
    instagramToken: env.SCM_INSTAGRAM_TOKEN || undefined,
    autoKeeper: !/^(false|0|no|off)$/i.test(env.SCM_AUTO_KEEPER ?? ""),
  };
}

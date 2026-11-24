import os from "node:os";
import path from "node:path";

/** Settings come from the .mcpb settings screen (passed in as environment variables). */
export interface Config {
  brandKitDir: string;
  outputDir: string;
  penpotUrl: string;
  penpotKey?: string;
  instagramToken?: string;
  /** which Instagram account, when a Facebook Login token sees several (optional) */
  instagramAccountId?: string;
  /** where the server keeps its own state (refreshed tokens) */
  stateDir: string;
  /** where the AI detector's model is downloaded from, and kept (tests point these elsewhere) */
  detectorSource?: string;
  detectorDir?: string;
  /** tests only: a stand-in for the Instagram API */
  instagramApiBase?: string;
  /** start the Penpot keeper with the server (default on) */
  autoKeeper: boolean;
}

/**
 * The extension's own folder (keeper, refreshed tokens, the detector's model). SCM_STATE_DIR moves
 * it; tests use that rather than changing HOME/USERPROFILE, which Chrome on Windows depends on.
 */
export const APP_DIR = (() => {
  const v = process.env.SCM_STATE_DIR?.trim();
  return v && !/^\$\{[^}]*\}$/.test(v) ? v : path.join(os.homedir(), ".social-content-mcp");
})();

/**
 * A setting's value, or undefined when it's blank. Claude Desktop passes an optional setting the
 * user left empty as its literal placeholder ("${user_config.name}"), so that counts as blank too.
 */
const setting = (v: string | undefined) => (!v || /^\$\{[^}]*\}$/.test(v.trim()) ? undefined : v.trim());

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
  const env = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k.startsWith("SCM_") ? setting(v) : v])) as NodeJS.ProcessEnv;
  const brandKitDir = env.SCM_BRAND_KIT_DIR || path.join(APP_DIR, "brand-kit");
  return {
    brandKitDir,
    outputDir: env.SCM_OUTPUT_DIR || path.join(brandKitDir, "output"),
    penpotUrl: (env.SCM_PENPOT_URL || "https://design.penpot.app").replace(/\/+$/, ""),
    penpotKey: env.SCM_PENPOT_MCP_KEY || undefined,
    instagramToken: env.SCM_INSTAGRAM_TOKEN || undefined,
    instagramAccountId: env.SCM_INSTAGRAM_ACCOUNT_ID || undefined,
    instagramApiBase: env.SCM_INSTAGRAM_API_BASE || undefined,
    stateDir: env.SCM_STATE_DIR || APP_DIR,
    detectorSource: env.SCM_DETECTOR_URL || undefined,
    detectorDir: env.SCM_DETECTOR_DIR || undefined,
    autoKeeper: !/^(false|0|no|off)$/i.test(env.SCM_AUTO_KEEPER ?? ""),
  };
}

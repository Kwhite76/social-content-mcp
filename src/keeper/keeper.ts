import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Locator } from "playwright-core";
import { APP_DIR } from "../config.js";

/**
 * Penpot keeper: keeps Penpot's MCP plugin connected so the server can always reach
 * the design file. It runs Penpot in its own browser window (separate profile, never
 * throttled or put to sleep), opens the file, clicks MCP > Connect and checks every
 * 30 seconds; a dropped connection, a hung page or a closed window is recovered.
 *
 * Uses the installed Chrome, or Edge (always present on Windows); nothing to download.
 * Pause: create a file named PAUSE in the keeper folder. Stop: Ctrl+C.
 */

export const KEEPER_DIR = path.join(APP_DIR, "keeper");
const CONFIG = path.join(KEEPER_DIR, "config.json");
const PROFILE = path.join(KEEPER_DIR, "browser-profile");
export const KEEPER_LOG = path.join(KEEPER_DIR, "keeper.log");
const PAUSE = path.join(KEEPER_DIR, "PAUSE");
const STATUS = path.join(KEEPER_DIR, "status.json");

const CHECK_EVERY_MS = Number(process.env.KEEPER_CHECK_MS) || 30_000;
const MAX_CLICK_TRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(msg: string) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.error(line); // stderr: stdout belongs to MCP when embedded
  try {
    fs.mkdirSync(KEEPER_DIR, { recursive: true });
    fs.appendFileSync(KEEPER_LOG, line + "\n");
    if (fs.statSync(KEEPER_LOG).size > 2_000_000)
      fs.writeFileSync(KEEPER_LOG, fs.readFileSync(KEEPER_LOG, "utf8").slice(-500_000));
  } catch {}
}

interface KeeperConfig { fileUrl?: string }
const loadConfig = (): KeeperConfig => {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; }
};
const saveConfig = (c: KeeperConfig) => {
  fs.mkdirSync(KEEPER_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2));
};

const isLogin = (url: string) => /auth-login|auth\/login|screen=auth/.test(url);
const isWorkspace = (url: string) => url.includes("workspace") && url.includes("file-id=");

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: process.env.KEEPER_HEADLESS === "1",
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--start-maximized",
      // never throttle, freeze or discard this window, even when hidden or minimized
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  let last: unknown;
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel }); } catch (e) { last = e; }
  }
  throw new Error(`Couldn't start Chrome or Edge: ${(last as Error)?.message}`);
}

async function waitForLogin(page: Page) {
  if (!isLogin(page.url())) return;
  log("Not signed in. Sign in to Penpot in the keeper window (one time only).");
  while (isLogin(page.url())) await sleep(2000);
  log("Signed in.");
}

async function openFile(page: Page, cfg: KeeperConfig, penpotUrl: string) {
  if (cfg.fileUrl) {
    await page.goto(cfg.fileUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await waitForLogin(page);
    if (!isWorkspace(page.url())) await page.goto(cfg.fileUrl, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(penpotUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await waitForLogin(page);
    log("First run: open your design file in the keeper window. It will be remembered.");
    while (!isWorkspace(page.url())) await sleep(2000);
    cfg.fileUrl = page.url().replace(/&page-id=[^&]*/, "");
    saveConfig(cfg);
    log(`Saved file: ${cfg.fileUrl}`);
  }
  await page.locator('[data-testid="mcp-btn"], button[aria-label="Toggle toolbar"]').first()
    .waitFor({ timeout: 90_000 }).catch(() => {});
}

async function mcpButton(page: Page): Promise<Locator | null> {
  let btn = page.locator('[data-testid="mcp-btn"]').first();
  if (await btn.count()) return btn;
  const toggle = page.locator('button[aria-label="Toggle toolbar"]').first(); // toolbar collapsed
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await sleep(800);
  }
  btn = page.locator('[data-testid="mcp-btn"]').first();
  return (await btn.count()) ? btn : null;
}

/** true connected, false not, null can't tell (no MCP button) */
async function isConnected(page: Page): Promise<boolean | null> {
  const btn = await mcpButton(page);
  if (!btn) return null;
  return (await btn.locator('span[class*="connected"]').count()) > 0;
}

async function clickConnect(page: Page): Promise<boolean> {
  const btn = await mcpButton(page);
  if (!btn) {
    log("MCP button not found in the toolbar. Is MCP Server turned on in Your account > Integrations?");
    return false;
  }
  await btn.click();
  await sleep(600);
  // the open menu says "MCP connected" when it is (backup in case the dot's class changes)
  if (await page.getByText("MCP connected", { exact: true }).count()) {
    await page.keyboard.press("Escape").catch(() => {});
    return true;
  }
  const item = page.getByRole("menuitem", { name: "Connect", exact: true });
  if (await item.count()) {
    await item.first().click();
    log("Clicked MCP > Connect.");
  } else if (await page.getByRole("menuitem", { name: "Disconnect", exact: true }).count()) {
    log("Connection already requested; waiting for Penpot to reconnect.");
    await page.keyboard.press("Escape").catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (await isConnected(page)) return true;
  }
  return false;
}

async function alive(page: Page): Promise<boolean> {
  try {
    await Promise.race([page.evaluate(() => 1), sleep(10_000).then(() => { throw new Error("hung"); })]);
    return true;
  } catch {
    return false;
  }
}

export async function runKeeper(penpotUrl = "https://design.penpot.app/") {
  log("Penpot keeper starting.");
  const cfg = loadConfig();
  if (process.env.KEEPER_FILE_URL) cfg.fileUrl = process.env.KEEPER_FILE_URL; // tests
  let ctx: BrowserContext | null = null;
  let page!: Page;

  const start = async () => {
    if (ctx) await ctx.close().catch(() => {});
    ctx = await launch();
    ctx.on("close", () => { ctx = null; });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await openFile(page, cfg, penpotUrl);
  };

  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const)
    process.on(sig, () => { log("Keeper stopped."); process.exit(0); });

  await start();
  let tries = 0;
  let state: "connected" | "down" | "paused" | null = null;

  for (;;) {
    try {
      if (!ctx || page.isClosed()) {
        log("Keeper window was closed. Reopening it.");
        await start(); tries = 0;
      } else if (!(await alive(page))) {
        log("Page stopped responding. Reloading.");
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await sleep(5000);
      } else if (isLogin(page.url())) {
        await waitForLogin(page);
        await openFile(page, cfg, penpotUrl);
      } else if (!isWorkspace(page.url())) {
        log("The file isn't open. Going back to it.");
        await openFile(page, cfg, penpotUrl);
      } else if (fs.existsSync(PAUSE)) {
        if (state !== "paused") log("Paused (PAUSE file present). Not reconnecting.");
        state = "paused";
      } else if (await isConnected(page)) {
        if (state !== "connected") log("MCP connected.");
        state = "connected"; tries = 0;
      } else {
        if (state === "connected") log("MCP connection dropped.");
        state = "down";
        tries++;
        if (await clickConnect(page)) {
          log("MCP connected."); state = "connected"; tries = 0;
        } else if (tries >= MAX_CLICK_TRIES) {
          log("Couldn't reconnect. Reloading the file.");
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          await sleep(8000); tries = 0;
        }
      }
    } catch (e) {
      log(`Error: ${(e as Error).message.split("\n")[0]}`);
      if (!ctx) { await sleep(5000); continue; }
    }
    try { fs.writeFileSync(STATUS, JSON.stringify({ state, at: new Date().toISOString(), pid: process.pid })); } catch {}
    await sleep(CHECK_EVERY_MS);
  }
}

/** Keeper state (from its heartbeat) and the last log lines, for the keeper_status tool. */
export function keeperStatus(lines = 15): { running: boolean; state: string; lastLines: string[] } {
  let running = false, state = "not running";
  try {
    const st = JSON.parse(fs.readFileSync(STATUS, "utf8")) as { state: string | null; at: string };
    running = Date.now() - Date.parse(st.at) < 3 * CHECK_EVERY_MS + 60_000;
    state = running ? st.state ?? "starting" : "not running";
  } catch {}
  let lastLines: string[];
  try {
    lastLines = fs.readFileSync(KEEPER_LOG, "utf8").trim().split("\n").slice(-lines);
  } catch {
    lastLines = ["The keeper hasn't run on this computer yet."];
  }
  return { running, state, lastLines };
}

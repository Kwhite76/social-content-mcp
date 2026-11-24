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

async function launch(headless: boolean): Promise<BrowserContext> {
  const opts = {
    headless,
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--start-maximized",
      "--window-size=1600,1000",
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

/** Logs what the page shows around the MCP button (and saves debug.png), to fix selectors on real Penpot. */
async function describeMenu(page: Page, btn: Locator) {
  try {
    const info = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="mcp-btn"]') as HTMLElement | null;
      const items = [...document.querySelectorAll('[role="menuitem"], [role="menu"] li, li[class*="dropdown"]')]
        .map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 12);
      const wrap = b?.closest("li")?.outerHTML ?? b?.parentElement?.outerHTML ?? "";
      return {
        viewport: `${innerWidth}x${innerHeight}`,
        expanded: b?.getAttribute("aria-expanded"),
        button: b?.innerText.trim(),
        items,
        near: wrap.replace(/\s+/g, " ").slice(0, 700),
      };
    });
    log(`Debug: ${JSON.stringify(info)}`);
    await page.screenshot({ path: path.join(KEEPER_DIR, "debug.png") }).catch(() => {});
  } catch (e) {
    log(`Debug failed: ${(e as Error).message.split("\n")[0]}`);
  }
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
    log("The MCP menu didn't show Connect or Disconnect.");
    await describeMenu(page, btn);
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

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} timed out`); })]) as Promise<T>;

/**
 * Runs headless once you've signed in and opened your file: a headless browser has no window
 * to minimize or cover, so Chrome never treats the page as a background tab to freeze.
 * The first run (and any time Penpot asks you to sign in again) opens a window instead.
 * KEEPER_HEADED=1 keeps the window; KEEPER_HEADLESS=1 forces headless (tests).
 */
export async function runKeeper(penpotUrl = "https://design.penpot.app/") {
  log("Penpot keeper starting.");
  const cfg = loadConfig();
  if (process.env.KEEPER_FILE_URL) cfg.fileUrl = process.env.KEEPER_FILE_URL; // tests
  let ctx: BrowserContext | null = null;
  let page!: Page;
  let headless = false;

  const wantHeadless = () =>
    process.env.KEEPER_HEADLESS === "1" || (!!cfg.fileUrl && process.env.KEEPER_HEADED !== "1");

  const closeBrowser = async () => {
    const c = ctx;
    ctx = null;
    if (c) await withTimeout(c.close(), 15_000, "closing the browser").catch(() => {});
  };

  const start = async (forceWindow = false) => {
    await closeBrowser();
    headless = !forceWindow && wantHeadless();
    const c = await launch(headless);
    ctx = c;
    c.on("close", () => { if (ctx === c) ctx = null; });
    page = c.pages()[0] ?? (await c.newPage());
    if (headless) {
      await page.goto(cfg.fileUrl!, { waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(3000);
      if (isLogin(page.url())) {
        log("Penpot wants you to sign in again. Opening a window for that.");
        return start(true);
      }
      await page.locator('[data-testid="mcp-btn"], button[aria-label="Toggle toolbar"]').first()
        .waitFor({ timeout: 90_000 }).catch(() => {});
      log("Running headless (no window), so the browser never puts Penpot to sleep.");
    } else {
      await openFile(page, cfg, penpotUrl);
      if (wantHeadless() && !process.env.KEEPER_FILE_URL) {
        log("All set. Switching to headless; you can ignore the window closing.");
        return start();
      }
    }
  };

  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const)
    process.on(sig, () => { log("Keeper stopped."); process.exit(0); });

  await start();
  let tries = 0;
  let state: "connected" | "down" | "paused" | null = null;

  const tick = async () => {
    if (!ctx || page.isClosed()) {
      log("The keeper's browser closed. Reopening it.");
      await start(); tries = 0;
    } else if (!(await alive(page))) {
      log("Page stopped responding. Restarting the browser.");
      await start(); tries = 0;
    } else if (isLogin(page.url())) {
      if (headless) { log("Penpot signed out. Opening a window to sign in."); await start(true); }
      else { await waitForLogin(page); await start(); }
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
        log("Couldn't reconnect. Restarting the browser.");
        await start(); tries = 0;
      }
    }
  };

  for (;;) {
    try {
      // a frozen page can make browser calls hang forever, so every check has a deadline
      await withTimeout(tick(), 60_000, "keeper check");
    } catch (e) {
      log(`Problem: ${(e as Error).message.split("\n")[0]}. Restarting the browser.`);
      await start().catch((err) => log(`Couldn't restart the browser: ${(err as Error).message.split("\n")[0]}`));
      tries = 0;
    }
    try { fs.writeFileSync(STATUS, JSON.stringify({ state, headless, at: new Date().toISOString(), pid: process.pid })); } catch {}
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

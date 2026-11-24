import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Entry } from "./history.js";

/**
 * Instagram Insights through the official API, with the user's own token:
 * - Unified login (what new Meta apps get): a system-user token that never expires, on
 *   graph.facebook.com; the account comes from /me/assigned_instagram_accounts
 * - Instagram Login (older apps; token starts with "IG"): graph.instagram.com, the account is /me
 * - Facebook Login (a user or Page token): graph.facebook.com, the account is the Instagram
 *   business account linked to the user's Page
 * Reads only. Instagram Login tokens last 60 days; they're refreshed here every week, and the
 * fresh one is kept next to the app's other settings, so the user never pastes a new one.
 */

const VERSION = "v25.0";
const DAY = 86_400_000;

// per media type; asking for a metric a type doesn't support fails the whole request
const METRICS: Record<string, string[]> = {
  FEED: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "follows", "profile_visits"],
  REELS: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
};
const CORE = ["reach", "likes", "comments", "saved", "shares"];

export interface InsightsOptions {
  token: string;
  /** where refreshed tokens are kept */
  stateDir: string;
  /** tests: a stand-in for graph.instagram.com / graph.facebook.com */
  apiBase?: string;
  accountId?: string;
  now?: Date;
}

export interface PostInsights {
  id: string;
  date: string;
  type: "reel" | "photo" | "carousel" | "other";
  permalink?: string;
  caption_start: string;
  too_new: boolean;
  metrics: Record<string, number>;
  /** (saves + shares) / reach */
  save_share_rate?: number;
  /** total interactions / reach */
  engagement_rate?: number;
  logged?: { topic: string; format: string; angle: string };
  error?: string;
}

export interface Group { key: string; posts: number; avg_reach: number; avg_save_share_rate: number; avg_comments: number; early_signal: boolean }

export interface InsightsReport {
  account: { id: string; username?: string; followers?: number };
  pulled_at: string;
  days: number;
  posts: PostInsights[];
  /** last 28 days, account level: reach from followers vs non-followers */
  reach_by_follow_type?: { followers: number; non_followers: number; non_follower_share: number };
  groups: { by_type: Group[]; by_topic: Group[]; by_format: Group[] };
  notes: string[];
}

class ApiError extends Error {
  constructor(message: string, public code?: number) { super(message); }
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

interface TokenState { source: string; token: string; refreshed_at: string }

/** The token to use: the newest refreshed copy of the configured one, if there is one. */
function currentToken(o: InsightsOptions): string {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(o.stateDir, "instagram-token.json"), "utf8")) as TokenState;
    if (st.source === hash(o.token)) return st.token;
  } catch {}
  return o.token;
}

async function maybeRefresh(o: InsightsOptions, base: string, token: string, notes: string[]): Promise<string> {
  if (!token.startsWith("IG")) return token; // Facebook Login page tokens don't expire this way
  const file = path.join(o.stateDir, "instagram-token.json");
  let last = 0;
  try {
    const st = JSON.parse(fs.readFileSync(file, "utf8")) as TokenState;
    if (st.source === hash(o.token)) last = Date.parse(st.refreshed_at);
  } catch {}
  const now = (o.now ?? new Date()).getTime();
  if (now - last < 7 * DAY) return token;
  try {
    const r = await get<{ access_token: string }>(base, "/refresh_access_token", { grant_type: "ig_refresh_token" }, token);
    fs.mkdirSync(o.stateDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ source: hash(o.token), token: r.access_token, refreshed_at: new Date(now).toISOString() }));
    return r.access_token;
  } catch (e) {
    // a token under 24 hours old can't be refreshed yet; that's fine
    notes.push(`token not refreshed: ${(e as Error).message}`);
    return token;
  }
}

async function get<T>(base: string, p: string, params: Record<string, string>, token: string): Promise<T> {
  const u = new URL(base.replace(/\/+$/, "") + p);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || body.error) throw new ApiError(body.error?.message ?? `HTTP ${res.status}`, body.error?.code);
  return body;
}

const typeOf = (mediaType?: string, product?: string): PostInsights["type"] =>
  product === "REELS" ? "reel" : mediaType === "CAROUSEL_ALBUM" ? "carousel" : mediaType === "IMAGE" || mediaType === "VIDEO" ? "photo" : "other";

const norm = (s: string) => s.toLowerCase().replace(/#\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Finds the logged post a published one came from: same day (give or take one) and the same opening words. */
export function matchLogged(post: { date: string; caption: string }, history: Entry[]): Entry | undefined {
  const near = history.filter((h) => Math.abs(Date.parse(h.date) - Date.parse(post.date)) <= DAY);
  const start = norm(post.caption).slice(0, 40);
  const byCaption = near.find((h) => h.caption && start && norm(h.caption).startsWith(start.slice(0, 25)));
  if (byCaption) return byCaption;
  const sameDay = history.filter((h) => h.date === post.date);
  return !post.caption && sameDay.length === 1 ? sameDay[0] : undefined;
}

function groups(posts: PostInsights[], key: (p: PostInsights) => string | undefined): Group[] {
  const m = new Map<string, PostInsights[]>();
  for (const p of posts) {
    const k = key(p);
    if (!k || p.too_new || p.metrics.reach === undefined) continue;
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  const avg = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : 0);
  return [...m].map(([k, ps]) => ({
    key: k,
    posts: ps.length,
    avg_reach: Math.round(avg(ps.map((p) => p.metrics.reach ?? 0))),
    avg_save_share_rate: avg(ps.map((p) => p.save_share_rate ?? 0)),
    avg_comments: +avg(ps.map((p) => p.metrics.comments ?? 0)).toFixed(1),
    early_signal: ps.length < 3,
  })).sort((a, b) => b.avg_save_share_rate - a.avg_save_share_rate);
}

/** The Instagram account a graph.facebook.com token can see: Unified login first, then a Facebook Page. */
async function facebookHostAccount(base: string, v: string, token: string): Promise<InsightsReport["account"]> {
  type Acct = { id: string; username?: string; followers_count?: number };
  try {
    const assigned = await get<{ data: Acct[] }>(base, `${v}/me/assigned_instagram_accounts`, { fields: "id,username" }, token);
    const a = assigned.data[0];
    if (a) {
      const more = await get<Acct>(base, `${v}/${a.id}`, { fields: "username,followers_count" }, token).catch(() => ({} as Partial<Acct>));
      return { id: a.id, username: more.username ?? a.username, followers: more.followers_count };
    }
  } catch (e) {
    if ((e as ApiError).code === 190) throw e;
    // not a Unified login token: try a Facebook Page below
  }
  const pages = await get<{ data: Array<{ instagram_business_account?: Acct }> }>(
    base, `${v}/me/accounts`, { fields: "instagram_business_account{id,username,followers_count}", limit: "50" }, token);
  const a = pages.data.map((p) => p.instagram_business_account).find(Boolean);
  if (!a) throw new Error("This token can't see an Instagram account. With Unified login, make sure the configuration shares your Instagram account and includes instagram_manage_insights.");
  return { id: a.id, username: a.username, followers: a.followers_count };
}

/** Pulls the last `days` of posts and their insights. */
export async function pullInsights(o: InsightsOptions, history: Entry[], days = 60, maxPosts = 30): Promise<InsightsReport> {
  const notes: string[] = [];
  const ig = o.token.startsWith("IG");
  const base = o.apiBase ?? (ig ? "https://graph.instagram.com" : "https://graph.facebook.com");
  const v = `/${VERSION}`;
  const now = o.now ?? new Date();
  let token = await maybeRefresh(o, base, currentToken(o), notes);

  // the account
  let account: InsightsReport["account"];
  if (ig && !o.accountId) {
    const me = await get<{ user_id?: string; id: string; username?: string; followers_count?: number }>(
      base, `${v}/me`, { fields: "user_id,username,followers_count" }, token);
    account = { id: me.user_id ?? me.id, username: me.username, followers: me.followers_count };
  } else if (o.accountId) {
    account = { id: o.accountId };
  } else {
    account = await facebookHostAccount(base, v, token);
  }

  // the posts, newest first
  type Media = { id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; timestamp: string };
  const since = now.getTime() - days * DAY;
  const media: Media[] = [];
  let next: string | undefined = `${v}/${account.id}/media`;
  let params: Record<string, string> = { fields: "id,caption,media_type,media_product_type,permalink,timestamp", limit: "50" };
  while (next && media.length < maxPosts) {
    const page: { data: Media[]; paging?: { next?: string; cursors?: { after?: string } } } = await get(base, next, params, token);
    for (const m of page.data) if (Date.parse(m.timestamp) >= since && m.media_product_type !== "STORY") media.push(m);
    const last = page.data[page.data.length - 1];
    const after = page.paging?.cursors?.after;
    next = page.paging?.next && after && last && Date.parse(last.timestamp) >= since ? `${v}/${account.id}/media` : undefined;
    params = { ...params, after: after ?? "" };
  }

  const posts: PostInsights[] = [];
  for (const m of media.slice(0, maxPosts)) {
    const date = m.timestamp.slice(0, 10);
    const p: PostInsights = {
      id: m.id, date, type: typeOf(m.media_type, m.media_product_type), permalink: m.permalink,
      caption_start: (m.caption ?? "").split(/\n/)[0].slice(0, 120),
      too_new: now.getTime() - Date.parse(m.timestamp) < 2 * DAY, metrics: {},
    };
    const wanted = METRICS[m.media_product_type ?? "FEED"] ?? CORE;
    for (const list of [wanted, CORE]) {
      try {
        const r = await get<{ data: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(
          base, `${v}/${m.id}/insights`, { metric: list.join(",") }, token);
        for (const d of r.data) {
          const val = d.values?.[0]?.value ?? d.total_value?.value;
          if (typeof val === "number") p.metrics[d.name] = val;
        }
        delete p.error;
        break;
      } catch (e) {
        if ((e as ApiError).code === 190) throw new Error(`Instagram rejected the token (${(e as Error).message}). Get a new one and paste it in the extension's settings.`);
        if ((e as ApiError).code === 10 || /permission/i.test((e as Error).message))
          throw new Error(`The token isn't allowed to read insights (${(e as Error).message}). Add instagram_manage_insights to the app's login configuration and generate a new token.`);
        p.error = (e as Error).message;
      }
    }
    const reach = p.metrics.reach;
    if (reach) {
      p.save_share_rate = +(((p.metrics.saved ?? 0) + (p.metrics.shares ?? 0)) / reach).toFixed(4);
      if (p.metrics.total_interactions !== undefined) p.engagement_rate = +(p.metrics.total_interactions / reach).toFixed(4);
    }
    const hit = matchLogged({ date, caption: m.caption ?? "" }, history);
    if (hit) p.logged = { topic: hit.topic, format: hit.format, angle: hit.angle };
    posts.push(p);
  }

  // account level: how much reach came from non-followers
  let reach_by_follow_type: InsightsReport["reach_by_follow_type"];
  try {
    const r = await get<{ data: Array<{ total_value?: { breakdowns?: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }> }>(
      base, `${v}/${account.id}/insights`, {
        metric: "reach", period: "day", metric_type: "total_value", breakdown: "follow_type",
        since: String(Math.floor((now.getTime() - 28 * DAY) / 1000)), until: String(Math.floor(now.getTime() / 1000)),
      }, token);
    const results = r.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const val = (k: string) => results.find((x) => x.dimension_values.includes(k))?.value ?? 0;
    const f = val("FOLLOWER"), n = val("NON_FOLLOWER");
    if (f + n > 0) reach_by_follow_type = { followers: f, non_followers: n, non_follower_share: +(n / (f + n)).toFixed(3) };
  } catch (e) {
    notes.push(`follower vs non-follower reach unavailable: ${(e as Error).message}`);
  }

  if (posts.some((p) => p.too_new)) notes.push("posts under 48 hours old are marked too_new and left out of the groups");
  notes.push("small accounts: treat a group with early_signal (fewer than 3 posts) as a hint, not proof");
  return {
    account, pulled_at: now.toISOString(), days, posts, reach_by_follow_type, notes,
    groups: {
      by_type: groups(posts, (p) => p.type),
      by_topic: groups(posts, (p) => p.logged?.topic),
      by_format: groups(posts, (p) => p.logged?.format),
    },
  };
}

/** The newest saved report in <kit>/insights, if it's at most maxAgeDays old. */
export function cachedInsights(kitDir: string, maxAgeDays: number, now = new Date()): InsightsReport | undefined {
  const dir = path.join(kitDir, "insights");
  try {
    const newest = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
    if (!newest) return undefined;
    const r = JSON.parse(fs.readFileSync(path.join(dir, newest), "utf8")) as InsightsReport;
    return now.getTime() - Date.parse(r.pulled_at) <= maxAgeDays * DAY ? r : undefined;
  } catch {
    return undefined;
  }
}

export function saveInsights(kitDir: string, r: InsightsReport): string {
  const dir = path.join(kitDir, "insights");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.pulled_at.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
  return file;
}

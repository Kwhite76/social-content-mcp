/**
 * Reel renderer: animates a finished 1080x1350 post image into a 1080x1920, 30 fps reel
 * (H.264 + silent AAC; the user adds a sound in the app). Port of the Hatchery's Python
 * renderer, drawn with Skia (@napi-rs/canvas) and encoded with a bundled ffmpeg.
 *
 * Timeline: the style's entrance on the whole post (BEAT_AT s), then the beats (close-ups
 * with a taped handwritten note, joined by the style's transition), then the style's
 * ending and the logo. Beats are stretched or squeezed so the reel lands in 20-30 s.
 * With no beats it is the 7.5 s version.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { BEAT_TRANSITION, type ReelStyle } from "./styles.js";

export const W = 1080, H = 1920, FPS = 30, DURATION = 7.5;
const POST_W = 960;          // keeps clear of Instagram's side buttons
const POST_CY = 900;
const END_POST_SCALE = 0.56;
const END_LOGO_W = 560;
const SOLO_LOGO_W = 760;
const END_GAP = 60;
const END_CENTER_Y = 880;    // middle of the area Instagram leaves clear
const SHADOW_PAD = 108;

export const BEAT_AT = 4.3;
const BEAT_TR = 0.4;
const EDGE_TR = 0.45;
export const REEL_MIN = 20, REEL_MAX = 30;
const IMG_CY = 720;
const NOTE_CY = 1300;        // inside Instagram's safe area
const NOTE_W = 820;

const SOLO = new Set<ReelStyle>(["slide", "drop", "shine", "flip", "rise", "spin", "focus", "deal", "wipe", "scan", "flash", "handheld"]);

// ---------- fonts ----------

const require_ = createRequire(import.meta.url);
const ffmpegPath: string | null = require_("ffmpeg-static");

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const req = require_;
  for (const [file, family] of [
    ["@fontsource/kalam/files/kalam-latin-700-normal.woff2", "SCM Note"],
    ["@fontsource/gochi-hand/files/gochi-hand-latin-400-normal.woff2", "SCM Note Alt"],
  ]) {
    try { GlobalFonts.registerFromPath(req.resolve(file), family); } catch {}
  }
  fontsReady = true;
}

// ---------- maths ----------

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3;
const easeIn = (t: number) => clamp(t) ** 3;
const easeInOut = (t: number) => { t = clamp(t); return 3 * t * t - 2 * t * t * t; };
const easeOutBack = (t: number, s = 1.4) => { t = clamp(t) - 1; return 1 + t * t * ((s + 1) * t + s); };
function easeOutBounce(t: number) {
  t = clamp(t);
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
  if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
  t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
}
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** zlib-compatible CRC-32, so direction/phase match the Python renderer for the same file name. */
export function crc32(s: string): number {
  let c, crc = 0xffffffff;
  for (const byte of Buffer.from(s, "utf8")) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- drawing helpers ----------

type Img = Canvas;
const canvas = (w: number, h: number) => createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const ctxOf = (c: Canvas) => c.getContext("2d");

/** Draw img scaled by scale (times sx, sy), rotated by angle degrees (counterclockwise, as in PIL), centred at (cx, cy). */
function place(f: SKRSContext2D, img: Img, scale: number, cx: number, cy: number, alpha = 1, angle = 0, sx = 1, sy = 1, filter = "") {
  if (img.width * scale * sx < 3 || img.height * scale * sy < 3 || alpha <= 0.003) return;
  f.save();
  f.globalAlpha = clamp(alpha);
  if (filter) f.filter = filter;
  f.translate(cx, cy);
  if (Math.abs(angle) > 0.01) f.rotate((-angle * Math.PI) / 180);
  f.scale(scale * sx, scale * sy);
  f.drawImage(img, -img.width / 2, -img.height / 2);
  f.restore();
}

function rounded(src: Img | Awaited<ReturnType<typeof loadImage>>, w: number, h: number, r: number): Img {
  const c = canvas(w, h), x = ctxOf(c);
  x.imageSmoothingQuality = "high";
  x.beginPath(); x.roundRect(0, 0, w, h, r); x.clip();
  x.drawImage(src, 0, 0, w, h);
  return c;
}

function shadowed(img: Img, blur = 36, offset = 22, alpha = 150): Img {
  const pad = blur * 3;
  const c = canvas(img.width + pad * 2, img.height + pad * 2), x = ctxOf(c);
  x.shadowColor = `rgba(0,0,0,${alpha / 255})`;
  x.shadowBlur = blur * 2; // canvas shadowBlur is twice the Gaussian sigma
  x.shadowOffsetY = offset;
  x.drawImage(img, pad, pad);
  return c;
}

const blank = () => canvas(W, H);

/** A full-frame canvas reused across frames (cleared on each use), so frames allocate nothing. */
function scratch(s: { scratch: Map<string, Canvas> }, name: string, w = W, h = H): Canvas {
  let c = s.scratch.get(name);
  if (!c || c.width !== w || c.height !== h) { c = canvas(w, h); s.scratch.set(name, c); }
  else ctxOf(c).clearRect(0, 0, w, h);
  return c;
}

const logoCache = new Map<string, Canvas>();

/** The logo trimmed to its solid pixels (keeps it centred on the wordmark), at most 1400 px wide. */
async function trimmedLogo(file: string): Promise<Canvas> {
  const hit = logoCache.get(file);
  if (hit) return hit;
  const im = await loadImage(fs.readFileSync(file));
  const k = Math.min(1, 1400 / im.width);
  const c = canvas(im.width * k, im.height * k), x = ctxOf(c);
  x.imageSmoothingQuality = "high";
  x.drawImage(im, 0, 0, c.width, c.height);
  const w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data;
  let minA = 255;
  for (let i = 3; i < d.length; i += 4) if (d[i] < minA) minA = d[i];
  const transparent = minA < 250, r0 = d[0], g0 = d[1], b0 = d[2];
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++, i += 4) {
      const solid = transparent ? d[i + 3] > 128
        : Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 72;
      if (solid) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  ctxOf(out).drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  logoCache.set(file, out);
  return out;
}

async function loadLogo(file: string, width: number): Promise<Img> {
  const src = await trimmedLogo(file);
  const out = canvas(width, (width * src.height) / src.width), o = ctxOf(out);
  o.imageSmoothingQuality = "high";
  o.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// ---------- beats ----------

export interface BeatSpec { text: string; focus?: [number, number]; zoom?: number; image?: string }

interface Beat { img: Img; fx: number; fy: number; zoom: number; note: Img | null; tilt: number; dur: number; start: number }

function makeNote(text: string, seed: number): Img {
  registerFonts();
  const m = ctxOf(canvas(1, 1));
  let size = 66, lines: string[] = [];
  for (;;) {
    m.font = `${size}px "SCM Note", "SCM Note Alt", sans-serif`;
    lines = []; let cur = "";
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const trial = (cur + " " + w).trim();
      if (m.measureText(trial).width <= NOTE_W - 110 || !cur) cur = trial;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
    if (lines.length <= 3 || size <= 46) break;
    size -= 4;
  }
  const lh = Math.floor(size * 1.28), nw = NOTE_W, nh = lh * lines.length + 90;
  const paper = canvas(nw, nh), p = ctxOf(paper);
  p.beginPath(); p.roundRect(0, 0, nw, nh, 10); p.fillStyle = "rgb(243,233,210)"; p.fill();
  // faint paper grain
  const rnd = mulberry32(seed), grain = p.createImageData(nw, nh);
  for (let i = 0; i < grain.data.length; i += 4) {
    const g = 128 + ((rnd() + rnd() + rnd() - 1.5) * 18) / 6 * 2;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = g; grain.data[i + 3] = 22;
  }
  const gc = canvas(nw, nh); ctxOf(gc).putImageData(grain, 0, 0);
  p.globalCompositeOperation = "source-atop"; p.drawImage(gc, 0, 0); p.globalCompositeOperation = "source-over";
  p.font = `${size}px "SCM Note", "SCM Note Alt", sans-serif`;
  p.fillStyle = "rgb(43,33,24)"; p.textBaseline = "top"; p.textAlign = "center";
  let y = 45 + Math.floor((lh - size) / 2) - 6;
  for (const ln of lines) { p.fillText(ln, nw / 2, y); y += lh; }
  const card = shadowed(paper, 18, 10, 120), c = ctxOf(card);
  // tape across the top edge
  c.save();
  c.translate(54 + nw / 2, 54 + 4);
  c.rotate((-(-6 + (seed % 5) * 3) * Math.PI) / 180);
  c.fillStyle = "rgba(231,219,186,0.69)";
  c.fillRect(-95, -27, 190, 54);
  c.restore();
  return card;
}

async function loadBeats(specs: BeatSpec[], hero: Img, seed: number): Promise<{ beats: Beat[]; B: number }> {
  const beats: Beat[] = [];
  for (const [k, b] of specs.entries()) {
    const text = (b.text ?? "").split(/\s+/).filter(Boolean).join(" ");
    let img = hero;
    if (b.image) {
      const ex = await loadImage(fs.readFileSync(b.image));
      img = shadowed(rounded(ex, POST_W, (POST_W * ex.height) / ex.width, 22));
    }
    const [fx, fy] = b.focus ?? [0.5, 0.5];
    const words = text ? text.split(" ").length : 0;
    beats.push({ img, fx, fy, zoom: b.zoom ?? 1.6, note: text ? makeNote(text, seed + k) : null,
      tilt: ((Math.floor(seed / 7) + k * 5) % 7 - 3) * 0.8, dur: clamp(1.4 + 0.32 * words, 3.0, 5.5), start: 0 });
  }
  if (beats.length) {
    const sum = beats.reduce((a, b) => a + b.dur, 0);
    const k = (clamp(DURATION + sum, REEL_MIN, REEL_MAX) - DURATION) / sum;
    for (const b of beats) b.dur = clamp(b.dur * k, 2.6, 6.5);
  }
  let start = 0;
  for (const b of beats) { b.start = start; start += b.dur; }
  return { beats, B: start };
}

// ---------- the reel ----------

export interface ReelOptions {
  post: string;
  logo: string;
  style: ReelStyle;
  focus?: [number, number];   // card position in the post (pan)
  beats?: BeatSpec[];
  seed?: number;
}

interface Scene {
  style: ReelStyle; D: number; ph0: number; focus: [number, number];
  bg: Img; hero: Img; face: Img; ph: number; logo: Img; solo?: Img; band?: Img;
  endCy: number; logoY: number; aboveLogoY: number; abovePostCy: number;
  beats: Beat[]; B: number; atBeats?: Img; scratch: Map<string, Canvas>;
}

async function build(o: ReelOptions): Promise<Scene> {
  const post = await loadImage(fs.readFileSync(o.post));
  const ph = Math.floor((POST_W * post.height) / post.width);
  const face = rounded(post, POST_W, ph, 26);
  const hero = shadowed(face);

  // background: the post's own surface texture from its left and right edges, stretched, blurred, darkened
  const pw = post.width, pht = post.height, sw = Math.max(24, Math.floor(pw / 34));
  const tile = canvas(sw * 8, pht), t = ctxOf(tile);
  for (let k = 0; k < 4; k++) {
    const flip = k % 2 === 1;
    const draw = (sx: number, dx: number, mirror: boolean) => {
      t.save();
      if (mirror) { t.translate(dx + sw, 0); t.scale(-1, 1); t.drawImage(post, sx, 0, sw, pht, 0, 0, sw, pht); }
      else t.drawImage(post, sx, 0, sw, pht, dx, 0, sw, pht);
      t.restore();
    };
    const base = k * sw * 2;
    // strips = [left edge][right edge mirrored]; odd tiles are the strips mirrored
    if (!flip) { draw(0, base, false); draw(pw - sw, base + sw, true); }
    else { draw(pw - sw, base, false); draw(0, base + sw, true); }
  }
  const bg = blank(), b = ctxOf(bg);
  b.filter = "blur(28px) brightness(0.6)";
  b.drawImage(tile, -90, -90, W + 180, H + 180);
  b.filter = "none";

  const seed = o.seed ?? crc32(path.basename(o.post));
  const logo = await loadLogo(o.logo, END_LOGO_W);
  const endPostH = ph * END_POST_SCALE;
  const top = END_CENTER_Y - (endPostH + END_GAP + logo.height) / 2;
  const s: Scene = {
    style: o.style, D: seed % 2 === 0 ? 1 : -1, ph0: ((seed % 997) / 997) * 2 * Math.PI, focus: o.focus ?? [0.5, 0.5],
    bg, hero, face, ph, logo, endCy: top + endPostH / 2, logoY: top + endPostH + END_GAP,
    aboveLogoY: top, abovePostCy: top + logo.height + END_GAP + endPostH / 2, beats: [], B: 0,
    scratch: new Map(),
  };
  if (SOLO.has(o.style)) s.solo = await loadLogo(o.logo, SOLO_LOGO_W);
  if (o.style === "shine") {
    const bw = 260, strip = canvas(bw, ph * 2), x = ctxOf(strip);
    for (let i = 0; i < bw; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.sin((Math.PI * i) / (bw - 1)) ** 2})`;
      x.fillRect(i, 0, 1, ph * 2);
    }
    const a = (22 * Math.PI) / 180; // PIL rotate(-22): 22 degrees clockwise, expanded
    const ew = Math.abs(bw * Math.cos(a)) + Math.abs(ph * 2 * Math.sin(a));
    const eh = Math.abs(bw * Math.sin(a)) + Math.abs(ph * 2 * Math.cos(a));
    const band = canvas(ew, eh), y = ctxOf(band);
    y.translate(ew / 2, eh / 2); y.rotate(a); y.drawImage(strip, -bw / 2, -ph);
    s.band = band;
  }
  if (o.beats?.length) Object.assign(s, await loadBeats(o.beats, hero, seed));
  return s;
}

function drawLogoUnder(f: SKRSContext2D, s: Scene, t: number) {
  const a = easeInOut(seg(t, 6.0, 6.5));
  if (a > 0) { f.globalAlpha = a; f.drawImage(s.logo, Math.floor(W / 2 - s.logo.width / 2), Math.floor(s.logoY + (1 - a) * 40)); f.globalAlpha = 1; }
}

function softEdge(x: SKRSContext2D, edge: number, soft: number, horizontal: boolean, mode: "destination-in" | "destination-out", flip = false) {
  // opaque before edge, clear after, soft ramp of width `soft`
  let g;
  if (horizontal) {
    const a = flip ? W - (edge - soft / 2) : edge - soft / 2, b = flip ? W - (edge + soft / 2) : edge + soft / 2;
    g = x.createLinearGradient(a, 0, b, 0);
  } else g = x.createLinearGradient(0, edge - soft / 2, 0, edge + soft / 2);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.save(); x.globalCompositeOperation = mode; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
}

function iris(x: SKRSContext2D, cx: number, cy: number, r: number) {
  x.save(); x.globalCompositeOperation = "destination-in";
  if (r <= 0) { x.fillStyle = "rgba(0,0,0,0)"; x.globalCompositeOperation = "copy"; x.fillRect(0, 0, W, H); }
  else {
    const g = x.createRadialGradient(cx, cy, Math.max(0, r - 14), cx, cy, r + 14);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  x.restore();
}

function styleFrame(s: Scene, t: number, target = "frame"): Img {
  const out = scratch(s, target), f = ctxOf(out);
  f.drawImage(s.bg, 0, 0);
  const { hero, D, ph0 } = s;
  const e = easeInOut(seg(t, 5.5, 6.1)), es = END_POST_SCALE, ecy = s.endCy;

  switch (s.style) {
    case "pushin": {
      const pop = easeOut(seg(t, 0, 0.6)), push = 1 + 0.05 * easeInOut(seg(t, 0.6, 5.5));
      place(f, hero, (0.9 + 0.1 * pop) * push * (1 - e) + es * e, W / 2, (POST_CY + (1 - pop) * 50) * (1 - e) + ecy * e, pop);
      drawLogoUnder(f, s, t);
      break;
    }
    case "slide": {
      const k = easeOutBack(seg(t, 0, 1), 1.1), drift = easeInOut(seg(t, 1, 5.4)), out_ = easeInOut(seg(t, 5.4, 6.1));
      const cx = W / 2 + D * (lerp(-W * 1.1, 0, k) + 22 * drift + out_ * W * 1.1);
      place(f, hero, 1 + 0.03 * drift, cx, POST_CY, 1, D * (lerp(9, -1.5, k) + 2.5 * drift - 8 * out_));
      if (t >= 5.9) place(f, s.solo!, 1, W / 2 + D * lerp(-W, 0, easeOutBack(seg(t, 5.9, 6.7), 1.2)), END_CENTER_Y, seg(t, 5.9, 6.3));
      break;
    }
    case "pan": {
      const [fx, fy] = s.focus, zin = easeInOut(seg(t, 0.3, 4.6)), z = lerp(2, 1, zin);
      const px = lerp(fx, 0.5, zin) * POST_W, py = lerp(fy, 0.5, zin) * s.ph;
      let cx = W / 2 - (px - POST_W / 2) * z, cy = POST_CY - (py - s.ph / 2) * z;
      cx = cx * (1 - e) + (W / 2) * e; cy = cy * (1 - e) + s.abovePostCy * e;
      place(f, hero, z * (1 - e) + es * e, cx, cy, easeOut(seg(t, 0, 0.5)));
      const a = easeInOut(seg(t, 6.0, 6.5));
      if (a > 0) { f.globalAlpha = a; f.drawImage(s.logo, Math.floor(W / 2 - s.logo.width / 2), Math.floor(s.aboveLogoY - (1 - a) * 40)); f.globalAlpha = 1; }
      break;
    }
    case "drop": {
      let cy = lerp(-s.ph * 0.7, POST_CY, easeOutBounce(seg(t, 0, 1)));
      const settle = easeOut(seg(t, 0, 1.3));
      const sway = Math.sin(Math.max(0, t - 1) * 1.6 + ph0 * 0.2) * (1 - easeInOut(seg(t, 4.8, 5.5)));
      const breath = 1 + 0.015 * Math.sin(Math.max(0, t - 1) * 1.2), lift = easeInOut(seg(t, 5.4, 6.0));
      cy = lerp(cy, -s.ph * 0.8, lift);
      place(f, hero, breath, W / 2, cy, 1, D * lerp(7, 0, settle) + sway - 4 * D * lift);
      if (t >= 5.9) place(f, s.solo!, 1, W / 2, lerp(-300, END_CENTER_Y, easeOutBounce(seg(t, 5.9, 6.9))), seg(t, 5.9, 6.1));
      break;
    }
    case "shine": {
      const intro = easeOut(seg(t, 0, 0.7));
      let img = hero;
      for (const [a0, a1] of [[1.2, 2.3], [3.6, 4.6]]) {
        const p = seg(t, a0, a1);
        if (p > 0 && p < 1) {
          const band = s.band!, fw = s.face.width, fh = s.face.height;
          const layer = scratch(s, "shineBand", fw, fh), l = ctxOf(layer);
          let bx = lerp(-band.width, fw, easeInOut(p));
          if (D < 0) { bx = fw - band.width - bx; l.save(); l.translate(bx + band.width, -band.height / 4); l.scale(-1, 1); l.drawImage(band, 0, 0); l.restore(); }
          else l.drawImage(band, bx, -band.height / 4);
          l.globalCompositeOperation = "destination-in"; l.drawImage(s.face, 0, 0);
          img = scratch(s, "shineHero", hero.width, hero.height);
          const h = ctxOf(img); h.drawImage(hero, 0, 0); h.globalAlpha = 0.38; h.drawImage(layer, SHADOW_PAD, SHADOW_PAD);
        }
      }
      const o = easeInOut(seg(t, 5.4, 6.1));
      place(f, img, lerp(1.06, 1, intro) * lerp(1, 0.85, o), W / 2, POST_CY - 60 * o, intro * (1 - o));
      const a = easeInOut(seg(t, 5.9, 6.6));
      if (a > 0) place(f, s.solo!, lerp(0.92, 1, easeOut(seg(t, 5.9, 7.0))), W / 2, END_CENTER_Y, a);
      break;
    }
    case "flip": {
      const fin = easeOutBack(seg(t, 0.15, 0.95), 1.0), fout = easeIn(seg(t, 5.3, 5.8));
      const sx = Math.max(0, fin) * (1 - fout), drift = easeInOut(seg(t, 0.95, 5.3));
      const tilt = D * 1.2 * Math.sin(t * 0.9 + ph0);
      if (sx > 0.01) {
        const k = 1 + 0.03 * drift;
        place(f, hero, 1, W / 2, POST_CY, 1, tilt, sx * k, k * (1 + 0.04 * (1 - sx)), `brightness(${0.55 + 0.45 * sx})`);
      }
      const lin = easeOutBack(seg(t, 5.8, 6.5), 1.0);
      if (t >= 5.8 && lin > 0.01) place(f, s.solo!, 1, W / 2, END_CENTER_Y, 1, 0, lin, 1 + 0.04 * (1 - lin));
      break;
    }
    case "rise": {
      const up = easeOut(seg(t, 0, 1.2)), fl = easeInOut(seg(t, 1.2, 5.4)), sink = easeIn(seg(t, 5.3, 5.9));
      const cy = lerp(H + s.ph * 0.6, POST_CY + 30, up) - 50 * fl + sink * (H + s.ph);
      place(f, hero, lerp(0.94, 1, up) + 0.02 * fl, W / 2, cy, clamp(up * 1.6), D * (lerp(-3, 0, up) + Math.sin(t * 0.8 + ph0) * fl));
      if (t >= 5.8) place(f, s.solo!, 1, W / 2, lerp(H + 200, END_CENTER_Y, easeOut(seg(t, 5.8, 6.8))), seg(t, 5.8, 6.2));
      break;
    }
    case "spin": {
      const k = seg(t, 0, 1.1), o = easeIn(seg(t, 5.3, 5.95));
      const ang = D * lerp(200, 0, easeOut(k)) - D * 1.5 * easeInOut(seg(t, 1.1, 5.3)) - D * 140 * o;
      const sc = (lerp(0.15, 1, easeOutBack(k, 1.0)) + 0.03 * easeInOut(seg(t, 1.1, 5.3))) * (1 - o);
      place(f, hero, sc, W / 2, POST_CY, clamp(k * 3), ang);
      const g = seg(t, 5.85, 6.7);
      if (g > 0) place(f, s.solo!, lerp(0.3, 1, easeOutBack(g, 1.3)), W / 2, END_CENTER_Y, clamp(g * 3), -D * 14 * (1 - easeOut(g)));
      break;
    }
    case "focus": {
      const sharp = easeOut(seg(t, 0, 1.4)), soft = easeInOut(seg(t, 5.3, 6.1));
      const r = 22 * (1 - sharp) + 16 * soft, drift = easeInOut(seg(t, 1.0, 5.3));
      const filt = [r >= 0.4 ? `blur(${r}px)` : "", soft > 0 ? `brightness(${1 - 0.75 * soft})` : ""].join(" ").trim();
      place(f, hero, lerp(1.07, 1, sharp) + 0.035 * drift - 0.05 * soft, W / 2 + D * 14 * (drift - 0.5), POST_CY,
        clamp(sharp * 1.5) * (1 - 0.45 * soft), 0, 1, 1, filt);
      const g = seg(t, 5.7, 6.8);
      if (g > 0) {
        const lr = 14 * (1 - easeOut(g));
        place(f, s.solo!, lerp(1.05, 1, easeOut(g)), W / 2, END_CENTER_Y, clamp(g * 2.2), 0, 1, 1, lr >= 0.4 ? `blur(${lr}px)` : "");
      }
      break;
    }
    case "deal": {
      const k = easeOut(seg(t, 0, 0.75)), thud = 1 + 0.025 * Math.sin(Math.PI * seg(t, 0.7, 1.0));
      const push = easeInOut(seg(t, 5.55, 6.2));
      const cx = lerp(W / 2 + D * W * 0.9, W / 2, k) - D * push * W * 1.05;
      place(f, hero, thud + 0.02 * easeInOut(seg(t, 1, 5.4)), cx, lerp(H * 1.05, POST_CY, k), 1, lerp(-38 * D, 3 * D, k) - D * 10 * push);
      const g = easeOut(seg(t, 5.4, 6.15));
      if (t >= 5.4) place(f, s.solo!, 1, lerp(W / 2 + D * W * 0.9, W / 2, g), lerp(H * 1.05, END_CENTER_Y, g), 1, lerp(-30 * D, 0, g));
      break;
    }
    case "wipe": {
      const layer = scratch(s, "layer"), l = ctxOf(layer);
      place(l, hero, 1 + 0.035 * easeInOut(seg(t, 1, 5.4)), W / 2, POST_CY);
      const reveal = easeInOut(seg(t, 0, 1));
      if (reveal < 1) softEdge(l, lerp(-120, H + 120, reveal), 160, false, "destination-in");
      const sw = easeInOut(seg(t, 5.4, 6.3));
      if (sw > 0) {
        const edge = lerp(-140, W + 140, sw);
        softEdge(l, edge, 180, true, "destination-out", D < 0);
        const lg = scratch(s, "logoLayer"), x = ctxOf(lg);
        place(x, s.solo!, 1, W / 2, END_CENTER_Y);
        softEdge(x, edge, 180, true, "destination-in", D < 0);
        f.drawImage(lg, 0, 0);
      }
      f.drawImage(layer, 0, 0);
      break;
    }
    case "scan": {
      const read = easeInOut(seg(t, 0.4, 4.2)), back = easeInOut(seg(t, 4.2, 5.2));
      const py = lerp(lerp(0.2, 0.8, read), 0.5, back) * s.ph, zz = lerp(1.3, 1, back);
      const layer = scratch(s, "layer"), l = ctxOf(layer);
      place(l, hero, zz, W / 2 + D * 18 * (read - 0.5) * (1 - back), POST_CY - (py - s.ph / 2) * zz, easeOut(seg(t, 0, 0.5)));
      const close = easeIn(seg(t, 5.3, 6.0));
      if (close > 0) iris(l, W / 2, POST_CY, lerp(1150, 0, close));
      f.drawImage(layer, 0, 0);
      const op = easeOut(seg(t, 6.0, 6.8));
      if (op > 0) {
        const lg = scratch(s, "logoLayer"), x = ctxOf(lg);
        place(x, s.solo!, 1, W / 2, END_CENTER_Y);
        iris(x, W / 2, END_CENTER_Y, lerp(0, 700, op));
        f.drawImage(lg, 0, 0);
      }
      break;
    }
    case "flash": {
      const shake = (t0: number) => {
        const p = seg(t, t0, t0 + 0.45), amp = p < 1 ? 16 * (1 - p) ** 2 : 0;
        return [amp * Math.sin(t * 61 + ph0), amp * Math.cos(t * 47 + ph0), amp * 0.12 * Math.sin(t * 53)];
      };
      if (t < 5.5) {
        const [dx, dy, da] = shake(0), over = 1 - easeOut(seg(t, 0, 0.6));
        place(f, hero, 1 + 0.025 * easeInOut(seg(t, 0.4, 5.5)), W / 2 + dx, POST_CY + dy, 1,
          -D * 0.8 * easeInOut(seg(t, 0.4, 5.5)) + da, 1, 1, over > 0.01 ? `brightness(${1 + 0.35 * over})` : "");
      } else {
        const [dx, dy, da] = shake(5.5);
        place(f, s.solo!, 1 + 0.03 * (1 - easeOut(seg(t, 5.5, 6.3))), W / 2 + dx, END_CENTER_Y + dy, 1, da);
      }
      let fl = Math.max(1 - easeOut(seg(t, 0, 0.35)), t >= 5.5 ? 1 - easeOut(seg(t, 5.5, 5.9)) : 0);
      if (t >= 5.38 && t < 5.5) fl = easeIn(seg(t, 5.38, 5.5));
      if (fl > 0.01) { f.fillStyle = `rgba(255,255,255,${(235 * fl) / 255})`; f.fillRect(0, 0, W, H); }
      break;
    }
    case "handheld": {
      const steady = 1 - easeInOut(seg(t, 5.2, 5.5));
      const hx = 12 * Math.sin(t * 1.3 + ph0) + 6 * Math.sin(t * 2.9 + ph0 * 2);
      const hy = 9 * Math.sin(t * 1.7 + ph0 * 1.5) + 5 * Math.sin(t * 3.3);
      const ha = 0.7 * Math.sin(t * 1.1 + ph0) + 0.3 * Math.sin(t * 2.3);
      const find = easeOut(seg(t, 0, 0.7)), whip = easeIn(seg(t, 5.3, 5.85));
      const sc = lerp(1.14, 1.03, find) + 0.01 * Math.sin(t * 0.9) - 0.75 * whip, r = 10 * whip + 6 * (1 - find);
      place(f, hero, Math.max(0.05, sc), W / 2 + hx * steady + D * 500 * whip, POST_CY + hy * steady,
        clamp(find * 2) * (1 - whip), ha * steady + D * 12 * whip, 1, 1, r >= 0.4 ? `blur(${r}px)` : "");
      const g = seg(t, 5.75, 6.55);
      if (g > 0) {
        const settle = 1 - easeOut(seg(t, 5.75, 7.0));
        place(f, s.solo!, lerp(0.55, 1, easeOutBack(g, 1.6)), W / 2 + hx * 0.5 * settle, END_CENTER_Y + hy * 0.5 * settle, clamp(g * 3), ha * settle);
      }
      break;
    }
  }
  return out;
}

/** Beat k at local time u, on a transparent layer, or straight onto the frame (with background) when `onFrame`. */
function beatLayer(s: Scene, k: number, u: number, name: string, onFrame = false): Img {
  const b = s.beats[k], lay = scratch(s, name), l = ctxOf(lay);
  if (onFrame) l.drawImage(s.bg, 0, 0);
  const p = u / b.dur, z = b.zoom * (1 + 0.07 * easeInOut(p));
  const fw = b.img.width - 2 * SHADOW_PAD, fh = b.img.height - 2 * SHADOW_PAD;
  place(l, b.img, z, W / 2 - (b.fx - 0.5) * fw * z + s.D * 26 * (p - 0.5), IMG_CY - (b.fy - 0.5) * fh * z);
  if (b.note) {
    const a = easeOut(seg(u, 0.15, 0.6));
    if (a > 0) place(l, b.note, 1, W / 2, NOTE_CY + 40 * (1 - a), a, b.tilt + s.D * 4 * (1 - a));
  }
  return lay;
}

function transition(s: Scene, kind: (typeof BEAT_TRANSITION)[ReelStyle], A: Img, B: Img, p: number, D: number): Img {
  const e = easeInOut(p), out = scratch(s, "trans"), o = ctxOf(out);
  if (kind === "slide" || kind === "whip") {
    if (kind === "whip") o.filter = `blur(${22 * Math.sin(Math.PI * p)}px)`;
    o.drawImage(A, -D * W * e, 0);
    o.drawImage(B, D * W * (1 - e), 0);
  } else if (kind === "vslide") {
    o.drawImage(A, 0, -H * e);
    o.drawImage(B, 0, H * (1 - e));
  } else if (kind === "flipx") {
    place(o, p < 0.5 ? A : B, 1, W / 2, H / 2, 1, 0, Math.max(0.01, p < 0.5 ? 1 - 2 * p : 2 * p - 1));
  } else if (kind === "flash") {
    o.drawImage(p < 0.5 ? A : B, 0, 0);
    o.fillStyle = `rgba(255,255,255,${(235 * (1 - Math.abs(2 * p - 1))) / 255})`;
    o.fillRect(0, 0, W, H);
  } else {
    o.globalAlpha = 1 - e; o.drawImage(A, 0, 0);
    o.globalAlpha = e; o.drawImage(B, 0, 0);
  }
  return out;
}

function beatsFrame(s: Scene, st: number): Img {
  let k = 0;
  while (k + 1 < s.beats.length && st >= s.beats[k + 1].start) k++;
  const b = s.beats[k], u = st - b.start;
  if (!(k + 1 < s.beats.length && u > b.dur - BEAT_TR)) return beatLayer(s, k, u, "frame", true);
  const lay = transition(s, BEAT_TRANSITION[s.style], beatLayer(s, k, u, "beatA"), beatLayer(s, k + 1, 0, "beatB"),
    (u - (b.dur - BEAT_TR)) / BEAT_TR, s.D);
  const out = scratch(s, "frame"), o = ctxOf(out);
  o.drawImage(s.bg, 0, 0); o.drawImage(lay, 0, 0);
  return out;
}

function frameAt(s: Scene, i: number): Img {
  const t = i / FPS;
  if (s.B <= 0 || t < BEAT_AT) return styleFrame(s, t);
  if (t >= BEAT_AT + s.B) return styleFrame(s, t - s.B);
  const st = t - BEAT_AT;
  const f = beatsFrame(s, st);
  s.atBeats ??= styleFrame(s, BEAT_AT, "atBeats");
  const mix = st < EDGE_TR ? 1 - easeInOut(st / EDGE_TR) : st > s.B - EDGE_TR ? easeInOut((st - (s.B - EDGE_TR)) / EDGE_TR) : 0;
  if (mix > 0) { const x = ctxOf(f); x.globalAlpha = mix; x.drawImage(s.atBeats, 0, 0); x.globalAlpha = 1; }
  return f;
}

export interface ReelResult { path: string; seconds: number; frames: number; beatMidpoints: number[]; renderMs: number; workers: number }

const midpoints = (s: Scene) => s.beats.map((b) => +(BEAT_AT + b.start + b.dur / 2).toFixed(1));

// no B-frames: raw H.264 segments then join with exact frame counts
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-bf", "0", "-pix_fmt", "yuv420p"];

function ffmpeg(args: string[], stdin = false) {
  if (!ffmpegPath) throw new Error("ffmpeg isn't available for this platform");
  const ff = spawn(ffmpegPath, ["-y", "-loglevel", "error", ...args], { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
  let err = "";
  ff.stderr!.on("data", (d) => (err += d));
  const done = new Promise<void>((ok, bad) => ff.on("close", (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg failed: ${err.trim()}`)))));
  return { ff, done };
}

/**
 * Renders frames [start, end) of the reel to a video-only MP4 segment. Runs in its own
 * process (see worker.ts): the canvas binding never returns the memory of pixel reads,
 * so each segment process exits and gives it back.
 */
export async function renderSegment(o: ReelOptions, start: number, end: number, out: string) {
  const s = await build(o);
  const { ff, done } = ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-", ...X264, "-f", "h264", out], true);
  for (let i = start; i < end; i++) {
    if (!ff.stdin!.write(frameAt(s, i).data())) await new Promise((r) => ff.stdin!.once("drain", r));
  }
  ff.stdin!.end();
  await done;
}

const SEGMENT_FRAMES = 60;

/** Renders the reel to an MP4: segments in parallel worker processes, then joined with a silent audio track. */
export async function renderReel(o: ReelOptions, out: string, opts: { workers?: number } = {}): Promise<ReelResult> {
  const t0 = Date.now();
  const s = await build({ ...o });
  const total = DURATION + s.B, n = Math.round(total * FPS);
  const workers = opts.workers ?? Math.max(1, Math.min(4, os.availableParallelism() - 1));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  // built: dist/reel/worker.js; in development (tsx): src/reel/worker.ts
  const here = fileURLToPath(import.meta.url);
  const workerArgs = here.endsWith(".ts")
    ? ["--import", "tsx", path.join(path.dirname(here), "worker.ts")]
    : [path.join(path.dirname(here), "worker.js")];
  const segs: Array<{ start: number; end: number; file: string }> = [];
  for (let a = 0; a < n; a += SEGMENT_FRAMES) segs.push({ start: a, end: Math.min(n, a + SEGMENT_FRAMES), file: path.join(tmpDir, `seg${String(segs.length).padStart(3, "0")}.h264`) });

  try {
    let next = 0;
    const runOne = async (): Promise<void> => {
      while (next < segs.length) {
        const g = segs[next++];
        await new Promise<void>((ok, bad) => {
          const p = spawn(process.execPath, workerArgs, { stdio: ["pipe", "ignore", "pipe"] });
          let err = "";
          p.stderr!.on("data", (d) => (err += d));
          p.on("close", (code) => (code === 0 ? ok() : bad(new Error(`reel segment ${g.start}-${g.end} failed: ${err.trim()}`))));
          p.stdin!.end(JSON.stringify({ options: o, start: g.start, end: g.end, out: g.file }));
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(workers, segs.length) }, runOne));

    // raw H.264 segments each start with a keyframe, so they join byte for byte with exact frame counts
    const joined = path.join(tmpDir, "all.h264");
    fs.writeFileSync(joined, Buffer.concat(segs.map((g) => fs.readFileSync(g.file))));
    const tmp = out + ".part.mp4";
    await ffmpeg(["-framerate", String(FPS), "-i", joined, "-f", "lavfi", "-t", (n / FPS).toFixed(3), "-i", "anullsrc=r=44100:cl=stereo",
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-t", (n / FPS).toFixed(3), "-movflags", "+faststart", tmp]).done;
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { path: out, seconds: +(n / FPS).toFixed(2), frames: n, beatMidpoints: midpoints(s), renderMs: Date.now() - t0, workers };
}

/** Renders single frames (JPEG) at the given times, for checking a reel without encoding it. */
export async function renderStills(o: ReelOptions, times: number[], outPrefix: string): Promise<{ paths: string[]; seconds: number; beatMidpoints: number[] }> {
  const s = await build(o);
  fs.mkdirSync(path.dirname(outPrefix), { recursive: true });
  const paths: string[] = [];
  for (const t of times) {
    const p = `${outPrefix}_${t.toFixed(1)}s.jpg`;
    fs.writeFileSync(p, await frameAt(s, Math.round(t * FPS)).encode("jpeg", 88));
    paths.push(p);
  }
  return { paths, seconds: +(DURATION + s.B).toFixed(2), beatMidpoints: midpoints(s) };
}


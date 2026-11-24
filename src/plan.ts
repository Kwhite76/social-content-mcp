// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import type { Pillars, Rules } from "./brandkit.js";
import type { Entry } from "./history.js";
import type { ReelStyle } from "./reel/styles.js";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export interface Slot {
  nn: number;
  date: string;
  weekday: string;
  topic: string;
  format: string;
}

/** Day d after the anchor gets topics[d mod T] and formats[d mod F]. */
export function planBatch(pillars: Pillars, start: string, days: number): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const date = iso(new Date(toDate(start).getTime() + i * DAY));
    const d = daysBetween(pillars.anchor_date, date);
    slots.push({
      nn: i + 1,
      date,
      weekday: WEEKDAYS[toDate(date).getUTCDay()],
      topic: pillars.topics[mod(d, pillars.topics.length)],
      format: pillars.formats[mod(d, pillars.formats.length)].name,
    });
  }
  return slots;
}

export interface PlannedPost {
  nn: number;
  date: string;
  topic: string;
  format: string;
  angle?: string;
  subjects?: string[];
  facts?: string[];
  background?: string;
  layout?: string;
  reel_style?: ReelStyle;
}

export interface Violation {
  nn: number;
  rule: string;
  message: string;
}

/** Defaults; a brand kit can change them in pillars.yaml's rules section. */
export const DEFAULT_RULES: Rules = {
  angle_cooldown_days: 42,
  subject_cooldown_days: 30,
  background_max_in_7: 2,
};

/**
 * Checks a batch plan against the history and the rotation rules:
 * - same topic + format + angle not within angle_cooldown_days (42)
 * - a featured subject not within subject_cooldown_days (30), and not twice in the batch
 * - a fact or topic never reused, ever
 * - background: never twice in a row, at most background_max_in_7 (2) times in any 7 consecutive posts
 * - layout: never twice in a row
 * - reel style: every post in the batch different; the first post differs from the last
 *   logged post; a format never gets the style it had in its last logged post
 * Earlier posts in the batch count as logged on their dates.
 */
export function checkPlan(plan: PlannedPost[], history: Entry[], rules: Rules = DEFAULT_RULES): Violation[] {
  const v: Violation[] = [];
  const posts = [...plan].sort((a, b) => a.date.localeCompare(b.date));
  const past: Array<Omit<PlannedPost, "nn"> & { nn?: number }> = history.map((h) => ({ ...h }));
  const batchStyles = new Map<string, number>();

  for (const p of posts) {
    const prior = past.filter((h) => h.date < p.date).sort((a, b) => a.date.localeCompare(b.date));
    const prev = prior[prior.length - 1];

    if (p.angle) {
      const hit = prior.find(
        (h) => h.topic === p.topic && h.format === p.format && h.angle && norm(h.angle) === norm(p.angle!) &&
          daysBetween(h.date, p.date) < rules.angle_cooldown_days,
      );
      if (hit) v.push({ nn: p.nn, rule: "angle-cooldown", message: `"${p.angle}" was used for ${p.topic} ${p.format} on ${hit.date}` });
    }

    for (const c of p.subjects ?? []) {
      const hit = prior.find((h) => (h.subjects ?? []).some((x) => norm(x) === norm(c)) &&
        (h.nn !== undefined || daysBetween(h.date, p.date) < rules.subject_cooldown_days));
      if (hit) v.push({ nn: p.nn, rule: hit.nn !== undefined ? "subject-in-batch" : "subject-cooldown", message: `"${c}" was featured on ${hit.date}` });
    }

    for (const f of p.facts ?? []) {
      const hit = prior.find((h) => (h.facts ?? []).some((x) => norm(x) === norm(f)));
      if (hit) v.push({ nn: p.nn, rule: hit.nn !== undefined ? "fact-in-batch" : "fact-reused", message: `"${f}" was already used on ${hit.date}` });
    }

    if (p.background) {
      if (prev?.background === p.background)
        v.push({ nn: p.nn, rule: "background-repeat", message: `same background as the post before (${prev.date})` });
      const window = [...prior.slice(-6), p].filter((h) => h.background === p.background);
      if (window.length > rules.background_max_in_7)
        v.push({ nn: p.nn, rule: "background-7", message: `"${p.background}" used ${window.length} times in 7 consecutive posts` });
    }

    if (p.layout && prev?.layout === p.layout)
      v.push({ nn: p.nn, rule: "layout-repeat", message: `same layout as the post before (${prev.date})` });

    if (p.reel_style) {
      const s = p.reel_style;
      if (batchStyles.has(s))
        v.push({ nn: p.nn, rule: "style-in-batch", message: `reel style "${s}" is already used by post ${batchStyles.get(s)}` });
      batchStyles.set(s, p.nn);
      if (p === posts[0]) {
        const lastLogged = [...history].filter((h) => h.reel_style && h.date < p.date).pop();
        if (lastLogged?.reel_style === s)
          v.push({ nn: p.nn, rule: "style-first", message: `the last logged post (${lastLogged.date}) also used "${s}"` });
      }
      const lastSameFormat = [...history].filter((h) => h.format === p.format && h.reel_style && h.date < p.date).pop();
      if (lastSameFormat?.reel_style === s)
        v.push({ nn: p.nn, rule: "style-format", message: `${p.format} used "${s}" last time (${lastSameFormat.date})` });
    }

    past.push(p);
  }
  return v;
}

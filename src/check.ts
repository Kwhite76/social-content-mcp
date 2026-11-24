// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import type { Brand } from "./brandkit.js";

export interface CaptionCheck { ok: boolean; problems: string[]; words: number; hashtags: number; questions: number; characters: number }

const EMOJI = /\p{Extended_Pictographic}/u;
const DASHES = /[–—]|\s--\s/;
const CURLY = /[‘’“”]/;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** a never_mention entry as a whole word (or phrase), case-insensitive; "$" and other symbols match anywhere */
const banned = (w: string) => (/^[\p{L}\p{N}]/u.test(w) ? new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, "iu") : new RegExp(esc(w), "i"));

/**
 * Checks a caption (and optional reel beat lines) against the brand's own rules:
 * length, hashtags, questions, emoji, dashes, curly quotes and never_mention words.
 */
export function checkCaption(brand: Brand, caption: string, beats: string[] = [], platform = "instagram"): CaptionCheck {
  const problems: string[] = [];
  const tags = caption.match(HASHTAG) ?? [];
  const body = caption.replace(HASHTAG, " ");
  const words = body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const questions = (body.match(/\?/g) ?? []).length;

  if (platform === "instagram" && caption.length > 2200) problems.push(`caption is ${caption.length} characters; Instagram allows 2,200`);
  if (words < brand.caption_words.min || words > brand.caption_words.max)
    problems.push(`caption is ${words} words; the brand wants ${brand.caption_words.min} to ${brand.caption_words.max}`);
  if (tags.length < brand.hashtags.min || tags.length > brand.hashtags.max)
    problems.push(`${tags.length} hashtags; the brand wants ${brand.hashtags.min} to ${brand.hashtags.max}`);
  if (questions > brand.writing.max_questions) problems.push(`${questions} questions; at most ${brand.writing.max_questions}`);

  const textCheck = (label: string, t: string) => {
    if (!brand.writing.emoji && EMOJI.test(t)) problems.push(`${label}: has an emoji`);
    if (!brand.writing.dashes && DASHES.test(t)) problems.push(`${label}: has an em or en dash`);
    if (CURLY.test(t)) problems.push(`${label}: has curly quotes`);
    for (const w of brand.never_mention) if (banned(w).test(t)) problems.push(`${label}: mentions "${w}"`);
  };
  textCheck("caption", caption);

  if (beats.length) {
    if (beats.length < 3 || beats.length > 7) problems.push(`${beats.length} reel beats; use 3 to 7`);
    beats.forEach((b, i) => {
      const n = b.split(/\s+/).filter(Boolean).length;
      if (n > 14) problems.push(`beat ${i + 1}: ${n} words; at most 14`);
      textCheck(`beat ${i + 1}`, b);
    });
    const q = beats.join(" ").match(/\?/g)?.length ?? 0;
    if (q > brand.writing.max_questions) problems.push(`reel beats have ${q} questions; at most ${brand.writing.max_questions}`);
  }
  return { ok: problems.length === 0, problems, words, hashtags: tags.length, questions, characters: caption.length };
}

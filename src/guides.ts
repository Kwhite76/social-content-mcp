// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";

/**
 * The guides that ship with the server (guides/ at the package root, next to dist/ and src/).
 * getting-started.md is the one guide for users; the setup and connect_instagram prompts hand it
 * to Claude with a note on how to walk the user through it. create-posts.md is Claude's own
 * procedure for running a batch.
 */
export const GUIDES = {
  setup: "First-time setup: install, Penpot, the brand kit interview, Instagram and a first post, with what each piece does",
  create_posts: "Make a batch of posts: plan, research, write, design in Penpot, render reels, log, deliver",
  connect_instagram: "Connect Instagram Insights: set up a Meta app, generate an access token and add it to the extension",
} as const;
export type GuideName = keyof typeof GUIDES;

const INTERVIEW = `# How to use this guide (for Claude)

Walk the user through the first-time setup below as a conversation. Talk like a helpful person, not a form, and keep jargon ("YAML", "schema", "pillars") out of it.
- Start by calling analyze_brand_kit, penpot_status and keeper_status. If the kit folder is missing or empty, call init_brand_kit. If the kit already validates and they didn't ask to start over, say what's set up and ask what to change instead of running the whole interview.
- Sections 3 to 5: check what's already done (the extension is clearly installed if you can call its tools) and only walk them through what's missing. If penpot_status says the key is missing, walk them through section 4 to get it and paste it into the extension's settings (saving restarts the extension), and carry on with the interview meanwhile. Call keeper_start once the key is set; if it reports needs_sign_in, tell them a Penpot window opened for them to sign in and open their design file.
- Section 6 is the interview: ask a few questions at a time (use a multiple-choice question tool when the session has one), offer a sensible default for anything they don't care about, and never invent facts about their brand. Save example posts, the logo, fonts and photos with add_brand_file, and past captions or writing rules as voice notes (add_brand_file kind voice with text). Images shared in the chat don't reach the extension, so ask where the files are saved and pass that location as source_path: one file, or a folder to add everything of that kind in it (section 2 tells them how to copy a location), or a link. add_brand_file returns previews of saved images: check they're what the user meant, and use what you see in the example posts to suggest the look, colors and fonts. Read back a short summary, then save with save_brand_kit (overwrite: true only to replace settings they already had), call analyze_brand_kit and resolve every problem. Then call ai_detector_status with download: true, so the AI-writing check's model downloads while you carry on.
- Section 7 is optional: offer it, and if they want it, walk them through it one step at a time, asking for a screenshot whenever their screen doesn't match. Never ask them to paste the token into the chat; it goes only in the extension's settings. Then call get_insights to check it.
- Section 8: offer a test post with the create_posts guide (get_guide name "create_posts") and days 1. Fix the brand kit from their feedback so later batches get it right.
- Finish with two lines: what's set up, and how to make a batch next time.

---

`;

const INSTAGRAM = `# How to use this guide (for Claude)

Walk the user through section 7 (Connect Instagram Insights) of the guide below, one step at a time: say what to click, wait for them, and ask for a screenshot whenever their screen doesn't match. Use section 11's Instagram troubleshooting when something goes wrong. Never ask them to paste the token into the chat; it goes only in the extension's settings (Settings > Extensions > Social Content > Configure). When it's in, call get_insights to check it works.

---

`;

const read = (file: string) => fs.readFileSync(new URL(`../guides/${file}`, import.meta.url), "utf8");

export function readGuide(name: GuideName): string {
  if (name === "create_posts") return read("create-posts.md");
  return (name === "setup" ? INTERVIEW : INSTAGRAM) + read("getting-started.md");
}

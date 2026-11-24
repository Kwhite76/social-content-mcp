import fs from "node:fs";

/** The guides that ship with the server (guides/ at the package root, next to dist/ and src/). */
export const GUIDES = {
  setup: "First-time setup: an interview that fills in the brand kit and connects Penpot and Instagram",
  create_posts: "Make a batch of posts: plan, research, write, design in Penpot, render reels, log, deliver",
  connect_instagram: "Connect Instagram Insights: set up a Meta app, generate an access token and add it to the extension",
} as const;
export type GuideName = keyof typeof GUIDES;

const FILES: Record<GuideName, string> = { setup: "setup.md", create_posts: "create-posts.md", connect_instagram: "connect-instagram.md" };

export function readGuide(name: GuideName): string {
  return fs.readFileSync(new URL(`../guides/${FILES[name]}`, import.meta.url), "utf8");
}

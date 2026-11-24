/** The 14 reel motion styles, one per day of a 14-day rotation. */
export const REEL_STYLES = [
  "pushin", "slide", "pan", "drop", "shine", "flip", "rise",
  "spin", "focus", "deal", "wipe", "scan", "flash", "handheld",
] as const;

export type ReelStyle = (typeof REEL_STYLES)[number];

/** The transition each style uses between reel beats. */
export const BEAT_TRANSITION: Record<ReelStyle, "fade" | "slide" | "vslide" | "flipx" | "whip" | "flash"> = {
  pushin: "fade", slide: "slide", pan: "fade", drop: "vslide", shine: "fade", flip: "flipx", rise: "vslide",
  spin: "whip", focus: "fade", deal: "slide", wipe: "slide", scan: "vslide", flash: "flash", handheld: "whip",
};

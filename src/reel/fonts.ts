import { createRequire } from "node:module";

/** Fonts that ship with the server, for reel notes. A brand can also use its own font file. */
export const BUNDLED_FONTS: Record<string, string> = {
  Inter: "@fontsource/inter/files/inter-latin-600-normal.woff2",
  Kalam: "@fontsource/kalam/files/kalam-latin-700-normal.woff2",
  "Gochi Hand": "@fontsource/gochi-hand/files/gochi-hand-latin-400-normal.woff2",
};

const require_ = createRequire(import.meta.url);
export const bundledFontPath = (name: string) => require_.resolve(BUNDLED_FONTS[name] ?? BUNDLED_FONTS.Inter);

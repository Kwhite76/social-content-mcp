# Social Content MCP

Brand kit in, on-brand posts and reels out. A Claude Desktop extension that interviews you
about your brand, plans posts from your brand kit and post history, builds the images in your
Penpot, renders 20-30 s reels, reads your Instagram Insights and keeps a local log so nothing
repeats. It has no brand of its own: everything brand-specific lives in your brand kit.
See [docs/PLAN.md](docs/PLAN.md) for the design and status.

## Install

1. Download the `.mcpb` for your computer from the latest
   [release](https://github.com/Kwhite76/social-content-mcp/releases): `win32-x64` (Windows),
   `darwin-arm64` (Apple Silicon Mac), `darwin-x64` (Intel Mac) or `linux-x64`.
2. Double-click it to install in Claude Desktop, and fill in the settings: a folder for your
   brand kit (an empty one is fine) and your Penpot MCP key (Penpot: Your account >
   Integrations > MCP Server). The Instagram token is optional: see
   [Connect Instagram Insights](guides/connect-instagram.md).
3. In Claude, use the **setup** prompt or ask "set up Social Content". Claude interviews you
   about your brand, writes the brand kit, connects Penpot (a Penpot window opens once for you
   to sign in), helps you get an Instagram token, and makes a test post.

Then ask for a batch of posts, or use the **create_posts** prompt.

You need a free Penpot account and Chrome or Edge (Windows already has Edge).

## What's in it

| | |
|---|---|
| Guides | `setup` (the interview), `create_posts` (the whole batch workflow) and `connect_instagram` (getting an Instagram token), as prompts and through `get_guide` |
| Brand kit | `init_brand_kit`, `analyze_brand_kit`, `save_brand_kit`, `add_brand_file` |
| Planning and writing | `plan_batch`, `check_batch_plan` (repeat rules), `check_caption` (the brand's writing rules) |
| History | `log_post`, `query_history` (`history.jsonl` in the kit) |
| Instagram | `get_insights` (Unified login, Instagram login or Facebook login tokens): recent posts' reach, saves, shares, watch time and follower vs non-follower reach, matched to your logged posts (read-only; saved in the kit's insights/ folder) |
| Penpot | `penpot_status`, `penpot_execute`, `penpot_upload_image`, `render_post` (board to PNG), through Penpot's hosted MCP with your key |
| Reels | `render_reel`: 1080x1920, 14 motion styles, 3-7 beats with notes in your note style, ending on your logo |
| Keeper | `keeper_start`, `keeper_status`: keeps Penpot's plugin connected; starts on its own |

## The brand kit

```
logo/        your logo, a transparent PNG (shown at the end of every reel)
style/       posts you love (the look to follow)
assets/      your own photos and backgrounds
voice/       past captions and writing notes
fonts/       optional font files for reel notes
brand.yaml   name, voice, writing rules, design (look, colors, fonts, what to avoid), reel note style
pillars.yaml topics, formats and angles, backgrounds, layouts, reel styles, repeat rules
history.jsonl, insights/, output/   written by the extension
```

The setup interview writes all of it; you can also edit the YAML by hand (`init_brand_kit`
creates a commented example).

## Build it yourself

The canvas and ffmpeg binaries are per platform, so each bundle is built for one:

```
npm install
npm run pack                          # this computer's platform
npm run pack -- --target darwin-x64   # or another (packaging only)
```

Releases: push a tag like `v0.3.0`; the Release workflow builds and tests every platform's
bundle and attaches them to the GitHub release.

## Penpot keeper

Penpot's MCP plugin only works while its browser tab is awake. The keeper opens Penpot in
its own Chrome or Edge window that is never put to sleep, keeps your file open and reconnects
MCP whenever it drops.

The extension starts it with the server, in a worker thread, restarts it if it crashes, and
closes its browser when Claude Desktop quits or the extension is turned off. If a Penpot call
fails while MCP is disconnected, the server waits for the keeper to reconnect and retries once.
Only one keeper runs per computer (`keeper.lock`); to run it by hand instead, turn Auto-start
keeper off and run:

```
npx social-content-mcp keeper
```

First run: sign in to Penpot in the window that opens and open your design file; it's remembered
(`keeper_status` reports `needs_sign_in` until then). From
then on the keeper runs headless (no window), so Windows never treats Penpot as a background
tab to freeze; if Penpot ever asks you to sign in again, a window opens for that. A watchdog
restarts the browser if the page stops responding. `KEEPER_HEADED=1` keeps the window.
Files live in `~/.social-content-mcp/keeper` (log, settings, `PAUSE` file to pause it).

## Reels

`render_reel` draws with Skia (`@napi-rs/canvas`) and encodes with a bundled ffmpeg, so
nothing else needs installing. Frames are rendered in 2-second segments by up to 6 worker
threads in parallel (one per spare core, limited by free memory) and joined byte for byte (raw H.264, no B-frames), which keeps every
frame and keeps memory flat: the canvas binding never returns the memory of pixel reads, so
each segment's thread exits and the memory is reused. Threads, not subprocesses, because
Claude Desktop's built-in Node can't start Node subprocesses.

## Develop

```
npm install
npm run build
npm test                 # unit + MCP integration tests
KEEPER_E2E=1 npm test    # also runs the keeper against a mock Penpot (needs Chrome or Edge)
REEL_E2E=1 npm test      # also encodes a reel end to end (run npm run build first)
npm run bench:reel       # times a ~29 s reel on this machine
npm run spike:penpot     # with SCM_PENPOT_MCP_KEY set: checks the key reaches Penpot
```

Settings (environment variables, filled in by the .mcpb settings screen):
`SCM_BRAND_KIT_DIR`, `SCM_PENPOT_MCP_KEY`, `SCM_PENPOT_URL`, `SCM_INSTAGRAM_TOKEN`,
`SCM_INSTAGRAM_ACCOUNT_ID`, `SCM_AUTO_KEEPER`, `SCM_OUTPUT_DIR`.

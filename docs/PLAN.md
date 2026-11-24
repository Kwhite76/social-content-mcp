# Plan

Generalizes The Hatchery's `hatchery-community-post` skill into a plugin anyone can use:
**brand kit in, on-brand posts and reels out.**

## Shape

- **Plugin = skill + MCP server.** The skill holds the judgment (plan the batch, research and
  fact-check, write in the user's voice, humanize and check with an AI detector, Story,
  comments, music and reel beats). The server holds the tools.
- **Brand kit** (the user's folder): `logo/`, `style/`, `assets/`, `voice/`, `brand.yaml`,
  `pillars.yaml`.
- **Connections** (the user's own, set once in the .mcpb settings screen, secrets in the OS
  keychain): Penpot MCP key, an AI detector and the local log are required; the Instagram
  Graph API token is optional (without it the Insights step is skipped).
- **Outputs per post:** 1080x1350 image, 20-30 s 1080x1920 reel in its own style, caption and
  hashtags, Story and pinned comment, music suggestions, and what Insights showed.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript on Node | Reference MCP SDK; .mcpb runs Node servers on the runtime Claude Desktop ships, so users install nothing; Playwright for the keeper is native |
| Design tool | Penpot, through Penpot's hosted MCP with the user's key | Editable designs, no credits; the user installs one extension, not two |
| Keeping Penpot connected | Keeper: Playwright drives the installed Chrome/Edge in its own never-throttled window | Penpot's plugin only runs while its tab is awake |
| Reels | Port of the Python/Pillow renderer to Node (Skia via @napi-rs/canvas + ffmpeg) | Faster, no Python needed |
| Log | `history.jsonl` in the brand kit | Local, readable, diffable; no Google Drive dependency |
| Batch runs | Lead agent plans, 4 workers build posts in parallel | 14 posts in one agent took 30+ minutes |

## Build order

- **v0, local:** brand kit, render_post, render_reel with beats, Penpot keeper, local log.
  Test on The Hatchery.
- **v1, plugin:** skill with multi-agent batch runs, Insights, onboarding interview, "Sign in to Penpot"
  (Penpot's MCP OAuth flow, so users don't paste a key). Packed as .mcpb.
- **v2, hosted:** OAuth, multi-user. Only if non-technical users need it.

## v0 status

- [x] Brand kit format, `init_brand_kit`, `analyze_brand_kit`
- [x] Rotation planner (`plan_batch`) and repeat checker (`check_batch_plan`)
- [x] Local log (`log_post`, `query_history`)
- [x] Penpot bridge (`penpot_status`, `penpot_execute`, `render_post`)
- [x] Keeper (`social-content-mcp keeper`, `keeper_status`), e2e-tested against a mock of Penpot's MCP menu;
  verified on real Penpot 2026-11-23 (sign-in, file remembered, MCP connected)
- [x] Spike on a real account (2026-11-23): a plain MCP client reaches Penpot's hosted MCP with just the user's MCP key
- [x] `render_reel`: 14 styles and beats ported to Node; matches the Python renderer (mean pixel
  difference 1-6 of 255 across all styles); parallel segment workers; check frames
- [x] Benchmark (`npm run bench:reel`), 29 s reel: Jade's PC (16 cores) 9.1 s with 4 workers, 7.1 s with 8; 2-core sandbox 35 s;
  Python 40 s. Worker cap raised to 8, limited by free memory
- [x] Packaging: `npm run pack` builds the .mcpb per OS; packed bundle smoke-tested (tools, kit, plan, 20 s reel)
- [x] Hatchery brand kit with history migrated from the Drive log (Nov 23 - Dec 6)
- [x] End to end in Claude Desktop on Jade's PC (2026-11-24, v0.1.2): penpot_status, render_post (Hatchery
  Graphics board to 1080x1350 PNG), render_reel (29 s, 5 beats, pan) in 8.3 s with 6 worker threads
- [x] Keeper starts with the extension (v0.2.0): worker thread, one keeper per computer (lock + heartbeat),
  restart with backoff, clean shutdown when Desktop quits, Penpot calls wait for a reconnect and retry once;
  `keeper_start`; e2e-tested (start with serve, second keeper refused, stdin close stops the browser, takeover after a kill)
- [ ] Run a full Hatchery batch through v0 (Dec 7 - Dec 20): needs the skill rewritten to use these tools

# Plan

Generalizes The Hatchery's `hatchery-community-post` skill into a plugin anyone can use:
**brand kit in, on-brand posts and reels out.**

## Shape

- **One extension, no brand of its own.** The server holds the tools and ships the judgment as
  two guides (MCP prompts, and `get_guide`): `setup` interviews the user and writes the brand
  kit; `create_posts` runs a batch (plan, research, write, humanize, AI check, Penpot design,
  reels, log, deliver). Everything brand-specific lives in the user's brand kit; a brand's own
  skill (like the Hatchery's) can layer its specifics on top.
- **Brand kit** (the user's folder): `logo/`, `style/`, `assets/`, `voice/`, `fonts/`,
  `brand.yaml` (voice, writing rules, design, reel note style), `pillars.yaml` (topics,
  formats, backgrounds, layouts, reel styles, repeat rules).
- **Connections** (the user's own, set once in the .mcpb settings screen, secrets in the OS
  keychain): the Penpot MCP key is required; the Instagram token is optional (without it the
  Insights step is skipped); an AI-text detector is used if the session has one.
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
| Generic, not Hatchery | Subjects (not cards), backgrounds (not textures), repeat rules, design and reel note look all come from the brand kit; old names still read | The extension must fit any customer |
| Insights | Official Instagram API with the user's token (Instagram Login or Facebook Login), refreshed weekly | Read-only, no browser scraping |
| Distribution | GitHub release with one .mcpb per platform, built by CI on a tag | Users don't build anything |

## Build order

- **v0, local:** brand kit, render_post, render_reel with beats, Penpot keeper, local log.
  Test on The Hatchery.
- **v1, for anyone:** brand-neutral server, onboarding interview and batch guide shipped in the
  extension, Insights, prebuilt releases. Later: "Sign in to Penpot" (Penpot's MCP OAuth flow,
  so users don't paste a key).
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

## v1 status

- [x] Brand-neutral server (v0.3.0): subjects/backgrounds (old names still read), repeat rules,
  design and reel note style (card, paper or plain; bundled or brand fonts) in the brand kit;
  generic templates and test fixture; a test fails if any one brand's name shows up in tools or guides
- [x] `get_insights`: Instagram API (Instagram Login or Facebook Login), per-post metrics with
  fallbacks, follower vs non-follower reach, matched to the log, grouped; token refreshed weekly; mock-server tested
- [x] Onboarding: `setup` and `create_posts` guides as MCP prompts and `get_guide`; `save_brand_kit`,
  `add_brand_file`, `check_caption`, `penpot_upload_image`; server instructions point new users to setup
- [x] Release workflow: per-platform .mcpb (win32-x64, darwin-arm64, darwin-x64, linux-x64) on a tag,
  tested and smoke-tested per platform; cross-packing checked locally (darwin-arm64 binaries)
- [x] First release (v0.3.0) built on GitHub and installed from the release on Jade's PC; Hatchery kit validates under it
- [x] v0.3.1: `penpot_upload_image` sends images in 60 KB pieces (Penpot's hosted MCP refuses bodies over ~100 KB)
  and shrinks big ones to 2048 px first. Keeper makes a real test call through Penpot's MCP every minute and
  restarts the browser after two failures (seen on real Penpot: dot "connected", plugin "suspended"); a tool call
  that hits a stalled plugin asks the keeper to reconnect, waits for a fresh connection and retries once
- [x] Meta stopped offering Instagram login to new apps (late Oct 2026); new apps get Unified login: a
  never-expiring system-user token on graph.facebook.com, account from /me/assigned_instagram_accounts.
  `get_insights` handles it (v0.3.1), and the setup guide walks through it
- [x] v0.3.1 live on Jade's PC: `penpot_upload_image` sent the full 3508 px logo (shrunk to 2048, in pieces) and it exported intact
- [x] v0.3.2: Claude Desktop passes an optional setting left empty as its literal placeholder
  ("${user_config.instagram_account_id}"); settings like that now count as blank. Keeper logs its first
  successful test call, so the probe can be seen working
- [x] Live on Jade's PC (v0.3.2, 2026-11-24): `get_insights` with a Unified login token and the account ID
  setting left empty pulled 25 posts with all metrics and follower vs non-follower reach; the keeper's
  test call logged as working; a stalled plugin right after startup was caught by penpot_status, which
  asked the keeper to reconnect and retried successfully
- [x] One user guide (guides/getting-started.md): install, each piece and what it does, Penpot, the keeper,
  the brand kit interview, Instagram (Unified login, from the real screens), first post, day to day,
  reference for every setting and reel style, troubleshooting, updating and privacy. The setup and
  connect_instagram prompts serve it with a short note for Claude; create_posts stays Claude's batch procedure
- [ ] A new user runs setup end to end


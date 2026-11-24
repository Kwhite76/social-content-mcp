# Social Content MCP

Brand kit in, on-brand posts and reels out. An MCP server that plans engagement posts from
your brand kit and post history, builds the images in Penpot, renders 20-30 s reels and keeps
a local log so nothing repeats. See [docs/PLAN.md](docs/PLAN.md) for the design and status.

## Tools (v0)

| Tool | What it does |
|---|---|
| `init_brand_kit` | Creates the brand kit folder and example YAML |
| `analyze_brand_kit` | Validates the kit and lists what's in it |
| `plan_batch` | Topic and format per day from the rotation, plus the history to avoid |
| `check_batch_plan` | Flags repeated angles, items, facts, textures, layouts and reel styles |
| `log_post` / `query_history` | The local post log (`history.jsonl`) |
| `penpot_status` / `penpot_execute` / `render_post` | Penpot through its hosted MCP, with your key |
| `render_reel` | 1080x1920 reel in one of 14 motion styles; with 3-7 beats it runs 20-30 s; writes check frames |
| `keeper_status` | Whether the Penpot keeper is running |

## Install (Claude Desktop)

Build the extension on the computer that will run it (the canvas and ffmpeg binaries are per-OS):

```
npm install
npm run pack
```

Double-click `social-content-mcp.mcpb`, then fill in the settings: your brand kit folder and
your Penpot MCP key (Penpot: Your account > Integrations > MCP Server). Start the keeper so
Penpot stays connected: `npx social-content-mcp keeper` (or `node dist/cli.js keeper`).

## Penpot keeper

Penpot's MCP plugin only works while its browser tab is awake. The keeper opens Penpot in
its own Chrome or Edge window that is never put to sleep, keeps your file open and reconnects
MCP whenever it drops:

```
npx social-content-mcp keeper
```

First run: sign in to Penpot in the window and open your design file; it's remembered.
Files live in `~/.social-content-mcp/keeper` (log, settings, `PAUSE` file to pause it).

## Reels

`render_reel` draws with Skia (`@napi-rs/canvas`) and encodes with a bundled ffmpeg, so
nothing else needs installing. Frames are rendered in 2-second segments by up to 8 worker
processes in parallel (one per spare core, limited by free memory) and joined byte for byte (raw H.264, no B-frames), which keeps every
frame and keeps memory flat: the canvas binding never returns the memory of pixel reads, so
each segment process exits and hands it back.

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
`SCM_BRAND_KIT_DIR`, `SCM_PENPOT_MCP_KEY`, `SCM_PENPOT_URL`, `SCM_INSTAGRAM_TOKEN`, `SCM_OUTPUT_DIR`.

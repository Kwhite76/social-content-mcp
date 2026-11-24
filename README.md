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
| `keeper_status` | Whether the Penpot keeper is running |

## Penpot keeper

Penpot's MCP plugin only works while its browser tab is awake. The keeper opens Penpot in
its own Chrome or Edge window that is never put to sleep, keeps your file open and reconnects
MCP whenever it drops:

```
npx social-content-mcp keeper
```

First run: sign in to Penpot in the window and open your design file; it's remembered.
Files live in `~/.social-content-mcp/keeper` (log, settings, `PAUSE` file to pause it).

## Develop

```
npm install
npm run build
npm test                 # unit + MCP integration tests
KEEPER_E2E=1 npm test    # also runs the keeper against a mock Penpot (needs Chrome or Edge)
npm run spike:penpot     # with SCM_PENPOT_MCP_KEY set: checks the key reaches Penpot
```

Settings (environment variables, filled in by the .mcpb settings screen):
`SCM_BRAND_KIT_DIR`, `SCM_PENPOT_MCP_KEY`, `SCM_PENPOT_URL`, `SCM_INSTAGRAM_TOKEN`, `SCM_OUTPUT_DIR`.

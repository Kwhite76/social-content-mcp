# Social Content MCP

Brand kit in, on-brand posts and reels out. A Claude Desktop extension that interviews you
about your brand, plans posts from your brand kit and post history, builds the images in your
Penpot, renders 20-30 s reels, reads your Instagram Insights and keeps a local log so nothing
repeats. It has no brand of its own: everything brand-specific lives in your brand kit.
See [docs/PLAN.md](docs/PLAN.md) for the design and status.

## Get started

**[First-time setup guide](guides/getting-started.md)**: installing, Penpot, the brand kit
interview, connecting Instagram and your first post, with what each piece does.

In short: download the `.mcpb` for your computer from the latest
[release](https://github.com/Kwhite76/social-content-mcp/releases), double-click it, add your
Penpot MCP key, and use the **setup** prompt in Claude.

## What's in it

| | |
|---|---|
| Guides | `setup` (the first-time setup guide, as an interview), `create_posts` (the batch workflow) and `connect_instagram` (the guide's Instagram section on its own), as prompts and through `get_guide` |
| Brand kit | `init_brand_kit`, `analyze_brand_kit`, `save_brand_kit`, `add_brand_file` |
| Planning and writing | `plan_batch`, `check_batch_plan` (repeat rules), `check_caption` (the brand's writing rules) |
| History | `log_post`, `query_history` (`history.jsonl` in the kit) |
| AI-writing check | `detect_ai_text`, `ai_detector_status`: the desklib DeBERTa-v3 detector (MIT), converted to ONNX and run locally; scores like houtini-ai/ai-detect (sentence split, 5-word minimum, mean). Required for every caption. Native onnxruntime-node, or its WebAssembly build where there's no native one (Intel Macs). The model downloads once from the `detector-model-v1` release, built by the Detector model workflow |
| Instagram | `get_insights` (Unified login, Instagram login or Facebook login tokens): recent posts' reach, saves, shares, watch time and follower vs non-follower reach, matched to your logged posts (read-only; saved in the kit's insights/ folder) |
| Penpot | `penpot_status`, `penpot_execute`, `penpot_upload_image`, `render_post` (board to PNG), through Penpot's hosted MCP with your key |
| Reels | `render_reel`: 1080x1920, 14 motion styles, 3-7 beats with notes in your note style, ending on your logo |
| Keeper | `keeper_start`, `keeper_status`: keeps Penpot's plugin connected; starts on its own |

## The brand kit

A folder of yours: `brand.yaml`, `pillars.yaml`, `logo/`, `style/`, `assets/`, `voice/`,
`fonts/`, plus `history.jsonl`, `insights/` and `output/` written by the extension. The setup
interview writes it; the [guide](guides/getting-started.md#10-reference) explains every setting.

## Build it yourself

The canvas and ffmpeg binaries are per platform, so each bundle is built for one:

```
npm install
npm run pack                          # this computer's platform
npm run pack -- --target darwin-x64   # or another (packaging only)
```

Releases: bump the version in `package.json` and `manifest.json`, then push a tag `vX.Y.Z`
(or run the Release workflow from the Actions tab). It builds, tests and smoke-tests every
platform's bundle and attaches them to the GitHub release. The AI detector's model has its own
release, `detector-model-vN`, built by the Detector model workflow (see below); it only needs
rebuilding when the model changes.

## Penpot keeper

Penpot's MCP plugin only works while its browser tab is awake. The keeper opens Penpot in
its own Chrome or Edge window that is never put to sleep, keeps your file open and reconnects
MCP whenever it drops.

The extension starts it with the server, in a worker thread, restarts it if it crashes, and
closes its browser when Claude Desktop quits or the extension is turned off. Every 30 seconds it
checks Penpot's MCP menu, and every minute it makes a real test call through Penpot's MCP: the
menu can say connected while the plugin has stopped answering, so two failed test calls in a row
restart the browser. If a tool's Penpot call fails because the plugin is disconnected or stalled,
the server asks the keeper to reconnect (a `RECONNECT` file), waits for a fresh connection and
retries once.
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

## AI-writing check

`detect_ai_text` runs desklib/ai-text-detector-v1.01 (MIT; DeBERTa-v3-large, mean pooling, one
logit) locally and scores like houtini-ai/ai-detect: split after `.`, `!` or `?` plus whitespace,
skip sentences under 5 words, sigmoid per sentence, mean as a percentage. It's required: every
caption is scored, and `log_post` needs the score.

- **Model:** converted to ONNX by the Detector model workflow (`scripts/detector/export.py`), which
  then runs `scripts/detector/parity.ts`: the Node tokenizer must match Python's token ids exactly
  and the fp32 model must match PyTorch within 0.01 on `scripts/detector/samples.json`; the int8
  model ships if it stays within 0.05 with no sentence changing sides of 0.5, else fp32. The files
  and the parity report go on the `detector-model-v1` release. Push a `detector-model-vN` tag to
  rebuild (and update the release name in `src/detect/detector.ts`).
- **Download:** about 450 MB, once, on first use (or `ai_detector_status` with `download: true`),
  checked against the manifest's SHA-256, kept in `~/.social-content-mcp/models`.
- **Runtime:** onnxruntime-node, or onnxruntime-web's WebAssembly build where there's no native
  binary (Intel Macs); same scores. `.npmrc` skips onnxruntime-node's optional CUDA download.
  Bundles keep only their platform's native binaries and the one wasm build.
- **Tests:** `tests/fixtures/detector` is a stand-in DeBERTa-v3-style tokenizer and tiny ONNX model
  with Python's token ids and scores, so the tokenizer, truncation at 512 tokens, both runtimes,
  the download and the checksum are all tested without the real model.

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

Settings (environment variables, filled in by the .mcpb settings screen; an unfilled
`${user_config.x}` placeholder counts as empty):
`SCM_BRAND_KIT_DIR`, `SCM_PENPOT_MCP_KEY`, `SCM_PENPOT_URL`, `SCM_INSTAGRAM_TOKEN`,
`SCM_INSTAGRAM_ACCOUNT_ID`, `SCM_AUTO_KEEPER`, `SCM_OUTPUT_DIR`.
For tests: `SCM_STATE_DIR` (instead of `~/.social-content-mcp`), `SCM_INSTAGRAM_API_BASE`,
`SCM_DETECTOR_URL`, `SCM_DETECTOR_DIR`, `SCM_DETECTOR_RUNTIME=wasm`, `KEEPER_PROBE_TICKS`.

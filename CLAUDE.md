# social-content-mcp

TypeScript MCP server (Node >= 20, ESM, TS 7). Plan and status: docs/PLAN.md.

- `npm run build` then `npm test` before every commit; keep tests green.
- Run the keeper e2e test with `KEEPER_E2E=1` after touching src/keeper.
- stdout belongs to MCP in `serve` mode: log to stderr only.
- Rotation rules live in src/plan.ts (`checkPlan`) with tests in tests/plan.test.ts; change both together.
- Penpot is reached only through its hosted MCP (src/penpot.ts), never by scraping the web app.
  The keeper (src/keeper) is the one place that drives the Penpot UI, and only to keep MCP connected.
- Brand kit schema changes go in src/brandkit.ts and the templates in the same file; update guides/ to match.
- The server has no brand of its own: nothing brand-specific in src/ or guides/ (tests/server.test.ts checks).
- Release: bump the version in package.json and manifest.json, then push a tag `vX.Y.Z`.

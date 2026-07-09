# justdoit build — progress ledger

Branch: build/justdoit-mvp
Execution unit: per phase (see docs/superpowers/plans/). Gates run by controller: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.

Parallelism: spine 0→1→2→3, then 4 ∥ 5, then 6.

## Status

- [x] Phase 0 — Foundation
- [x] Phase 1 — Core + REST
- [x] Phase 2 — Time tracking
- [x] Phase 3 — Scheduling
- [x] Phase 4 — MCP server
- [x] Phase 5 — Web UI
- [x] Phase 6 — Polish

## Log

Phase 0: complete (commits 796ea1c..ec9e236, gates green, 9 tables). Minor: benign eslint.config.js module-type warning.
Phase 1: complete (commits 9823ae0..a533a1c, 59 tests, gates green, live API smoke-tested). Minor: unknown-cast on Response.json() under node-only tsconfig.
Phase 2: complete (commits d7b20c0..4bfcf70, 98 tests, gates green). Note: routes use xxxRoutes(db):Hono factory pattern (not c.get(db)); fixed TimeEntryFilter zod optional-key inference.
Phase 3: complete (commits 45d6a69..646d978, 128 tests, gates green, no concerns).
Phase 4: complete (merged worktree, commits 4bd74ff..42830e0, 28 mcp tests, 156 total, gates green). SDK 1.29.0; MCP uses core real filter surface; also fixed pre-existing rrule CJS/ESM interop in core/recurrence.ts (unblocks tsx boot). Controller added .next/.claude to lint+prettier ignores and .next to gitignore.
Phase 5: complete (merged worktree, commits 6467a1c..a9589c2, 176 tests + Playwright 3/3, gates green). Added 4 backend gap-fixes (CORS, task-tags routes, due-range filter, rrule). Merge reconciled recurrence.ts/gitignore/eslint/lockfile. frontend-design skill was unavailable; tokens derived from plan constraints.
Phase 6: complete (commits 6245929..08e8fd0, 251 tests total, gates green, web build OK, SSE smoke-tested). ALL PHASES DONE.

## Whole-branch review + fixes (final)

- 4 parallel scoped reviewers (core/api/mcp/web). Findings: mcp had 2 Critical (single-client HTTP transport; z.coerce.date null->1970 corruption), plus Important across all pkgs.
- 4 parallel fix agents applied Critical+Important+cheap Minors, each TDD, scoped per package.
- Final gates: 306 tests (core 124, api 52, mcp 40, web 90), typecheck/lint/format green, web build OK, API runtime smoke (quick-add NL parse) verified.
- ALL PHASES COMPLETE + REVIEWED + FIXED.

## Phase 7 (multitenant hosting)
- [x] 7a Core multitenancy: merged (merge commit, 344 tests incl isolation gate 5/5 + SSE per-user filter; core 161/api 53/mcp 40/web 90). users/api_keys tables, user_id everywhere, Ctx threading, local-user default.
- [ ] 7b GitHub auth
- [ ] 7c Railway deploy

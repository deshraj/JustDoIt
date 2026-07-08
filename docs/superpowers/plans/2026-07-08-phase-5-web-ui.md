# Phase 5: Next.js UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **REQUIRED DESIGN SUB-SKILL:** Before writing ANY component markup or styling, invoke the **frontend-design** skill and hold to its guidance for the whole phase. Before writing ANY chart in Task 11, invoke the **dataviz** skill. The sleek/minimal/keyboard-first aesthetic is the user's top priority — it is a hard acceptance criterion, not a nice-to-have.

**Goal:** Ship `@justdoit/web` — a sleek, minimal, keyboard-first Next.js 15 App Router UI that is a **pure client of the REST API** (`apps/api`). Deliver List, Kanban, and Calendar views, a task detail drawer with an inline timer, natural-language quick-add, a ⌘K command palette, search, and an analytics dashboard, proven by React Testing Library component tests and a Playwright e2e run of the critical flow (quick-add → list → drag to Done on the board).

**Architecture:** `apps/web` is a thin presentation client. It **does NOT import `@justdoit/core`** and **never touches SQLite** — all data flows over HTTP through a single typed API client (`src/lib/api.ts`) that wraps `fetch` and reads its base URL from `NEXT_PUBLIC_API_URL` (default `http://localhost:8787`). Server state is owned by TanStack Query; there is no other global data store. Optional Zod parsing of responses lives beside the client but is tolerant (parse-and-warn, never throw in prod) so a REST shape drift degrades gracefully. Assume every REST endpoint from Phases 1–3 already exists and is running.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript 5.7 (strict), Tailwind CSS 3.4, shadcn/ui (Radix primitives), TanStack Query 5, `next-themes` (class dark-mode strategy), `dnd-kit` (Kanban drag-drop), `cmdk` (command palette), `date-fns` (calendar math), `react-markdown` + `remark-gfm` (markdown preview), Zod 3 (optional response parsing), Recharts (analytics — per dataviz skill), Vitest 3 + React Testing Library + `@testing-library/jest-dom` + jsdom (component tests), Playwright (e2e).

## Global Constraints

- Package name `@justdoit/web`; lives at `apps/web`; ESM (`"type": "module"`); Node `>=22`; pnpm `10.4.1`. Verbatim.
- The UI is a PURE CLIENT. `apps/web` MUST NOT list `@justdoit/core` as a dependency and MUST NOT import it. All data access goes through `src/lib/api.ts`. Verbatim.
- API base URL comes from `process.env.NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8787`. Never hardcode the URL anywhere else. Verbatim.
- Dark mode uses the Tailwind `class` strategy driven by `next-themes` (`attribute="class"`). Dark is the design's first-class target; both themes must be legible. Verbatim.
- **Design system (bake into `globals.css` + Tailwind theme, enforced everywhere):**
  - Restrained palette: one neutral ramp (zinc) + a single accent (indigo). Priority/status get muted semantic hues used sparingly (small dots/pills, never full-bleed fills).
  - **Few borders.** Prefer whitespace and subtle background elevation (`bg-muted`) over 1px lines to separate regions.
  - Type scale (only these): `text-xs` (meta), `text-sm` (body/UI default), `text-base` (input), `text-lg` (view title), `text-2xl` (page/empty-state). Weights: 400 body, 500 UI labels, 600 titles.
  - Spacing rhythm on a 4px grid; generous: page gutter `px-6`/`px-8`, section gaps `gap-6`, list-row padding `py-2.5`.
  - Motion: subtle only — `transition-colors`/`transition-opacity` ~150ms, `ease-out`; drag uses dnd-kit defaults. Respect `prefers-reduced-motion`.
  - **Focus-visible everywhere:** every interactive element shows a visible `focus-visible:ring-2 ring-ring` state. Keyboard-first means nothing is reachable only by mouse.
- Testing: component tests mock the API client module (never hit the network); Playwright e2e runs against a REAL `apps/api` instance seeded with a temp/throwaway SQLite DB. Verbatim.
- All new `apps/web` code typechecks under the repo's strict base config and passes `pnpm lint` / `pnpm format:check`.

---

## File Structure

```
apps/web/
├── package.json                 # @justdoit/web, next/react/tailwind/tanstack/etc.
├── next.config.ts
├── tsconfig.json                # extends ../../tsconfig.base.json, adds jsx+next plugin
├── tailwind.config.ts           # design tokens: zinc neutral, indigo accent, type scale
├── postcss.config.mjs
├── components.json              # shadcn/ui config
├── vitest.config.ts             # jsdom env, RTL setup
├── vitest.setup.ts              # jest-dom matchers
├── playwright.config.ts         # webServer: api + web; temp DB
├── .env.local.example           # NEXT_PUBLIC_API_URL=http://localhost:8787
├── e2e/
│   ├── fixtures.ts              # spin up seeded apps/api on a temp DB
│   └── critical-flow.spec.ts    # quick-add → list → board drag-to-Done
└── src/
    ├── app/
    │   ├── layout.tsx           # root: Providers + AppShell
    │   ├── globals.css          # Tailwind + CSS vars for both themes
    │   ├── page.tsx             # redirect → /tasks
    │   ├── tasks/
    │   │   ├── page.tsx         # List view
    │   │   └── @modal/          # intercepted route for task detail drawer
    │   │       └── (.)[id]/page.tsx
    │   ├── tasks/[id]/page.tsx  # full-page task detail (hard nav fallback)
    │   ├── board/page.tsx       # Kanban
    │   ├── calendar/page.tsx    # Calendar
    │   ├── search/page.tsx      # Search
    │   └── analytics/page.tsx   # Analytics dashboard
    ├── components/
    │   ├── ui/                  # shadcn/ui primitives (generated)
    │   ├── providers.tsx        # QueryClientProvider + ThemeProvider
    │   ├── app-shell.tsx        # sidebar + top bar layout
    │   ├── sidebar.tsx          # projects nav + view links
    │   ├── quick-add-bar.tsx    # top NL quick-add input
    │   ├── theme-toggle.tsx
    │   ├── command-palette.tsx  # cmdk ⌘K
    │   ├── task-row.tsx / task-card.tsx / task-detail.tsx
    │   ├── list-view.tsx / board-view.tsx / calendar-view.tsx
    │   ├── inline-timer.tsx
    │   └── charts/              # Recharts wrappers (dataviz skill)
    ├── hooks/                   # useTasks, useProjects, useTimer, … (TanStack Query)
    └── lib/
        ├── api.ts              # typed fetch client (THE data boundary)
        ├── schemas.ts          # optional Zod response schemas
        ├── query-keys.ts       # centralized TanStack Query keys
        └── utils.ts            # cn(), date/format helpers
```

**Top-level routes:** `/` (→ redirect), `/tasks` (List + detail drawer via intercepted `@modal/(.)[id]`), `/tasks/[id]` (full-page detail fallback), `/board` (Kanban), `/calendar` (Calendar), `/search`, `/analytics`.

**API client methods (`src/lib/api.ts`):** `listTasks`, `getTask`, `createTask`, `updateTask`, `deleteTask`, `setTaskStatus`, `completeTask`, `listSubtasks`, `createSubtask`, `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `listTags`, `createTag`, `updateTag`, `deleteTag`, `search`, `quickAdd`, `listTimeEntries`, `createTimeEntry`, `updateTimeEntry`, `deleteTimeEntry`, `startTimer`, `stopTimer`, `getTimeReport`, `listReminders`, `createReminder`, `updateReminder`, `deleteReminder`, `exportData`, `importData`.

---

## Task 1: Scaffold apps/web + Tailwind + shadcn/ui + dark mode + Turbo wiring

**Files:**
- Create: `apps/web/package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `.env.local.example`
- Create: `apps/web/src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `apps/web/src/components/providers.tsx`, `src/lib/utils.ts`
- Modify: `turbo.json` (add `dev`, `build` tasks), root `.gitignore` (add `.next/`, `test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: the workspace + tooling from Phase 0; `NEXT_PUBLIC_API_URL` env.
- Produces:
  - Runnable `@justdoit/web` Next 15 app (`pnpm --filter @justdoit/web dev`) serving a themed blank shell on `localhost:3000`.
  - `Providers` component wrapping children in `QueryClientProvider` (one shared `QueryClient`) + `ThemeProvider` (`next-themes`, `attribute="class"`, `defaultTheme="dark"`).
  - `cn()` util (clsx + tailwind-merge) and design tokens (zinc/indigo, type scale) in `tailwind.config.ts` + `globals.css` CSS variables for light & dark.
  - `typecheck`/`test`/`lint`/`dev`/`build` npm scripts on the package; `turbo dev`/`turbo build` recognize it.

- [ ] **Step 1: Invoke the frontend-design skill** and record the concrete palette/type/spacing decisions you will encode (they must match the Global Constraints design system).
- [ ] **Step 2:** Create `apps/web/package.json` (`@justdoit/web`, ESM) with deps: `next@^15`, `react@^19`, `react-dom@^19`, `@tanstack/react-query@^5`, `next-themes`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`; devDeps: `tailwindcss@^3.4`, `postcss`, `autoprefixer`, `@types/react`, `@types/react-dom`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@vitejs/plugin-react`, `@playwright/test`. Scripts: `dev` (`next dev`), `build` (`next build`), `start`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:e2e` (`playwright test`). **Do NOT add `@justdoit/core`.**
- [ ] **Step 3:** Create `tsconfig.json` (extend base; add `"jsx": "preserve"`, the Next plugin, `paths` for `@/*` → `src/*`, `"noEmit": true`). Create `next.config.ts`, `postcss.config.mjs`.
- [ ] **Step 4:** Create `tailwind.config.ts` with `darkMode: 'class'`, content globs, and the restrained token theme (zinc neutral ramp, indigo accent, semantic status/priority hues, the fixed type scale). Create `globals.css` importing Tailwind layers + `:root`/`.dark` CSS variables (background, foreground, muted, border, ring, accent). Ensure a global `*:focus-visible` ring.
- [ ] **Step 5:** `pnpm dlx shadcn@latest init` (New York style, zinc base, CSS variables). Create `components.json`. Do not add components yet.
- [ ] **Step 6:** Create `src/components/providers.tsx` (client component) and `src/app/layout.tsx` wiring `<Providers>` + `suppressHydrationWarning` on `<html>`. Create `src/app/page.tsx` that redirects to `/tasks`. Create `.env.local.example`.
- [ ] **Step 7:** Add `dev`/`build` tasks to `turbo.json`; add `.next/`, `test-results/`, `playwright-report/` to root `.gitignore`.
- [ ] **Step 8: Verify — build + boot.** Run `pnpm install`, then `pnpm --filter @justdoit/web build`. Expected: build succeeds. Then `pnpm --filter @justdoit/web dev` and `curl -s localhost:3000/tasks` returns HTML with a `class="dark"` (or theme-managed) `<html>`. Kill the server.
- [ ] **Step 9: Verify — gates.** Run `pnpm --filter @justdoit/web typecheck && pnpm lint && pnpm format:check`. Expected: all PASS.
- [ ] **Step 10: Commit** — `feat(web): scaffold Next 15 app with Tailwind, shadcn/ui, dark mode, TanStack Query`.

---

## Task 2: Typed API client + Zod response schemas + TanStack Query setup

**Files:**
- Create: `apps/web/src/lib/api.ts`, `src/lib/schemas.ts`, `src/lib/query-keys.ts`
- Create: `apps/web/src/lib/api.test.ts`, `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_API_URL`; the REST endpoints (Phases 1–3).
- Produces:
  - `src/lib/api.ts` exporting an `api` object with every method listed in the File Structure header. Each wraps `fetch`, sets `Content-Type: application/json`, forwards an optional `X-API-Key` (from `NEXT_PUBLIC_API_KEY` if set), builds query strings from typed filter params, and throws a typed `ApiError { status, message, body }` on non-2xx.
  - `src/lib/schemas.ts`: Zod schemas (`taskSchema`, `projectSchema`, `tagSchema`, `timeEntrySchema`, `timeReportSchema`, `quickAddResultSchema`) + inferred types (`Task`, `Project`, …). Parsing is **tolerant**: `safeParse`, warn on failure, return raw data (never throw in prod).
  - `src/lib/query-keys.ts`: centralized key factory (`qk.tasks.list(filters)`, `qk.tasks.detail(id)`, `qk.projects.all`, `qk.timeReport(params)`, …).
  - Vitest+jsdom+RTL harness wired (`vitest.config.ts`, `vitest.setup.ts` importing jest-dom).

- [ ] **Step 1: Write the failing test — `src/lib/api.test.ts`.** Stub global `fetch` (vi.fn). Assert: (a) `listTasks({ status: 'todo', projectId: 'p1' })` requests `GET {BASE}/tasks?status=todo&project_id=p1`; (b) `createTask({ title: 'x' })` does `POST {BASE}/tasks` with JSON body; (c) `setTaskStatus('t1', 'done')` does `PATCH {BASE}/tasks/t1/status`; (d) `startTimer('t1')` → `POST {BASE}/tasks/t1/timer/start`; (e) `quickAdd('buy milk tomorrow')` → `POST {BASE}/quick-add`; (f) a 404 response rejects with `ApiError` whose `.status === 404`.
- [ ] **Step 2:** Run `pnpm --filter @justdoit/web test` — Expected: FAIL (module missing). This also proves the Vitest harness runs.
- [ ] **Step 3:** Implement `src/lib/schemas.ts` (tolerant Zod schemas + types), `src/lib/query-keys.ts`, then `src/lib/api.ts` (base-url resolver, `request()` helper, query-string builder mapping camelCase filters → snake_case params, all methods). Map endpoints exactly to the spec's REST routes.
- [ ] **Step 4:** Run `pnpm --filter @justdoit/web test` — Expected: PASS.
- [ ] **Step 5: Verify — typecheck.** `pnpm --filter @justdoit/web typecheck`. Expected: PASS (all methods fully typed, no `any` on public surface).
- [ ] **Step 6: Commit** — `feat(web): typed REST API client, Zod schemas, query keys`.

---

## Task 3: App shell — minimal sidebar (projects) + top quick-add bar + theme toggle

**Files:**
- Create: `apps/web/src/components/app-shell.tsx`, `sidebar.tsx`, `theme-toggle.tsx`, `quick-add-bar.tsx` (input-only stub this task)
- Create: `apps/web/src/hooks/use-projects.ts`
- Create: `apps/web/src/app/tasks/page.tsx` (placeholder List route so the shell renders)
- Create shadcn primitives: `button`, `input`, `tooltip`, `skeleton`, `sonner` (toast)
- Create: `apps/web/src/components/sidebar.test.tsx`
- Modify: `src/app/layout.tsx` (mount `<AppShell>`)

**Interfaces:**
- Consumes: `api.listProjects`, `providers`.
- Produces:
  - `AppShell`: responsive layout — left sidebar (fixed, collapsible on narrow), top bar with quick-add + theme toggle, main content region with generous gutters. Minimal chrome, near-borderless (uses `bg-muted` elevation).
  - `Sidebar`: view links (List `/tasks`, Board `/board`, Calendar `/calendar`, Search `/search`, Analytics `/analytics`) with active state via `usePathname`; a "Projects" section rendering `useProjects()` data (Inbox pinned first), each linking to `/tasks?project=<id>`. Skeleton while loading.
  - `useProjects()` TanStack Query hook (`qk.projects.all`).
  - `ThemeToggle` (next-themes; icon button; keyboard-accessible).
  - `QuickAddBar` stub (styled input + placeholder "Add a task… try 'pay rent friday #home p1'") — wired in Task 8.

- [ ] **Step 1:** Add shadcn primitives listed above.
- [ ] **Step 2:** Implement `useProjects`, `Sidebar`, `ThemeToggle`, `QuickAddBar` stub, `AppShell`; mount `AppShell` in `layout.tsx`; make `/tasks/page.tsx` a placeholder.
- [ ] **Step 3: Write component test — `sidebar.test.tsx`.** Mock `@/lib/api` so `listProjects` resolves `[{id:'inbox',name:'Inbox'},{id:'p1',name:'Work'}]`. Render `<Sidebar>` inside a `QueryClientProvider` + router mock. Assert both project names render and each links to `/tasks?project=<id>`, and the five view links are present.
- [ ] **Step 4: Verify.** `pnpm --filter @justdoit/web test` (sidebar test PASS) and `typecheck` PASS.
- [ ] **Step 5: Verify — scripted manual/visual check.** Boot `dev`, load `/tasks`. Expected: sidebar with 5 view links + projects, top quick-add input, working light/dark toggle (verify `<html>` class flips and both themes are legible), visible focus ring when tabbing. Record a one-line pass note.
- [ ] **Step 6: Commit** — `feat(web): app shell with minimal sidebar, quick-add bar, theme toggle`.

---

## Task 4: List view — grouped, sortable, filterable

**Files:**
- Create: `apps/web/src/components/list-view.tsx`, `task-row.tsx`, `list-toolbar.tsx`
- Create: `apps/web/src/hooks/use-tasks.ts` (`useTasks`, `useUpdateTask`, `useSetTaskStatus`, `useCompleteTask`)
- Create shadcn primitives: `select`, `dropdown-menu`, `checkbox`, `badge`
- Create: `apps/web/src/components/list-view.test.tsx`
- Modify: `src/app/tasks/page.tsx` (render real List view; read `searchParams` for filters)

**Interfaces:**
- Consumes: `api.listTasks`, `api.setTaskStatus`, `api.completeTask`, `api.updateTask`, `api.listProjects`, `api.listTags`.
- Produces:
  - `useTasks(filters)` query hook + mutation hooks that optimistically update and invalidate `qk.tasks.*`.
  - `ListView`: rows grouped by a selectable dimension (status | project | priority | dueAt-bucket | none), sortable (manual `position`, dueAt, priority, createdAt, title), and filterable (status, project, tag, priority, due range, text) — filters mirrored in the URL query string so views are shareable/bookmarkable.
  - `TaskRow`: checkbox (→ complete), title (click → opens detail drawer at `/tasks/[id]`), priority dot, small tag pills, due chip (overdue styled with the muted danger hue), project label. Dense but airy (`py-2.5`). Full keyboard nav (roving tabindex; `j`/`k` optional).
  - Empty state (`text-2xl` calm message) and loading skeletons.

- [ ] **Step 1:** Implement `useTasks` + mutations; `ListToolbar` (group/sort/filter controls bound to URL); `TaskRow`; `ListView`.
- [ ] **Step 2: Write component test — `list-view.test.tsx`.** Mock `@/lib/api`. Given 3 tasks across 2 statuses, assert: grouped rendering shows group headers; toggling a row's checkbox calls `completeTask` with the right id; changing the status filter refetches with the new param. Use `@testing-library/user-event`.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 4: Verify — visual.** Boot against a running `apps/api` (or a seeded temp DB) and confirm grouping/sort/filter update the list and the URL. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): list view with grouping, sorting, filtering`.

---

## Task 5: Task detail drawer — markdown, subtasks, tags, priority, dates, inline timer

**Files:**
- Create: `apps/web/src/components/task-detail.tsx`, `subtask-list.tsx`, `tag-picker.tsx`, `priority-picker.tsx`, `date-picker-field.tsx`, `markdown-editor.tsx`, `inline-timer.tsx`
- Create: `apps/web/src/hooks/use-subtasks.ts`, `use-timer.ts`, `use-tags.ts`
- Create shadcn primitives: `sheet` (drawer), `textarea`, `popover`, `calendar`, `tabs`
- Create: `src/app/tasks/@modal/(.)[id]/page.tsx` (intercepted drawer), `src/app/tasks/[id]/page.tsx` (full-page fallback), update `src/app/tasks/page.tsx` to render `{modal}` slot
- Create: `apps/web/src/components/inline-timer.test.tsx`, `task-detail.test.tsx`

**Interfaces:**
- Consumes: `api.getTask`, `api.updateTask`, `api.listSubtasks`, `api.createSubtask`, `api.setTaskStatus`, `api.completeTask`, `api.listTags`, `api.createTag`, `api.startTimer`, `api.stopTimer`, `api.listTimeEntries`.
- Produces:
  - `TaskDetail` rendered in a right-side `Sheet` via an **intercepting route** (`@modal/(.)[id]`) so opening from the list is a soft-nav overlay, with `/tasks/[id]` as a hard-refresh fallback (same component).
  - Fields: title (inline-editable), markdown description with Edit/Preview `tabs` (`react-markdown` + `remark-gfm` for preview), `SubtaskList` (checklist: add, toggle-complete, shows completed/total), `TagPicker` (multi-select + create-on-type), `PriorityPicker`, due/start `date-picker-field`s, and an **inline timer** wired to REST.
  - `InlineTimer`: shows running elapsed time (ticks client-side from the running entry's `startedAt`), Start/Stop buttons calling `api.startTimer`/`api.stopTimer` and invalidating task + time-entry queries; disabled/handles the single-running-timer rule surfaced by the API.
  - Activity section: a **placeholder** panel ("Activity history — coming in Phase 6") — no `/activity` wiring yet.
  - All edits use optimistic mutations with toast on error.

- [ ] **Step 1:** Add shadcn primitives; build the field components and `TaskDetail`; wire the intercepted + fallback routes and the `@modal` slot.
- [ ] **Step 2: Write component test — `inline-timer.test.tsx`.** Mock `@/lib/api`. Assert: with no running entry, clicking Start calls `startTimer(taskId)`; when given a running entry it renders elapsed time and Stop calls `stopTimer(taskId)`; buttons are keyboard-operable.
- [ ] **Step 3: Write component test — `task-detail.test.tsx`.** Mock API; assert markdown Preview tab renders `**bold**` as `<strong>`, adding a subtask calls `createSubtask`, and selecting a priority calls `updateTask` with `{priority}`.
- [ ] **Step 4: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 5: Verify — visual.** Against running `apps/api`: open a task from the list (drawer slides in, subtle motion), edit description → preview, add a subtask, start then stop the timer and confirm a time entry appears. One-line pass note.
- [ ] **Step 6: Commit** — `feat(web): task detail drawer with markdown, subtasks, tags, dates, inline timer`.

---

## Task 6: Kanban board — drag-drop across status columns (dnd-kit)

**Files:**
- Create: `apps/web/src/components/board-view.tsx`, `board-column.tsx`, `task-card.tsx`
- Create: `apps/web/src/app/board/page.tsx`
- Create: `apps/web/src/components/board-view.test.tsx`

**Interfaces:**
- Consumes: `api.listTasks`, `api.setTaskStatus` (+ `api.updateTask` for intra-column `position`).
- Produces:
  - `BoardView`: one `BoardColumn` per status in the fixed lifecycle order (`backlog → todo → in_progress → blocked → done → cancelled`), populated from a single `useTasks()` query bucketed client-side.
  - dnd-kit (`DndContext` + `SortableContext`): dragging a `TaskCard` to another column fires `setTaskStatus(id, newStatus)` with an **optimistic** move (card appears in the target column immediately; rollback + toast on failure). Reordering within a column updates `position` via `updateTask`.
  - Cards show title, priority dot, tag pills, due chip; columns show counts; keyboard drag enabled via dnd-kit `KeyboardSensor` (accessibility) with an sr-only live-region announcement.
  - Each card/column carries a stable `data-testid` (`task-card-<id>`, `board-column-<status>`) for e2e targeting.

- [ ] **Step 1:** Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` to deps; implement `TaskCard`, `BoardColumn`, `BoardView`; add the route.
- [ ] **Step 2: Write component test — `board-view.test.tsx`.** Mock API. Since jsdom can't do real pointer drag, extract the `onDragEnd` handler (or a pure `moveTask(activeId, overStatus)` helper) and unit-test it: dropping task `t1` onto the `done` column calls `setTaskStatus('t1','done')` and optimistically moves the card. Also assert columns render in lifecycle order with correct counts.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS. (Real drag is covered by Playwright in Task 12.)
- [ ] **Step 4: Verify — visual.** Against running `apps/api`, drag a card between columns and confirm it persists after refresh. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): kanban board with dnd-kit status drag-drop`.

---

## Task 7: Calendar view — tasks by dueAt

**Files:**
- Create: `apps/web/src/components/calendar-view.tsx`, `calendar-day-cell.tsx`
- Create: `apps/web/src/app/calendar/page.tsx`
- Create: `apps/web/src/components/calendar-view.test.tsx`

**Interfaces:**
- Consumes: `api.listTasks` (with a due-range filter: `dueFrom`/`dueTo` mapped to the REST due-range params).
- Produces:
  - `CalendarView`: month grid (via `date-fns`), current month default, prev/next/today controls (also `[`/`]` keyboard). Each day cell lists tasks whose `dueAt` falls that day (compact chips: priority dot + truncated title); overflow shows "+N more". Clicking a chip opens the task detail drawer. Today is subtly highlighted (accent ring, not a fill).
  - Query is scoped to the visible month's range and re-fetches on navigation.

- [ ] **Step 1:** Implement month-grid math helpers, `CalendarDayCell`, `CalendarView`; add route.
- [ ] **Step 2: Write component test — `calendar-view.test.tsx`.** Mock API with tasks on specific dates; pin the clock (fake timers) to a known month. Assert tasks land in the correct day cells, "+N more" appears when a day exceeds the cap, and next/prev refetch with shifted range params.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 4: Verify — visual.** Against running `apps/api`, confirm due tasks appear on the right days and month navigation works. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): calendar view of tasks by due date`.

---

## Task 8: Quick-add bar wired to POST /quick-add (natural language)

**Files:**
- Modify: `apps/web/src/components/quick-add-bar.tsx` (make functional)
- Create: `apps/web/src/hooks/use-quick-add.ts`
- Create: `apps/web/src/components/quick-add-bar.test.tsx`

**Interfaces:**
- Consumes: `api.quickAdd(text)`.
- Produces:
  - `useQuickAdd()` mutation: on submit, calls `api.quickAdd`, invalidates `qk.tasks.*` (list/board/calendar all reflect it), clears the input, and shows a toast with the parsed task title (and a subtle hint of parsed attributes: due/tags/priority).
  - Keyboard: `Enter` submits; global `/` (or `⌘K`-adjacent) focuses the bar; `Esc` clears. Empty submit is a no-op.
  - Optimistic: appended provisionally to the active list, reconciled on response.

- [ ] **Step 1:** Implement `useQuickAdd` and wire `QuickAddBar` (input state, submit, focus shortcut, toast).
- [ ] **Step 2: Write component test — `quick-add-bar.test.tsx`.** Mock API so `quickAdd` resolves `{id:'t9', title:'pay rent', dueAt:…, priority:'p1'}`. Type text + Enter → assert `quickAdd` called with the exact string, input cleared, success toast shown. Assert empty Enter does not call the API.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 4: Verify — visual.** Against running `apps/api`, quick-add `"buy milk tomorrow 5pm #errands p1"`; confirm it appears in the List view with the parsed due/tag/priority. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): natural-language quick-add wired to /quick-add`.

---

## Task 9: Command palette (⌘K) with cmdk

**Files:**
- Create: `apps/web/src/components/command-palette.tsx`, `src/hooks/use-command-palette.ts`
- Create shadcn primitive: `command` (cmdk wrapper)
- Modify: `src/components/app-shell.tsx` (mount palette + global ⌘K listener)
- Create: `apps/web/src/components/command-palette.test.tsx`

**Interfaces:**
- Consumes: `api.listTasks`, `api.listProjects` (for navigate targets); `useTheme`; router; and cross-cutting actions (new task via quick-add focus, set-status on the open task, switch view).
- Produces:
  - `CommandPalette` opened by `⌘K`/`Ctrl+K` (and a top-bar affordance). Groups: **Navigate** (go to task by fuzzy title, go to project, jump to List/Board/Calendar/Search/Analytics), **Actions** (New task, Set status of current task, Toggle theme, Switch view). cmdk provides fuzzy filtering; task/project lists come from cache (with a live search fallback for tasks).
  - Selecting an item runs the action and closes; fully keyboard-operable; `Esc` closes.

- [ ] **Step 1:** Add the shadcn `command` primitive; implement `useCommandPalette` (open state + global hotkey) and `CommandPalette`; mount in the shell.
- [ ] **Step 2: Write component test — `command-palette.test.tsx`.** Mock API + router + `next-themes`. Assert: `⌘K` opens it; typing a task title filters to it and Enter navigates (`router.push('/tasks/<id>')`); the "Toggle theme" action calls `setTheme`; the "Board" navigate item pushes `/board`.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 4: Verify — visual.** Boot `dev`; press `⌘K`, navigate to a view and to a task, toggle theme — all via keyboard only. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): ⌘K command palette (navigate + actions) via cmdk`.

---

## Task 10: Search UI wired to /search

**Files:**
- Create: `apps/web/src/app/search/page.tsx`, `src/components/search-view.tsx`
- Create: `apps/web/src/hooks/use-search.ts`
- Create: `apps/web/src/components/search-view.test.tsx`

**Interfaces:**
- Consumes: `api.search(q)`.
- Produces:
  - `/search` page with a prominent input (`q` synced to the URL `?q=`), debounced `useSearch(q)` query (`qk.search(q)`), results as task rows (reusing `TaskRow`) with the matched term subtly highlighted. Empty query shows a hint; no-results shows a calm empty state. Result rows open the detail drawer.
  - Palette "Search" action and sidebar link route here.

- [ ] **Step 1:** Implement `useSearch` (debounced, `enabled: q.length>0`), `SearchView`, page.
- [ ] **Step 2: Write component test — `search-view.test.tsx`.** Mock API. Type a query → after debounce assert `search` called with the term and result titles render; clearing shows the hint; a query with no results shows the empty state.
- [ ] **Step 3: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 4: Verify — visual.** Against running `apps/api`, search a known term and open a result. One-line pass note.
- [ ] **Step 5: Commit** — `feat(web): search view wired to /search`.

---

## Task 11: Analytics dashboard — time & throughput charts (dataviz skill)

**Files:**
- Create: `apps/web/src/app/analytics/page.tsx`, `src/components/analytics-dashboard.tsx`
- Create: `apps/web/src/components/charts/` (`time-by-day-chart.tsx`, `time-by-project-chart.tsx`, `time-by-tag-chart.tsx`, `estimate-vs-actual-chart.tsx`, `throughput-chart.tsx`, `chart-theme.ts`)
- Create: `apps/web/src/hooks/use-time-report.ts`
- Create: `apps/web/src/components/analytics-dashboard.test.tsx`

**Interfaces:**
- Consumes: `api.getTimeReport({ groupBy: 'day'|'project'|'tag', from, to })`; `api.listTasks` (estimate vs actual, completed-per-day throughput).
- Produces:
  - **Invoke the dataviz skill first** and derive `chart-theme.ts` (categorical palette + sequential ramp validated per the skill, legible in light & dark, `prefers-reduced-motion`-aware) — all charts import this single theme so the dashboard reads as one system.
  - `AnalyticsDashboard`: a date-range control (default last 30 days) + a KPI/stat-tile row (total tracked, tasks completed, avg/day) + charts:
    - Time per **day** (bar/area, `groupBy=day`).
    - Time per **project** and per **tag** (horizontal bars, `groupBy=project|tag`).
    - **Estimate vs actual** (grouped bars per task/project from `estimateMinutes` vs summed actuals).
    - **Throughput** (completed tasks per day line).
  - Charts built with Recharts wrappers; each has an accessible title + a data-table fallback (sr-only) and loading/empty states.

- [ ] **Step 1: Invoke the dataviz skill;** produce `chart-theme.ts` and run its palette validator.
- [ ] **Step 2:** Implement `useTimeReport`, the chart wrappers, and `AnalyticsDashboard` with the range control + stat tiles.
- [ ] **Step 3: Write component test — `analytics-dashboard.test.tsx`.** Mock API returning known report data; assert each chart's accessible title renders, the stat tiles show correct aggregates, and changing the date range refetches with new `from`/`to`. (Assert on ARIA/data-table fallback, not SVG pixels.)
- [ ] **Step 4: Verify.** `test` PASS, `typecheck` PASS.
- [ ] **Step 5: Verify — visual.** Against a seeded `apps/api` with time entries, confirm charts render sensibly in BOTH light and dark. One-line pass note.
- [ ] **Step 6: Commit** — `feat(web): analytics dashboard (time, estimate-vs-actual, throughput)`.

---

## Task 12: Playwright e2e — critical flow (quick-add → list → drag to Done)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fixtures.ts`, `apps/web/e2e/critical-flow.spec.ts`
- Modify: `apps/web/package.json` (`test:e2e` script if not already), `turbo.json` (optional `test:e2e` task, not in the default `test` pipeline)

**Interfaces:**
- Consumes: a REAL `apps/api` instance + the built `apps/web`.
- Produces:
  - `playwright.config.ts` with a `webServer` block that (a) starts `apps/api` bound to a **temp/throwaway SQLite DB** (`JUSTDOIT_DB` env → a `mktemp` file or `:memory:`-backed file) on a test port, and (b) starts `apps/web` (`next start` after build, or `next dev`) with `NEXT_PUBLIC_API_URL` pointed at that api port. Deletes the temp DB in teardown.
  - `critical-flow.spec.ts`: **(1)** open `/tasks`; **(2)** type `"ship the e2e test tomorrow #dev p1"` into the quick-add bar and press Enter; **(3)** assert the task appears as a row in the List view with its parsed title; **(4)** navigate to `/board`; **(5)** drag `task-card-<id>` from its column onto `board-column-done` (Playwright pointer drag; fallback to keyboard-drag via dnd-kit KeyboardSensor if pointer drag is flaky); **(6)** assert the card now lives under the Done column; **(7)** reload and assert it is STILL in Done (persistence proves the REST write). Uses the `data-testid`s from Tasks 4/6.

- [ ] **Step 1:** Write `e2e/fixtures.ts` (temp-DB helper + api-ready wait) and `playwright.config.ts` with the two-server `webServer` setup.
- [ ] **Step 2:** Write `critical-flow.spec.ts` per the steps above. Run `pnpm --filter @justdoit/web exec playwright install --with-deps chromium`.
- [ ] **Step 3: Verify.** `pnpm --filter @justdoit/web test:e2e`. Expected: the critical-flow spec PASSES against a live api+web. If pointer drag is flaky, switch to the keyboard-drag path and re-run until green.
- [ ] **Step 4: Verify — full gates.** From repo root: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Expected: all PASS (e2e stays out of the default `test` pipeline so unit gates remain fast).
- [ ] **Step 5: Commit** — `test(web): Playwright e2e for quick-add → list → board drag-to-Done`.

---

## Phase 5 Definition of Done

- `pnpm --filter @justdoit/web build` succeeds; `dev` serves a themed, dark-by-default UI at `localhost:3000`.
- `apps/web` has **no** dependency on `@justdoit/core` and reaches the backend only through `src/lib/api.ts` (base URL from `NEXT_PUBLIC_API_URL`).
- All views work against a running `apps/api`: List (grouped/sortable/filterable), Kanban (drag-drop status changes persist), Calendar (tasks by dueAt), Task detail drawer (markdown, subtasks, tags, priority, dates, inline start/stop timer), quick-add (NL), ⌘K command palette, search, analytics dashboard.
- Component tests (RTL, API mocked) pass for the api client, sidebar, list, inline timer, task detail, board move-handler, calendar, quick-add, command palette, search, and analytics.
- The Playwright critical-flow e2e passes against a real api+web on a temp DB.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass; the app honors the minimal design system (restrained palette, few borders, fixed type scale, generous spacing, visible focus-visible states, subtle motion, `prefers-reduced-motion`) in both light and dark.
- The frontend-design skill was consulted before building UI; the dataviz skill was consulted before the charts.

## Notes for later phases

- **Phase 6 (Polish)** plugs into deliberately-left seams: the Task-detail **Activity** panel is a placeholder awaiting `/activity`; **saved filters** can persist the List view's URL-encoded filter state via `/saved-filters`; **bulk actions** extend `TaskRow`'s existing checkbox/selection affordance; **attachments** slot into the task detail drawer.
- **SSE live sync (Phase 6, `/events`):** the TanStack Query layer is the integration point — an `EventSource` subscription should invalidate the relevant `qk.*` keys on task/project change events, replacing today's manual invalidation-after-mutation.
- The single shared `QueryClient`, centralized `query-keys.ts`, and the tolerant Zod schemas in `src/lib/schemas.ts` are the extension points; add new endpoints as api-client methods + hooks, never by fetching inline in components.
- A keyboard-shortcut cheatsheet (Phase 6) should enumerate the shortcuts introduced here (⌘K, `/` focus quick-add, `[`/`]` calendar nav, roving list nav, dnd-kit keyboard drag).
- If REST response shapes drift, the tolerant schemas log warnings rather than crash — watch console warnings in dev as an early-warning signal.

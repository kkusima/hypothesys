---
name: hypothesys-architecture
description: Map of the HypotheSys codebase — the monolithic src/App.jsx component/line index, the src/lib/supabase.js data layer, auth, realtime, and how to run/verify the app. Use BEFORE editing App.jsx or supabase.js, when locating a feature or component, or when reasoning about state/realtime/data flow.
---

# HypotheSys architecture

Research project-management app. **React 18 + Vite 5 + Tailwind 3** frontend, **Supabase** (Postgres + Auth + Realtime) backend, deployed on **Vercel** (web), **GitHub Pages** (`docs/`, marketing), and **Electron** (desktop). Almost the entire app is one file.

## Where things live

| Area | File |
| --- | --- |
| Entire UI + all app state | `src/App.jsx` (~9,500 lines, one module) |
| All Supabase queries (`db` object) | `src/lib/supabase.js` |
| Auth (Google OAuth + email) | `src/contexts/AuthContext.jsx` |
| Small shared components | `src/components/{Avatar,Walkthrough,TagPicker}.jsx` |
| DB schema + RLS + triggers | `supabase-schema.sql` (idempotent, single file) |
| Notification emails | `supabase/functions/send-notification-email/index.ts` (Deno, Resend, DB-webhook triggered) |
| Electron shell | `electron/main.cjs`, `electron/preload.cjs` |

`src/App.jsx` makes **zero** direct Supabase calls — everything goes through `db.*` from `src/lib/supabase.js`. Auth is the only place that touches `supabase.auth.*`.

## App.jsx component index

Navigation is **state-driven, not react-router**. Two state vars in `AppContent` drive it: `view` ∈ `main|project|task` and `activeTab` ∈ `projects|tasks|today`.

Approximate starting lines (they drift as the file is edited — grep the `function <Name>` to confirm):

- Module helpers (dates, `isOverdue`, `formatReminderDate`, `getProjectLatestUpdatedAt`, local-storage demo helpers, `restore*InDb`): top ~40–250.
- `ReminderPicker` — custom inline calendar + stepper time picker (no native `datetime-local`); desktop popover with smart flip/clamp positioning, mobile bottom-sheet with sticky footer. `onChange(iso|null, scope?)`; scope only when `isShared`. ~1160.
- `LoginPage`, `GlobalSearch`, `NotificationPane`, `NotificationSettingsPanel`, `ProfileSettingsModal`, `Header`, `TabNav`.
- `TodayItem` (memo), `TodayView`, `DuplicatePopup`.
- `ProjectsView` (kanban/grid/list + sort + reorder), `ReorderModal`, `PriorityBadge`, `ProjectCard`, `ProjectListItem`, `Kanban*` (ScrollContainer, TaskCard, StagePanel, ProjectLane).
- `CreateProjectModal`, `ProjectDetail`, `ProjectSettingsModal`, `ShareModal`, `TaskDetail`, `AllTasksView`.
- `ErrorBoundary` (class) → `AppContent` (the real root, ~1,600 lines: all global state, effects, realtime, provider) → `App` (default export, wraps in ErrorBoundary).

## State model

Single God-component `AppContent` holds all shared state in plain `useState` (no Redux/react-query) and distributes it through one Context object `ctx` via `useApp()`. Server state is cached in arrays with **manual optimistic updates**: build `newProjects` → `setProjects` → `if (demoMode) saveLocal` → `else await db.x()` → reconcile/rollback.

Heavy prop-drilling (`Header` ~13 props, `TodayItem` ~18). If you add a value consumers read via `useApp()`, it must be added to the `ctx` object near the bottom of `AppContent` — otherwise it is `undefined` (this class of bug has bitten `reorderLoading` and `showToast` before).

## Realtime

One subscription in `AppContent`: `db.subscribeToUserProjects(userId, projectIds, handleRealtimeChange)`. Re-subscribes only on `projects.length` 0→non-zero (deliberate). On any change it debounces (2000ms if the change was by the current user, else 500ms), reloads `db.getProjects`, filters out `deletedProjectIdsRef`/`deletedTaskIdsRef` to avoid resurrecting just-deleted rows, then reloads notifications + today items. `tasks`/`subtasks` channels subscribe with no server-side filter (filtered client-side).

## Running & verifying (no test suite exists)

- **Demo mode** (no backend, localStorage) is the fastest way to exercise UI: run vite with an invalid anon key so `src/lib/supabase.js` sets `supabase = null`. See `.claude/launch.json` → `hypothesys-demo` (`VITE_SUPABASE_ANON_KEY=demo-mode-invalid-key`). A yellow **DEMO** badge confirms it.
- Live mode: `npm run dev` (needs real `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env`).
- There is **no lint/test/typecheck** script and no CI on the web app. Verify changes by driving the app in a browser + `npx vite build` (catches syntax/reference errors).
- Editing App.jsx mid-flight produces transient Vite HMR "already declared" errors in the console until all related edits land — re-run `npx vite build` to confirm the final state is clean; a passing build is authoritative over stale HMR console history.

## Conventions & traps

- Dev-only logging via `dlog/dwarn/derr` (App.jsx) and `devLog/devWarn/devErr` (supabase.js), gated on `import.meta.env.DEV`.
- `db.*` methods short-circuit to a success-shaped neutral value when `supabase` is null (demo mode), so callers can't distinguish "no backend" from "succeeded."
- Task/subtask objects do **not** carry a `project_id` field — derive the project from `selectedProject`/context, never `task.project_id`.
- Hooks must be declared before the early `return null` guards in `ProjectDetail`/`TaskDetail` (both were fixed to keep hook order stable — don't reintroduce hooks after the guards).
- Watch for ASI/semicolon bugs: a statement ending a value followed by a line starting with `(` parses as a call. Prefer `for...of` over `.forEach` chains here.

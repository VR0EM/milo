# How Milo is built

A map for anyone (person or Claude) changing Milo. Why things are the way they are is in
`DECISIONS.md`; how it should look and feel is in `PRINCIPLES.md`.

## The three layers

```
 React (src/)                    Tauri commands                 Rust (src-tauri/src/)
 ───────────────                 ──────────────                 ─────────────────────
 features/<screen>/*.tsx  ──►    lib/api.ts  ── invoke ──►      commands.rs (thin)
   use hooks from                one function                     │
   lib/queries.ts                per command                      ▼
                                                                repo.rs and modules
                                                                  │  (all logic)
                                                                  ▼
                                                                SQLite: milo.sqlite
```

- **Rust owns the data.** Only Rust reads and writes SQLite. Backups, reminders, calendar
  syncs and the menu-bar clock run there, also while the window is closed.
- **Every change is a named command** (`create_event`, `set_part_done`, ...). `commands.rs`
  only unpacks arguments, takes the lock and calls into `repo.rs` or a module. A change that
  takes several steps runs in one transaction (the `tx!` macro).
- **React only draws and calls.** Data comes through TanStack Query hooks in
  `lib/queries.ts`, which call `lib/api.ts`. View state and preferences (selected item, zoom,
  theme) live in the zustand store `lib/store.ts`, saved in `localStorage`. Real data is
  never kept there.
- **The browser stand-in.** Outside Tauri, `api.ts` sends every call to
  `lib/mockBackend.ts`, an in-memory imitation of the Rust commands. It makes
  `npm run dev` + `/?demo` work for designing and checking screens. It is never part of the
  app, but it must know every command the screens use.

## Where things are

### Rust (`src-tauri/src/`)

| File | What it does |
| --- | --- |
| `lib.rs` | App start-up: windows, tray, plugins, background jobs, the command list (`generate_handler!`). `data_dir()` honours `MILO_DATA_DIR`. |
| `main.rs` | Starts the app, or the MCP server with `--mcp`. |
| `db/mod.rs` | Opens SQLite (WAL, busy timeout), copies the file before migrating, runs migrations, repairs known gaps. |
| `db/migrations/NNN_*.sql` | Schema changes, applied in order, tracked in `PRAGMA user_version`. Append-only. |
| `models.rs` | Structs sent to and from the UI (`serde(rename_all = "camelCase")`). |
| `repo.rs` | Reads and writes for spaces, groups, activities, events, tasks, parts, routines, settings, archiving. |
| `commands.rs` | The Tauri commands. |
| `archive.rs` | The archive list (paged), restore and delete for good. |
| `backup.rs` | Daily backup with `VACUUM INTO`, optional second folder, restore. |
| `importer.rs`, `ics.rs` | Calendar links and files (ICS), CSV import, title links, sync. |
| `series.rs` | Repeating events made in Milo. |
| `insights.rs`, `csv_export.rs` | Time per day and space, CSV export. |
| `reminders.rs`, `menubar.rs` | Notifications, and the next event in the menu bar / tray. |
| `search.rs`, `suggest.rs` | Search, and space suggestions (optional small local model). |
| `history.rs` | Earlier versions of to-dos (`change_log`). |
| `mcp.rs` | "Connect AI": a JSON-RPC MCP server over stdio for Claude Desktop and similar apps. |
| `error.rs` | `AppError`: messages are shown to her, so they must be plain sentences. |

### Front end (`src/`)

| Path | What it does |
| --- | --- |
| `main.tsx`, `App.tsx` | Start-up and the main layout: sidebar, current screen, dialogs. |
| `lib/api.ts` | One function per Rust command. |
| `lib/types.ts` | TypeScript mirror of `models.rs`, written by hand. |
| `lib/queries.ts` | Query and mutation hooks; which cache keys refresh after a change. |
| `lib/store.ts` | `useUi`: view state, `prefs` (all settings that are not in the database), undo list, notices. |
| `lib/useAppearance.ts` | Applies theme, palette, accent, font, size, Glass and custom CSS as `data-*` attributes on `<html>`. |
| `lib/time.ts` | Date helpers and formatting (12/24 h). Use these, never ad-hoc formatting. |
| `lib/whatsNew.ts` | Release notes shown once after an update. |
| `lib/mockBackend.ts`, `lib/demoData.ts` | Browser stand-in and its sample week. |
| `components/` | Shared pieces: `Icon`, `HelpTip` (the "?"), `DateInput`, `TimeField`, `SidePanel`, `ContextMenu`. |
| `features/calendar/` | Week/day grid (`WeekGrid.tsx`, layout in `layout.ts`), month, event panel, repeats. |
| `features/today/` | Today screen, What now?, routines, mini focus timer. |
| `features/tasks/` | To-dos, task panel, Markdown checklist import. |
| `features/spaces/` | Sidebar, space overview, edit dialogs. |
| `features/insights/`, `settings/`, `import/`, `archive/`, `focus/`, `search/`, `command/`, `setup/`, ... | One folder per screen or dialog. |
| `styles.css` | All styles. Tokens at the top; themes per `data-mode` and `data-palette`. |
| `glass.css` | The Glass material, active only with `data-glass`. |

### Tests

- **Front end**: Vitest, next to the code as `*.test.ts`, for logic that does not need a
  screen (layout maths, time, parsing). Run with `npm test`.
- **Rust**: `#[cfg(test)] mod tests` at the bottom of each module, on
  `db::open_in_memory()`. Run with `cd src-tauri && cargo test`.
- **Layout**: `npm run check:layout` drives every screen of the browser demo at large and
  small window sizes and reports overflow, cut-off controls and broken "?" tips.
- `npm run check` runs types, front-end tests and Rust tests: the same as CI.

## Recipes

Follow these in order; skipping a step is the usual cause of "works in the app but not in
the preview" or the other way round.

### A new field on something that exists (say, `events.colour_override`)

1. **Migration**: add `src-tauri/src/db/migrations/0NN_<name>.sql` with
   `ALTER TABLE ... ADD COLUMN ...` (with a default), and add it to `MIGRATIONS` in
   `db/mod.rs`. Also add it to `REPAIR_COLUMNS` there if older databases could miss it.
2. **Model**: add the field to the struct and its `*Input` in `models.rs`.
3. **Repo**: read it in the row mapper, write it in create/update in `repo.rs`.
4. **Types**: mirror it in `src/lib/types.ts`.
5. **Stand-in**: give it a default in `mockBackend.ts` (and `demoData.ts` if it helps).
6. **UI**: show and edit it; every form that builds the `*Input` must pass it.
7. **MCP**: if an AI app should see or set it, add it in `mcp.rs` (tool schema and handler).
8. **Tests**: a Rust test that it round-trips; a front-end test for any new logic.

### A new command

1. The logic as a function in `repo.rs` (or a module), with a test.
2. A thin `#[tauri::command]` in `commands.rs`; use `tx!` when it writes more than one row.
3. Register it in `generate_handler!` in `lib.rs`.
4. `api.ts`: one function calling it (snake_case command name, camelCase arguments).
5. `mockBackend.ts`: a `case` that imitates it well enough for the preview.
6. `queries.ts`: a hook; in `onSettled`, invalidate every query whose data it can change.

### A new setting

- Display-only or per-device (look, layout, behaviour of the UI): add it to `Prefs` and
  `DEFAULT_PREFS` in `lib/store.ts`; saved preferences are merged with the defaults, so no
  migration is needed. Show it in `features/settings/SettingsView.tsx` with the existing
  `Row` and `Choice` components. Appearance settings are applied in `useAppearance.ts`.
- Needed by Rust (reminders, backups, AI access): store it with `repo::get_setting` /
  `set_setting` (the `settings` table) and add a command.

### A new screen

1. A folder `src/features/<name>/` with `<Name>View.tsx`, using `<main className="page full">`
   and `<div className="page-scroll">` like the other screens.
2. Add the view to `View` in `store.ts`, to the switch in `App.tsx`, and to `NAV` in
   `features/spaces/Sidebar.tsx` (the command menu and the Cmd/Ctrl+number shortcuts follow
   `NAV`). Rarely used screens belong in Settings instead of the sidebar.
3. Check it with `npm run check:layout`.

### A new MCP tool ("Connect AI")

1. Describe it in `tools()` in `mcp.rs` (name, description written for an AI, JSON schema).
2. Handle it in `read` (no changes) or `write` (changes; checked against the access level
   and run in an immediate transaction).
3. Use the same `repo.rs` functions as the UI; never a separate write path.
4. Add a test in `mcp.rs`, and a line in the README's Connect AI section.

## Things that are easy to get wrong

- **Times**: stored as UTC ISO strings with milliseconds (`db::now()`), compared as text.
  A date without a time means the end of that day for deadlines (23:59 local).
- **Archived rows** have `deleted_at`; every list query must filter `deleted_at IS NULL`.
- **Imported events** (`source_id` set) are owned by their calendar link: a sync updates them
  unless `locally_modified` is set. Archiving a link archives its events with it.
- **The Inbox** is a hidden space (`seed-space-inbox`); `useSpaces` leaves it out.
- **The calendar grid** is hand-made: positions come from `layout.ts` (pure, tested) and
  `WeekGrid.tsx`. Keep geometry in `layout.ts` and add a test for every layout rule.
- **Windows**: WebView2 is Chromium; macOS uses WebKit. CSS that only one supports needs an
  `@supports` fallback. Windows-only Rust code goes behind `#[cfg(windows)]`.
- **Two writers**: the MCP server can write while the app runs. The app notices through
  `PRAGMA data_version` (`lib/outsideChanges.ts`) and refreshes.

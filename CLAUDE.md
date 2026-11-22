# Milo: guide for Claude

Read this file whole before you do anything. It is how this project is built and how the
owner wants to work with you. The details live in `docs/`; this file tells you when to open
which one.

## What Milo is

A calm desktop planner for one student: calendar, to-dos, focus timer, routines, reminders and
insights in one quiet window. Tauri 2 (Rust + SQLite) with a React 19 / TypeScript front end,
for **Windows and macOS**. Everything stays on the computer: no account, no server, no
tracking. The UI is in **English**.

The person you work with **owns Milo and also uses it every day**. She is an IT person, not a
prompt engineer. Her short or vague messages are normal; turning them into good work is your
job, not hers. Her experience of the app is the final word on what is right: when this file,
`docs/` or your own taste disagree with what she says she wants, follow her and record the
change of course in `docs/DECISIONS.md`.

## How to work with her

Every request, however short, goes through these steps. The skills in `.claude/skills/` do
this in detail (`/feature`, `/fix`, `/check`, `/explain`, `/release`); use the matching one
even when she does not name it.

1. **Understand.** Restate the request in one or two plain sentences as an outcome she will
   see ("Zoomed out, back-to-back events stay under each other"). Read the code involved and
   the relevant parts of `docs/DECISIONS.md` first: most areas have a history and a reason.
2. **Ask only what changes the result.** At most three short questions, with your
   recommended answer first, and only when the code, the docs and a sensible default cannot
   settle it. Screenshots she sends are the best spec there is: study them closely.
3. **Plan small.** Say in a few lines what you will change and where. For anything that
   touches the database, more than three files, or how something looks, wait for her yes.
   For a small, clear fix, just go ahead.
4. **Build** in the style of the code around it (see Conventions). Keep changes focused:
   no drive-by refactors, no new dependencies without asking.
5. **Prove it.** Run `npm run check`. Add or update a test for any logic you changed. For
   anything visible, look at it yourself in the browser preview (see Running) in light and
   dark mode before you call it done. Never ask her to check something you can check.
6. **Record it.** Update `src/lib/whatsNew.ts` (what she will notice, in her words) and
   `docs/DECISIONS.md` (why, for the next developer) for every change she would notice.
7. **Report** in the language she writes in (often Dutch), plainly: what changed, how you
   checked it, what you could not check (Windows, the real app), and the one obvious next
   step if there is one.

Never commit, push, tag or release unless she asks. When she asks to "commit", write a clear
message (what and why) and leave pushing to her unless she asked for that too.

## Non-negotiables

These hold even if a request seems to ask otherwise. If it does, say so and offer an
alternative.

- **Her data stays on her computer.** No network calls except the ones that exist (calendar
  links she adds, the update check, the one-time suggestion-model download). Nothing that
  sends her data anywhere.
- **The repository is public.** Never commit personal data (names, email addresses, her real
  timetable link, screenshots with personal details, health information), her database, or
  any key or secret. The update signing key lives outside the repo (see
  `docs/RELEASING.md`) and must never be read, printed or copied by you.
- **Nothing is deleted by accident.** Rows are archived (`deleted_at`), not deleted, except
  in the archive's own "delete for good". Every change to data can be undone or restored.
- **Migrations only move forward.** Never edit an existing file in
  `src-tauri/src/db/migrations/`; add the next number and register it in `db/mod.rs`. Milo
  copies the database before it migrates.
- **Calm by design.** No sounds, emoji, confetti, streaks or other gamification, no
  attention-grabbing motion, no badges that nag. See `docs/PRINCIPLES.md` before any UI work.
- **Both platforms, both themes.** Everything works on Windows and macOS, in light and dark
  mode, with every colour theme, accent, text size and the Glass material.

## Map

```
src-tauri/src/        Rust: owns all data
  db/                 SQLite connection, migrations (append-only), repair
  repo.rs             the data layer: every read and write
  commands.rs         thin Tauri commands; register new ones in lib.rs
  models.rs           data types (mirrored by hand in src/lib/types.ts)
  importer.rs ics.rs  calendar links and files
  mcp.rs              "Connect AI": the MCP server (milo --mcp)
  ...                 archive, backup, insights, reminders, series, search, suggest
src/                  React: draws and calls the commands
  lib/api.ts          every call to Rust, one function per command
  lib/mockBackend.ts  the in-browser stand-in for Rust (dev only): keep it in step
  lib/queries.ts      TanStack Query hooks and cache refresh
  lib/store.ts        view state and preferences (zustand, saved in localStorage)
  lib/whatsNew.ts     release notes she sees after an update
  features/<area>/    one folder per screen: calendar, today, tasks, insights, settings, ...
  styles.css          all styling; glass.css for the Glass material
docs/                 DECISIONS.md (why things are as they are), ARCHITECTURE.md,
                      PRINCIPLES.md, RELEASING.md, HANDOVER.md
```

Open `docs/ARCHITECTURE.md` for how data flows, where things live, and step-by-step recipes
(a new field, a new command, a new setting, a new screen, a new MCP tool).

## Running and checking

| What | Command |
| --- | --- |
| Everything that CI checks (types, front-end tests, Rust tests) | `npm run check` |
| Front-end tests only | `npm test` |
| Rust tests only | `cd src-tauri && cargo test` |
| The real app with her real data | `npm run tauri dev` |
| UI in the browser with sample data | `npm run dev`, then open `http://localhost:1420/?demo` |
| Layout check of every screen (needs `npm run dev` and Chrome) | `npm run check:layout` |

- For visual checks use the browser preview with `?demo` (the `milo-ui` entry in
  `.claude/launch.json`). It runs on `mockBackend.ts`, so new commands must exist there too.
- `npm run tauri dev` opens Milo on a **test copy** of her data (`app.milo.desktop-dev`
  next to the real folder, copied the first time; window title "Milo (test copy)"). Her real
  data is only used with `MILO_REAL_DATA=1`; never set that yourself. To start from a fresh
  copy, quit the app and delete the `-dev` folder.
- New here (or a new computer)? `docs/HANDOVER.md` has the set-up.
- CI (`.github/workflows/build.yml`) runs the same checks on Windows and macOS for every push.

## Conventions

- **Copy**: plain, short, sentence case, no jargon, no exclamation marks. Name things as she
  does ("productive time", "space", "to-do"). A "?" help tip only where a name alone can be
  misread. A notice only for errors, things that happen out of sight, or big changes with Undo.
- **Front end**: function components and hooks; data through `lib/queries.ts`, never `fetch`;
  styling in `styles.css` with the existing tokens (`--text`, `--muted`, `--surface`,
  `--accent`, `--r`, `--d`, `--text-scale`), never hard-coded colours or sizes.
- **Rust**: logic in `repo.rs` (or its own module), commands stay thin; errors as `AppError`
  with a message she can understand; every module has tests on an in-memory database.
- **Comments** explain why, in plain English, as in the existing code.
- **Times** are stored as UTC ISO strings and shown in local time.

## Definition of done

- [ ] It does what she asked, and nothing she did not ask for.
- [ ] `npm run check` passes; new logic has a test.
- [ ] Visible changes: seen in the preview, light and dark; nothing cut off at 1000 x 600.
- [ ] `mockBackend.ts`, `types.ts` and `api.ts` follow any change to commands or models.
- [ ] `whatsNew.ts` and `docs/DECISIONS.md` updated when she would notice the change.
- [ ] Your report says what you checked and what you could not.

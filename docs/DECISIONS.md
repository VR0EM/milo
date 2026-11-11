# Milo: decisions

Short notes on each larger choice, newest phase last. Several answers to the open
questions were assumptions made on behalf of the person who will use Milo, so the
ones marked *(assumption)* are kept easy to change.

## Architecture

- **Three layers.** Rust owns the data (`src-tauri/src/repo.rs`), Tauri commands are thin
  wrappers (`commands.rs`), React only draws and calls `src/lib/api.ts`. Every change to
  data is a named command. A later AI layer proposes those same commands and the user
  confirms; nothing in the core has to change for that.
- **SQLite in Rust (`rusqlite`), not from TypeScript.** Backups, reminders and imports must
  work without an open window, and there is exactly one writer.
- **State.** TanStack Query for anything from the database, Zustand for view state
  (selection, zoom, hidden spaces). View state is in `localStorage`; real data never is.
- **Own calendar grid**, no calendar library. Zoom, swipe and drag behaviour are the core
  of the app and are easier to keep predictable in ~300 lines of our own code.
- **Types by hand** in `src/lib/types.ts` (mirrors `models.rs`). Planned as generated
  bindings; postponed because the surface is still small.
- **Browser stand-in** (`src/lib/mockBackend.ts`): `npm run dev` without Tauri runs the UI
  on in-memory data. Development only; the app itself never uses it.

## Data

- **Soft delete everywhere.** Every table has `deleted_at`; the code contains no `DELETE`.
  `set_archived` is the only way anything is hidden, and it is reversible.
- **Times** are stored as UTC ISO strings (`2026-11-11T08:00:00.000Z`), which sort as text.
- **Colours** are palette keys (`green`), not hex values; the stylesheet maps them to muted
  tones for light and dark mode.
- **Insights hooks.** `activities.category` (class / self_study / other) and `spaces.role`
  (normal / sleep) let Insights work without relying on names.
- **Plan vs. log** *(assumption)*: one `events` table. A past event counts as done unless
  it is marked "Did not happen" (`status = 'skipped'`).
- **Activity is optional** on an event (Sleep and Transport have none).
- **Recurring events** *(assumption)*: not modelled; repeating items come from ICS import.
- **Location.** `milo.sqlite` in the app data folder
  (macOS `~/Library/Application Support/app.milo.desktop`, Windows `%APPDATA%\app.milo.desktop`).

## Tasks

- A task belongs to one space and has an optional type (Assignment, Theory, Lab; editable in
  the sidebar), a hard deadline and a personal target moment. A date without a typed time
  means the end of that day.
- **Progress comes from parts.** With parts, progress is the done share and the task is
  complete exactly when every part is done; the data layer keeps `completed_at` in step.
  Without parts, the task has its own checkbox.
- `task_parts.weight` exists (default 1) so parts can count unequally later; the UI does
  not expose it yet.
- The Tasks screen is a list (one row per task: done box, title with part progress, space,
  type, deadline) with a filter bar: search, space, deadline (overdue, next 7 days, later, no
  deadline) and status (open, done, all). Sorting by task, space or deadline. Ticking a task
  with parts finishes its remaining parts; it reopens by unticking a part.
- An overdue deadline is shown in a muted red text, nothing more.
- **Tasks in the calendar.** A row above the hours shows each task on its deadline day
  ("Due", filled) and on its target day ("Aim", dashed outline). The row is always there,
  so the grid does not shift. Clicking a chip opens the task in the right-hand panel;
  an event and a task are never selected at the same time.

## Today, routines and focus

- **Today** shows three blocks in a fixed order: now and next, the active routine, deadlines
  in the next 14 days (overdue ones included). The focus timer is the right-hand panel.
- **Routines** have a time window and weekdays. The routine whose window contains the
  current time is the active one; outside any window Today says so and names the next one.
  An end time earlier than the start runs past midnight and keeps counting for the day it began.
- **Checks are per day.** One row per step per day; a new day starts unchecked without
  anything being reset or removed. Unchecking archives the row.
- **Focus timer.** Pick a length, a space, an activity and optionally a task. The running
  session is a database row, so it survives closing the app. Stopping saves an event
  (`source = 'focus'`) with the real start and end. When the planned time is over the clock
  counts up quietly; nothing rings or pops up (reminders arrive in phase 4).
  "Stop without saving" archives the session instead of logging it.
- A running session shows as one line under the navigation on every screen.
- `focus_sessions` links the event and the task; events themselves do not carry a task id yet.

## Reminders, tray and autostart

- Three kinds of rule: **event** (N minutes before every planned event; focus logs and
  skipped events are left out), **times** (fixed times, e.g. medication) and **interval**
  (every N minutes within a window, e.g. water). All three have weekdays except event.
- Event reminders are on by default (10 minutes). Medication and water are prepared but off.
- A background thread checks every 30 seconds with one small query and sleeps in between.
- **No catch-up.** A reminder only fires within 5 minutes of its moment, so after the laptop
  wakes up old reminders do not all arrive at once.
- `reminder_log` stores every occurrence that was announced (unique per rule and moment),
  so nothing is ever announced twice, also not across restarts.
- Notifications are plain system notifications; no sound is set.
- **Closing the window hides it.** Milo stays in the tray (menu bar on macOS) so reminders
  still arrive; "Quit Milo" in the tray menu stops it. On macOS clicking the Dock icon
  brings the window back.
- "Start Milo when the computer starts" is a switch on the Reminders screen, off by default.

## Import and export

- **Sources.** A calendar link (`ics_url`), an .ics file or a CSV file. Google comes in through
  its secret iCal link or an .ics export, Notion through a CSV export of a database. No
  accounts, no OAuth.
- **Links sync automatically:** 10 seconds after startup, and whenever the last sync is older
  than 6 hours (checked every 10 minutes; no network unless one is due), plus "Sync now".
  Downloading happens without holding the database, so the window stays responsive.
- **Your version wins.** Changing an imported event in Milo sets `locally_modified`; syncs
  then leave it alone. "Follow the calendar again" in the detail panel undoes that.
  An imported event the user archived also stays archived.
- **Nothing is deleted by a sync.** A future event that left the feed, or is marked cancelled,
  is archived with `removed_by_sync`, and comes back if it returns. An empty feed changes
  nothing (more likely a server hiccup than an empty calendar). Past events are never touched.
- **History** *(assumption)*: links import repeating events from 14 days ago; files from up to
  ten years back. Past imported events count as attended, like any past event, so a long
  link history would inflate class time in Insights.
- **Recurrence** uses the `rrule` crate for RRULE; EXDATE, RECURRENCE-ID overrides, TZID
  (IANA, common Windows names), all-day dates and DURATION are handled in `ics.rs`.
- **Title links** (`title_mappings`): "title is" or "title contains", each pointing to a space
  and an activity. Exact links win over "contains". Creating or changing a link moves every
  imported event with that title that the user has not changed. Titles without a link are
  listed on the Import screen, most frequent first.
- **CSV:** the user picks the title and date columns; Notion date formats
  ("November 11, 2026 9:00 AM → 10:00 AM", date ranges, ISO) are read in local time. All
  other columns go into the notes. Rows without a readable date are skipped and counted.
- **All-day events** show in the "All day" row above the hours, next to task chips.
- **Export:** one JSON file with every row of every table, archived rows included, generic
  over the schema so new tables are exported automatically.

## Insights

- **Layout follows a sketch by the end user (2026-11-11):** four numbers (productive time,
  average per day, tasks done, average session) with a plain-words comparison to the previous
  week or month, productive time per day with totals above the bars, time per space for every
  space (sleep, transport and work included), and class versus self-study with sleep.
  "Study time" is called **productive time**: class plus self-study.

- **Computed live** in Rust (`insights.rs`) every time the screen is shown; nothing is cached
  or stored, so Insights can never disagree with the calendar.
- **What counts:** events that are not archived, not marked "Did not happen" and not all-day,
  only up to the current moment. Study time is the activities in the categories `class` and
  `self_study`; everything else is shown once as "other logged time".
- **Days:** time is split at local midnight, so an evening session past midnight counts on
  both days. A night of sleep belongs to the day you wake up.
- **Periods:** week (bars per day), month (per day) and semester (per week). Semesters are
  named date ranges the user adds on the Insights screen.
- **Presentation** follows the dataviz method: one axis in hours, class and self-study stacked
  in two colours validated for colour-blind separation and contrast in light and dark mode
  (`--series-class`, `--series-study`, `--series-sleep`), a legend, hover and keyboard-focus
  tooltips, and a "Show table" view on every chart. No comparisons, streaks or goals.

## Help and colours

- Explanations sit behind small "?" buttons (Settings, Import & export) instead of paragraphs.
- Spaces and the accent can use any colour: a colour picker next to the palette. A custom space
  colour is stored as "#rrggbb"; a custom accent is lightened automatically for dark mode.
- The "+" next to Spaces offers New space and New group.
- Import & export shows only the site of a calendar link (the full link often holds a personal
  key), hides the add form until "Add link", and keeps titles without a link behind "Review".
  "Title contains" links map many imported titles at once (e.g. all hand-in deadlines).

## Archive and shortcuts

- **Archive screen** lists everything that was ever archived, newest first, searchable by name
  and filterable by kind, each with "Restore". Archived events are many over time: the newest
  300 are listed and the rest are found by searching.
- Restoring an imported event that a sync had removed marks it as the user's own, so the next
  sync does not remove it again.
- **Shortcuts** are few and predictable: Cmd/Ctrl+1–7 for the screens (in sidebar order), `?`
  for the overview, `N` for a new event or task, `Esc` to clear. Single-letter keys never fire
  while typing in a field or dialog. The overview is also reachable from the sidebar.
- **App icon**: three muted blocks on a dark square (`src-tauri/app-icon.png`, regenerate the
  sizes with `npx tauri icon src-tauri/app-icon.png`).

## Look and feel

- **Vivid, in the manner of Notion Calendar.** Saturated space colours; events get a clear tint
  of their colour with text in a deep shade of the same colour (light mode) or a pale one
  (dark mode). One accent the user picks (blue, teal, green, violet, coral) marks today, the
  current selection, primary buttons and checkboxes.
- **Text is adjustable** in Settings > Text: typeface (Standard, Rounded, Humanist, Serif, all
  fonts already on the computer, nothing downloaded) and size (Small, Default, Large). Every
  font size scales with `--text-scale`. No all-caps labels; few weight steps.
- **Light, dark or match the computer**, set in Settings. Each theme has its own tones, not an
  automatic inversion; text on accent switches to dark in dark mode for contrast.
- **Sidebar shows only what is used daily:** the screens (with icons and Cmd/Ctrl+number) and
  the spaces, with groups that fold away. Activities, task types and groups are edited in
  Settings > Lists.
- **One icon set** drawn on a 16px grid with a 1.5px stroke (`components/Icon.tsx`); no emoji.
- **Motion** is limited to 150 ms colour changes and a chevron turn, and is off when the system
  asks for reduced motion.
- **Errors stay** until dismissed; other notices fade after 8 seconds.
- **Single-key shortcuts ignore key repeat**, so holding N creates one item, not one per repeat.
- The calendar's empty side panel shows a small month to jump between weeks.
- Calendar settings: show weekends, default length of new events, and the hour the calendar
  opens at.
- Browser preview: `npm run dev` and open `/?demo` for a sample week (never in the app).

## Backups

- One full copy per calendar day in `backups/` next to the database, written with
  `VACUUM INTO` at startup and re-checked hourly. Backups are never rotated away *(assumption)*.

## Calendar behaviour

- Double-click creates a one-hour event; dragging on empty space draws one.
- Drag moves (also across days), the top and bottom edges resize, everything snaps to 15 minutes.
- Drawing and resizing stay within one day so a sideways slip cannot stretch an event
  across days. An overnight event is made by typing an end time earlier than the start.
- Pinch or Ctrl+wheel zooms the time axis; a sideways swipe moves through days.
- Keys: `Delete` archives the selection (with Undo), `Esc` deselects, `T` goes to today,
  arrow keys move a week.
- Times are always shown on a 24-hour clock, independent of system settings.

## Phases

0. Skeleton, migrations, soft delete, daily backup. **Done.**
1. Calendar, events, detail panel, spaces, groups, activities. **Done.**
2. Tasks with parts and progress cards. **Done.**
3. Today screen, routines, focus timer. **Done.**
4. Reminders and tray. **Done.**
5. ICS import with title mappings; full export. **Done.**
6. Insights and semesters. **Done.**
7. Archive screen, shortcuts, polish. **Done.**

## Future AI layer (not built)

The core is ready for it without changes:

1. **Every change is already a named command** (`create_event`, `set_part_done`, ...). An AI never
   gets its own write path; it can only propose a list of these commands.
2. A `proposals` table stores each suggestion: the commands with their arguments, a plain-language
   reason, and a status (`open`, `accepted`, `declined`). Declined proposals are kept, like
   everything else.
3. A suggestions panel shows a proposal as a preview of what would change (for example the
   events it would add, drawn dashed in the calendar). Nothing happens until the user presses
   Accept; Accept runs the commands through the same repository functions the UI uses, in one
   transaction.
4. The AI reads through the same read commands the screens use (`list_events`, `get_insights`,
   `list_tasks`), so it sees exactly what the user sees.
5. The layer is off by default, behind a setting, and is the only part of Milo that would ever
   talk to a model; with it off, no data leaves the machine.

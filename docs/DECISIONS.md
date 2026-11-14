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
- **A row unfolds** (the arrow before its title) to tick off its parts or add one, without
  opening the detail panel. Unfolded rows stay unfolded while Milo is open.
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
- **Small timer on top.** Starting a focus session opens a small always-on-top window, unless
  "Keep a small timer on top of other apps" is off; "Show small timer" brings it back. It is
  compact by default (only the time, 108x40); a click opens the options (what you work on,
  "Open Milo", "Save", 264x76) and a click on the time closes them, growing and shrinking
  towards the left so the right edge stays put. The choice is remembered. A press that moves
  drags the window instead of toggling it. It closes itself when the session ends. The time left also shows next to the tray icon in the macOS menu bar, and
  in the tray tooltip on Windows.
- **A session always leaves an event.** Stopping saves it with its real length. A session still
  running an hour past its plan (forgotten, or the app was closed) is saved by itself with its
  planned length, with a notification, so it never inflates Insights.
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

## Updates

- **Tauri updater from GitHub Releases** (repository is public). A version tag (`npm run
  release -- x.y.z`, then push the tag) runs `.github/workflows/release.yml`, which publishes
  the installers and `latest.json`. Update bundles are signed; the public key is in
  `tauri.conf.json`, the private key in `~/.tauri/milo.key` and the repo secret
  `TAURI_SIGNING_PRIVATE_KEY`. Signed bundles are only made for releases
  (`tauri.release.conf.json`), so ordinary builds need no key.
- **Network:** at most once a day at startup Milo asks GitHub for `latest.json` (Settings >
  Updates > "Check when Milo starts", on by default; off means only "Check now"). Nothing about
  the user is sent.
- **Nothing installs by itself.** A waiting update shows as one line above Settings and in
  Settings > Updates; "Install and restart" downloads, installs (Windows: passive installer)
  and restarts. See docs/RELEASING.md.

## Archive and shortcuts

- **Archive** (in Settings) lists everything that was ever archived, newest first, searchable by name
  and filterable by kind, each with "Restore". Archived events are many over time: the newest
  300 are listed and the rest are found by searching.
- Restoring an imported event that a sync had removed marks it as the user's own, so the next
  sync does not remove it again.
- **Shortcuts** are few and predictable: Cmd/Ctrl+1–5 for the screens (in sidebar order), Cmd/Ctrl+, for Settings, `?`
  for the overview, `N` for a new event or task, `Esc` to clear. Single-letter keys never fire
  while typing in a field or dialog. The overview is also reachable from the sidebar.
- **App icon**: three muted blocks on a dark square (`src-tauri/app-icon.png`, regenerate the
  sizes with `npx tauri icon src-tauri/app-icon.png`).

## Deadlines as tasks, confirmations, focus end, backups (2026-11-11)

- **A calendar link can come in "As tasks"** (Import & export, per link). Each item becomes a
  task whose deadline is the item's start (all-day items: 23:59 that day). Same rules as for
  events: matched by key, your edits win, an open upcoming deadline that leaves the feed is
  archived, title links pick the space. Ticking a task off is never undone by a sync.
  Switching a link between events and tasks archives the items of the old kind (they come
  back if you switch back) and syncs again.
- **Reminders can ask to be checked off** ("Ask me to check it off on Today"). Medication does
  so by default. Today shows "Check off today" with the moments of the day. If not checked off,
  one more reminder comes 30 minutes later, then nothing. Checking off before the moment means
  no reminder at all. Confirmations live in `reminder_log.confirmed_at`.
- **Focus sessions** get one notification when they reach their planned length (Reminders >
  Focus sessions, on by default), also when the window is closed.
- **Backups** can also be copied to a second folder of the user's choice (a USB stick or a
  folder their own sync app handles); missing copies are added daily. **Restoring** a backup
  (Settings > Your data) first saves the current state as `milo-before-restore-…`, then puts the
  backup in place and brings it up to the current schema.

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
  Settings > Lists. Import & export and Archive are rarely used, so they live in Settings too.
- **A space's name opens its overview**: time this week and month (from the calendar, as in
  Insights), open tasks and the next deadline, what is coming in the next 14 days, its open
  tasks (with a New task button for that space) and the last 30 days. The coloured square in
  front of the name still shows or hides the space in the calendar.
- **Settings has five blocks** (Appearance, Calendar & lists, Import & export, Archive,
  Data & app) that fold open and shut (click the row). Which ones are open is remembered;
  "Open all / Close all" sits at the top. "Go to Import & export" opens that block and scrolls
  to it.
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
- **Day, Week and Month views** (toolbar, or D / W / M). The choice is remembered and the
  calendar opens on today in it. The day view steps through every day; week and month follow
  "Show weekends". The month shows all-day events, task deadlines and timed events (on the day
  they start); what does not fit becomes "n more", which opens that day. Double-click in a
  month cell makes an all-day event; the day number opens the day view.
- **All-day events are one bar** over the days they cover, in the week's All day row and in each
  week of the month (overlapping bars go on separate lines). A bar that began before the first
  visible day keeps its title in view.
- **In the month, events can be dragged to another day**; they keep their times and length.
- **Plan time for a task (time-blocking):** beside the calendar, "Plan a task" lists open tasks
  (deadline first, then priority). Dragging one onto the hours makes a block linked to the task
  (`events.task_id`), with the Study activity so it counts as productive. Pointer events, not
  HTML drag and drop, because the Windows webview takes HTML drops for files. The task panel
  shows its coming blocks, the time already spent, and "Plan time".
- **Start focus from a block:** the session fills that block (`focus_sessions.event_id` set at
  the start). When it stops, the block takes the real start and end, so the time is never
  counted twice. A session from elsewhere still adds its own event, now linked to its task.
- **Quick note from anywhere:** Cmd+Shift+Space (Mac) / Ctrl+Shift+Space (Windows) opens a small
  window, also when Milo is hidden in the tray. Enter saves to `inbox_items`; nothing to choose.
  Today has an Inbox: "Make task" (in the last used space, then opens it) or "Done" (with Undo).
  The sidebar shows the count next to Today. If another app holds the key, Milo works without it.
- **"What now?" on Today** suggests one open task for the free time until the next event (the
  day ends at 22:00), with the reason in words. The order is plain rules: overdue first, then the
  nearest deadline, pulled forward by high priority and by an aim of today. A block planned for
  now comes first. "Something else" shows the next one. Hidden while a focus session runs.
- **Repeating events made in Milo** (`event_series`): every day, every (2) week(s) on a day, every
  weekday, every month, or custom (every n days/weeks/months, weekdays), until a date or not.
  Every occurrence is an ordinary event row, so reminders and Insights need nothing new. A series
  without an end keeps 180 days ahead and is topped up by the background thread. A change of the
  repeat applies to this event and later ones; past occurrences are never changed. Replaced
  future occurrences are kept (`replaced`) but not listed in the Archive. Editing one occurrence
  changes only that one; "Copy … to later events" passes its details on. Imported events repeat
  in their own calendar and cannot be given a Milo repeat.
- **Today shows today's all-day events** above Now; a click opens them in the day view.
- The mini month follows the calendar; its arrows only browse until the calendar moves.
- **All-day events** are made by double-clicking the All day row, or with the "All day" box in
  the event panel (From / Until dates; stored from midnight to the midnight after the last day).
  They stay out of reminders and Insights, as imported all-day events already did.
- Very short events (a deadline at 23:59) are drawn at least 22 px high and lifted to stay inside
  their day, so they can always be seen and clicked.
- Drag moves (also across days), the top and bottom edges resize, everything snaps to 15 minutes.
- Drawing and resizing stay within one day so a sideways slip cannot stretch an event
  across days. An overnight event is made by typing an end time earlier than the start.
- Pinch or Ctrl+wheel zooms the time axis.
- **Smooth sideways scrolling, like Notion Calendar.** The grid renders the visible days plus a
  week on each side as one strip, moved with a CSS transform only (no re-render per frame). A
  trackpad swipe or Shift + wheel follows the fingers pixel for pixel, including the system's
  momentum, and settles softly on a whole day 140 ms after the last movement. Each gesture
  keeps one direction (hours or days), so diagonal swipes do not wobble. Week buttons, T and
  arrow keys slide too; with "reduce motion" on in the system everything jumps instead.
- Keys: `Delete` archives the selection (with Undo), `Esc` deselects, `T` goes to today,
  arrow keys move a week.
- Times are always shown on a 24-hour clock, independent of system settings.

## Phases

0. Skeleton, migrations, soft delete, daily backup. **Done.**
1. Calendar, events, detail panel, spaces, groups, activities. **Done.**
2. Tasks with parts and progress cards. **Done.**
3. Today screen, routines, focus timer. **Done.**
4. Reminders and tray. **Done.** Later: confirmations and focus-end notifications.
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

## Backend hardening (after 0.3.3)

- **A copy before every database update.** When a new version has migrations to run, `db::open`
  first writes `backups/milo-before-vN-<date-time>.sqlite` (VACUUM INTO). It is listed and
  restorable in Settings like the daily backups ("…, before an update"); the backup list is now
  sorted by file time. A copy that cannot be made is logged and does not block starting.
  A test updates a real schema-8 database with data in it and checks nothing is lost.
- **Database commands run off the main thread** (`#[tauri::command(async)]`), so the window
  never waits on the database. Window commands stay on the main thread.
- **Every change is one transaction** (`tx!` in commands.rs): all of it is saved or none of it,
  also for changes with many steps (a repeat that writes 180 events, stopping focus, parts).
  "Make task" from the Inbox is one command (`inbox_to_task`). `synchronous=NORMAL` with WAL:
  safe against corruption, and no disk flush per change.
- **The focus clock checks the database every 30 seconds when no session runs**, and every
  second while one does. Starting a session wakes it at once.
- **Earlier versions of events and tasks** (`change_log`, history.rs). Before an edit changes an
  item, its state is kept as JSON; edits within two minutes count as one version, and saving
  without a change keeps none. The panel shows "Earlier versions" with what differed and
  Restore; a restore keeps the state before it too, so it can be undone. Dragging or resizing an
  event shows "Event moved · Undo". Sync updates of imported events are not versions.

## Fuller and more personal (after 0.3.3)

- **An icon per space** (`spaces.icon`, migration 011), drawn in the app's own icon style and
  shown in the space colour: sidebar, space overview, Today, the task list beside the calendar.
  The seeds get one (Personal: home, Sleep: moon, Transport: bus). No icon keeps the square.
- **Spaces can be dragged up or down in the sidebar** (within their list) to set the order.
  An empty group shows "Add a space" instead of nothing.
- **Appearance choices** in Settings: event colour strength (soft / normal / strong, a factor
  on the theme's own fill), clock (24-hour or am/pm, for display; typing accepts both), the
  first day of the week (Monday or Sunday), the screen Milo opens on, and which screens are in
  the sidebar (Today always is; hidden screens keep their keyboard shortcut order).
- **Today is built from blocks** in an order chosen in Settings > Today, each shown only when it
  has something to say: Your day (all-day items and every event with its time, a "now" line,
  time left for what runs), What now?, Inbox, checks, Routine, Deadlines, and from 17:00 End of
  the day (productive time and tasks done today, and what tomorrow starts with; no score).
  The title greets by the time of day. While Milo is still empty, one "Let Milo fill up" card
  replaces the many "nothing" lines.
- **An empty Insights period** explains how Insights fills up, with a way to start, instead of
  a page of zeros.
- **A welcome guide** opens by itself on the first start of an empty Milo (no tasks, no calendar
  links, only the seeded spaces); a Milo already in use never sees it by surprise. Steps: look
  (theme, accent, text size, event colours), courses (one per line, each a space with its own
  colour and a book icon in the School group; names already there or repeated are skipped),
  timetable link, deadlines link (as tasks), rhythm (wake-up and bed time set the morning and
  evening routines and where the calendar opens; medication and water reminders), ready.
  Every step can be skipped; it can be opened again from Settings › Data & app and from the
  "Let Milo fill up" card on Today. Running it again only adds.


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

## Fixes after the first full test in the real app (debug build, real database)

- **Schema repair after migrating** (`db::repair`): a development build had once marked the
  developer's database as version 9 after a different, since removed, migration 9, so the real
  009 was skipped (no Inbox, no repeats). After the migrations Milo now checks the tables and
  columns every database must have and adds only what is missing. A test reproduces the case.
- **Guide:** each step has its own footer buttons. With one shared button, WebKit turned the
  Continue of "Make it yours" into the courses form's submit button during the same click and
  skipped the courses step (Chrome did not). The main button gets the focus when the guide
  opens. Both link steps list every linked calendar with how it imports (as events / as tasks).
- **One numbering for all spaces:** dragging spaces in one list of the sidebar swaps them among
  the places they held and renumbers all spaces, so lists never tie. New things go to a clear
  default (`pickDefaultSpace`: the one asked for or used last, else Personal, else the first
  space outside a group), not to "the first space".
- **Changing a repeat** removes the future occurrences of the old repeat that nobody touched;
  edited ones (or with versions or a focus session) are still set aside, as before.
- **A new screen starts without the previous selection**, so a task picked in Tasks no longer
  takes the place of the mini month in the calendar.
- **The week on screen follows a new first day of the week** at once (and at start).
- Small: naming a new item keeps no "earlier version"; time spent under a minute is not shown;
  am/pm times never wrap; Done in the Inbox is not red; empty date fields say "No date"
  (the page is `lang="en-GB"`); earlier versions name all days of a multi-day event; the
  shortcuts overview opens at its top and long dialogs scroll inside the window.


## Milo's own date field

The browser's date field follows the computer's language, not the page: on a Mac set to US
English it showed 11/19/2026, which a European reader takes for the 11th of month 19 or simply
misreads. `components/DateInput` replaces it everywhere (deadlines, aims, event dates, all-day
From/Until, repeat end, semesters):

- It always reads **"Thu 19 Nov 2026"**: written out, with the weekday, so day and month can
  never be swapped and the day of the week is clear without opening a calendar.
- **Typing** is day first and lenient (`parseDate`): "19/11", "19-11-26", "19.11.2026",
  "19 nov", "nov 19", "today", "tomorrow", "fri" (the next Friday). Without a year it is this
  year, or next year when that day is more than half a year ago. Anything it cannot read puts
  the old date back, like the time field.
- **Picking** happens in a small month behind the calendar button (also Alt+Down). It follows
  the first day of the week from Settings, marks today and the chosen day, greys out days
  before an earliest day (Until, repeat end), and closes with Esc, a click elsewhere or a scroll.
  It is drawn on top of the page (or the open dialog), so a side panel never cuts it off.

## What's new after an update

An update that changes things without saying so is unsettling, so every version tells what it
brings, once:

- The notes live in `src/lib/whatsNew.ts`, newest first, in plain words for her. The release
  script refuses a version without notes, and a test checks that the version in package.json
  has them.
- After an update, a card at the top of Today lists what is new since the version she last
  read (at most two versions; "See all changes" for more). It stays until **Got it**, so it is
  never gone before it was read. A new install shows nothing: the welcome guide covers that.
- Settings › Data & app › Version › **What's new** lists every version.
- `prefs.lastSeenVersion` remembers what was read. Saved settings from before this existed
  count as 0.3.4. The version comes from package.json at build time (`__APP_VERSION__`).

## Tests for the screens' logic

`npm test` runs Vitest on the logic the screens rely on: reading typed dates and times, the
clock and week preferences, summer-time-safe day counting, the default space, the layout of
all-day bars, and the "What's new" notes. The tests run in the Europe/Brussels time zone so the
change to winter time is really exercised. GitHub runs them on every build and release, next to
`cargo test`.

## Ideas taken from Notion Calendar

Looked at Notion Calendar for what would help her; left out what does not fit Milo (meeting
links, conferencing, time zones, sounds).

- **Next event by the tray icon** (`src-tauri/src/menubar.rs`): "Chemistry lab in 25 min", or
  "Shift · 40 min left" while it runs. It shows from three hours before, and hands over to the
  next event a quarter of an hour before that one starts, to help with the switch. Sleep,
  all-day, skipped events and focus sessions are left out; a running focus session shows its
  own time there instead. Long titles are cut at a word. On Windows the text is in the tooltip.
  It is checked every 30 seconds, so a change in the calendar shows within half a minute.
  Settings › Calendar & lists turns it off (`settings.menubar_next`).
- **Cmd+K command menu** (`features/command/CommandMenu.tsx`): screens, calendar views, new
  event, new task, a note, help; each with its own shortcut beside it, so shortcuts are learned
  by using the menu. Typing a date ("19 nov", "fri") offers the calendar on that day; typing a
  word finds spaces, tasks and events (a month back to four months ahead). In the calendar, G
  opens it to go to a date.
- **3-day view**: three consecutive days from the day shown (today after T), also when weekends
  are hidden in the week; the arrows move by three days. Key 3.
- **Next up** beside the calendar while nothing is selected: the event running or the next one,
  by the same rule as the menu bar (`lib/nextUp.ts`), with a countdown only within three hours.
- Found while testing: N in the calendar could type its "n" into the new event's title.

## Nothing scrolls sideways, at any window size

The "?" explanation sat inside its panel; next to a right edge it stuck out and the whole panel
scrolled sideways. It now floats above the page (like the date picker) and moves left or up to
stay inside the window. The side panel never scrolls sideways at all.

`npm run check:layout` checks this for every screen, the event and task panels, all Settings
blocks and every step of the welcome guide, at 1440 x 900, the smallest window (1000 x 600) and
the smallest with large text. It reports sideways scrolling, buttons or fields cut off, short
labels breaking over two lines, and each "?" that does not open, sticks out, or stays after Esc.
Its first run also found: the calendar's buttons (Today, arrows) falling off the toolbar in a
small window (the toolbar now wraps), "3 days" breaking over two lines, the task table scrolling
sideways with a task open (the progress column now goes first), and "High" cut off in the
priority picker with large text.

## The selected event stays open while the calendar moves

The panel used to look for the selected event among the days on screen only, so moving to
another week (arrows, swiping, the mini month) put the mini month back, and editing an event
that was not on screen failed with "Not found". The selected event is now also loaded by itself
(`event_by_id`, `useEventById`), as a list of one inside the same "events" cache: quick updates,
archiving and refreshing reach it like any other list. Esc still closes it.

## A "?" only where something can confuse

Every setting with its own "?" was clutter again. The rule now: a "?" only when the name alone
can be misread, or when knowing it takes a worry away. Kept: hiding screens from the sidebar,
Today's blocks, hiding weekends, the archive, running the guide again, activities (how time
counts), the next event in the menu bar, the update check (nothing is sent), the second backup
folder, restoring a backup, repeating events, the inbox, planning a task, calendar links,
importing a file, title links, and the timetable and rhythm steps of the guide. Self-evident
ones (theme, colours, typeface, text size, clock, first day of the week, start screen, lengths,
version, folders, export, shortcuts) have none.

## New logo

Three columns of coloured blocks on a dark tile, like a planned week (`src-tauri/icons/app-icon.svg`).
The app icons are made from it with `npx tauri icon`; the macOS `.icns` comes from
`app-icon-macos.svg`, the same mark with the usual margin of macOS icons, so it is not larger
than the icons around it in the Dock. The sidebar, the welcome guide and the browser tab use the
same mark.

## First feedback round from the real user (0.3.6)

- **The small focus timer on Windows** was a white block: a window made inside a synchronous
  Tauri command never gets its WebView2 content on Windows. `show_focus_mini` and `open_capture`
  are async now; `app_info` runs off the main thread, and Settings shows the version built into
  the app, so it can never be "…".
- **Scrolling** areas fill the screen to its right edge (the content keeps its reading width on
  the left, through `--content` padding), so the wheel works next to the content too.
- **Zooming out** stops when 00–24 fills the height exactly (`fit` in WeekGrid), minus the room
  kept under 24:00.
- **Rounded** is left out on Windows, which has no rounded system font.
- **Day with 1–14 days** replaces the separate 3-day view (`dayCount`; saved 0.3.5 state with
  "three" becomes Day with 3). D is one day, 2–9 that many days.
- **Month picker** under the month name (calendar title and small month): a year first stays
  open, a month goes there.
- **Time lists** under every time field (quarter hours); the end field lists from the start on,
  with the length. Typing still works.
- **Side panel width** is dragged at its edge, shared by all panels and remembered (260–560 px).
- **Copy, cut, paste** of events with Ctrl/Cmd+C/X/V. Paste goes to the last empty spot clicked
  after copying (a day in the month view keeps the event's own time), else to the same time.
  Cut archives with Undo.
- **Several days**: pulling the top or bottom edge of an event may cross days; drawing a new one
  still stays in one day so a slip of the hand cannot stretch it.
- **Spaces and groups**: one drag finds its place across all lists (`move_space`), and groups
  are dragged by their header (`reorder_groups`). Right-click a space to make it the default
  for new things (`prefs.defaultSpaceId`, before "the one used last"), shown as "default".
- **Settings**: Today's blocks are dragged by a grip (arrow keys still work on it); the list of
  groups left Settings (the sidebar does that now).
- **Archive**: "Delete…" per item asks in its own row; "Empty the archive…" asks too. A space
  or group still in use, and imported events (a sync would add them again), stay. An optional
  clean-up after 30 days, 3 months or a year runs right after the daily backup.
- **Insights** got Year (weekly bars, a label every fourth week); focus lengths are 15/30/45/60.

## One kind of to-do, three kinds of spaces, one Today (0.3.7)

The second feedback round asked for a task list with filters, sub-items, a list per course and
a daily list. Milo had tasks, inbox notes and routine items as three separate things. Now:

- **Everything to do is a to-do** (the `tasks` table). A quick note is a to-do in the hidden
  Inbox space (`seed-space-inbox`, kind `inbox`); migration 012 moved open notes there and
  marked the old rows handled. The Inbox is left out of `useSpaces`, the sidebar and every
  space choice except a to-do's own Space field (`useAllSpaces` includes it, for names).
- **A space has a kind**: `project` (a course: parts, types, progress), `list` (to-dos with
  steps) or `none` (time only: sleep, travel, shifts). Existing spaces in a group became
  projects, Sleep and Transport became time only, the rest lists. The kind only changes how
  the space page looks and where to-dos can go; nothing is lost by changing it.
- **Parts of a course** are `sections`. A to-do's section must be in its own space; moving the
  to-do to another space takes it out (`section_in`). Archiving a part keeps its to-dos.
  The old "parts" of a task are called **steps** in the interface (the table is still
  `task_parts`), so "part" means one thing.
- **Today** is a to-do's `today_on` date plus whatever is due today. Picking is explicit
  ("+ From my to-dos"); nothing lands on Today by itself except a deadline. Left-over picks
  from earlier days are asked about, kept or dropped, as chosen in Settings › Today
  (`yesterdayMode`). Writing something on Today's card puts it in the Inbox *and* on Today.
- **Routines stay routines** (their own tables, ticks per day). They are listed under Tasks ›
  Lists and edited in the same dialog as before; while one runs, What now? shows its steps
  instead of a suggestion ("Show a to-do instead" switches back). Steps can have one level of
  sub-steps (`routine_items.parent_id`). The Routine and Inbox blocks left Today.
- **Task types per course**: `task_types.space_id` (null = all courses), set in Settings.
- What now? suggests from Today's open to-dos first, and from all open ones only when nothing
  was picked.

## Space suggestions without a language model (0.3.8)

Notes in the Inbox get up to three "Move to" choices; nothing moves until she clicks. The
problem is described in `docs/lokale-assistent-probleem.md`; four outside opinions and two
measurement rounds led here.

- **No generative model.** A 1.7B model was slow and made the laptop warm, and still placed 30%
  of new notes in the wrong space: where a note belongs is knowledge about her, not language.
- **Two scorers, in Rust** (`src-tauri/src/suggest.rs`), next to SQLite, the same on macOS and
  Windows:
  - *Words*: naive Bayes over words and 3–5 letter pieces of her own titles (to-dos, events,
    space names, parts of courses), older titles counting less (half after 70 days). Always on.
    On its own it is too unsure to suggest anything as certain.
  - *Model2Vec* (`potion-multilingual-128M`, int8, MIT): a fixed table of vectors per piece of a
    word, downloaded once (~83 MB) from a pinned version, checked by size and SHA-256. A note's
    vector is the mean of its pieces; the space comes from the 9 nearest titles she filed.
    0.06 ms per note, no runtime besides the `tokenizers` crate.
- **Measured** on 190 test notes played in order (predict, reveal, learn), starting from only the
  space names: with Model2Vec 62–65% filled in by itself, 2–3% of those wrong, and for the rest
  the right space among the three choices 96% of the time. Words only: 6% wrong and 11% missed,
  hence never "sure". e5-small (~120 MB) scored the same; EmbeddingGemma 2 (~206 MB, 18 ms, needs
  ONNX Runtime) about halved the errors and is the upgrade path if her real use shows too many
  misses. A shipped word list helped little once its test words were removed. The timetable as a
  signal could not be measured on these notes and is not used yet.
- **"Sure"** = p ≥ 0.8 and 0.4 ahead of the next, only with the model. Even then the first choice
  is only highlighted; she still clicks.
- **Learning** needs no separate store: a moved note is a to-do with a title and a space, so the
  next suggestion includes it. The index is rebuilt when any task, event, space or part changes.
- The browser preview mirrors the words scorer with `src/lib/systemOne.ts`.

Later the same week:

- **"Sure" needs two of her own titles.** Her test data showed one look-alike ("Studeren python",
  once put in Personal by default) making "Write python" a sure Personal. Requiring two close
  titles of the winner that she filed herself (not imported) cut sure-but-wrong from 3% to 1% on
  the test notes; the right space within one click stayed at 95%. Imported items count 0.3.
  At most 3 nearest titles per space count, so a big space does not win by size alone.
- **Quick notes are read** (`src/lib/quickNote.ts`): the day and time become the deadline, a list
  after a colon becomes steps. A note with a set time and no deadline word offers "Put in the
  calendar" (to the suggested space only when sure, else the default space).
- **Parts and types** are suggested within a course with the same scorer (`suggest_in_space`).
- **Repeated notes**: the same numbers, and every word of the shorter title in the longer one
  (or, with the model, cosine ≥ 0.83). Strict, because a false "already there" is worse than a
  missed one: "hoofdstuk 4" and "hoofdstuk 5" score 0.87 in the model but are not the same.
- **Imported titles** without a link get the same one-click choices; for events every space
  but the Inbox can be chosen (Work, Sleep), for to-dos only courses and lists.

## Location (0.3.8)

Feedback: the room of a class was nowhere to be seen. The import did read LOCATION, but put it
as a first line "Location: …" in the notes, which only show when an event is opened.

- `events.location` and `event_series.location` (migration 013). Existing events whose notes
  start with "Location: " get that line moved into the field; the rest of the notes stays.
- The ICS import fills the field; a changed room comes along with the next sync, and a room she
  typed herself is kept (as with every field she changes). Imported to-dos have no place of their
  own, so for them the room stays the first line of the notes.
- Shown where it helps to find the way: on the event block (when there is room), in Your day,
  under Next up, beside the date in the event panel, and in the menu bar before the event starts
  ("Lab in 25 min · ELL.01.01"); not while it runs, as she is there then.
- Tried on a real school timetable (186 lessons, kept out of the repository): every lesson got its
  room, no notes kept a "Location:" line, and a second sync changed nothing.

## Search (0.3.9)

Asked for: finding earlier events. Cmd+K only looked at event titles from 30 days back to four
months ahead, five at most.

- `search.rs` looks at every event and to-do that is not archived, of any date: title, notes,
  location, space, activity, and a to-do's steps. Capitals and accents do not matter; every word
  typed must be found. Plain substring matching in Rust: a few thousand rows take milliseconds,
  so no index or model is needed.
- Repeats of one event (same title, same space) are one result with the count, the last and the
  next time, so a weekly class is one line instead of thirteen.
- Words in the title rank first; then coming before past, nearest first. To-dos: open before
  done, nearest deadline first.
- Cmd+K shows Coming, Earlier and To-dos (five each) and "Show all results"; Cmd/Ctrl+F opens the
  search page with filters (all / events / to-dos, any time / coming / earlier, space).

## An app, not a web page (0.3.9)

Feedback: right-click showed the browser's menu with "Reload". `src/lib/appFeel.ts`, loaded in
every window, takes away what gives the web page away:

- The browser's right-click menu (Reload, Inspect), except in text fields, where cut, copy and
  paste stay. Milo's own menus (spaces, parts) are unchanged. In development, Alt+right-click
  still opens the browser menu and Cmd/Ctrl+R still reloads.
- Browser keys: reload (F5, Cmd/Ctrl+R), print, save, view source, open, find next (F3), caret
  browsing (F7), and Alt+Left/Right and the mouse's side buttons for "back" and "forward".
- Dragging a ghost image of a button or icon, the middle-click scroll circle on Windows, and the
  whole window bouncing past its edge.
- Buttons keep the hand (tried the arrow, as in most desktop apps; she prefers the hand).
- **Scrollbars** show only while something scrolls (as on a phone or a Mac trackpad). They are not
  needed to scroll (wheel, trackpad, keys), but while scrolling they show where on the page one
  is. The bar keeps its place, so nothing shifts when it appears; it can still be grabbed.

## Her feedback list, finished (0.4.0)

The rest of the first feedback file (docs kept outside the repository):

- **Focus is a tab** (between Tasks and Insights), no longer a panel on Today. She picks to-dos
  (Today's first, others by search) and ticks them off during the session
  (`focus_session_tasks`, migration 014). On stop, the time is split: start to the first tick
  for that to-do, from there to the next, and the rest to the first one still open; pieces under
  a minute join the next one. Each piece is an event named after its to-do and linked to it, so
  the to-do shows its time spent. Without to-dos the event is named after the space, never
  "Focus". The space follows the first to-do picked (unless it is in the Inbox).
- **Routines can follow a space** (`routines.space_id`): shown in What now? and in the event
  panel while an event of that space runs or starts within 30 minutes; ticks belong to the
  event's day. Routines without a space keep their set times.
- **Event panel order** as she asked: start and end, date, all day, then space, activity,
  reminder, location, description, checklist.
- **Reminders per event** (`events.reminders`): null = the general rule from Reminders, "" =
  none, or minutes before ("0,30"). Repeats copy them. Focus events get none.
- **End of the day**: to-dos done and productive time, how many things are planned tomorrow and
  the first, and what is due tomorrow.
- **Import**: after adding a calendar link, the titles without a link open at once in a scroll
  box, most frequent first, with one-click space choices; the rest stays in the link's space.
- **Space colours**: her own palette (a preference), drag to reorder, × to remove (spaces that
  use a colour keep it), + to add.
- Still to ask her: how the cut-off sentence about Deadlines on Today ended.

## Undo, checklist import, comparison, CSV (0.4.1)

- **Ctrl+Z** replays the undo of the latest notice that had one (`undoStack` in the UI store,
  the last 20, this session only). It does nothing while typing in a field, where the field's
  own undo applies, and says "Nothing to undo" when the list is empty. No redo: every undo is
  itself a normal change.
- **Markdown import** is parsed in the frontend (`markdownImport.ts`) so the preview and the
  import are the same thing; Rust only writes (`import_todos`, one transaction). Headings are
  parts in a course and ignored in a list; a part with the same name is reused. Deeper levels
  than steps are flattened into steps, because Milo has three levels. Wikilinks, links and
  emphasis are stripped. `read_text_file` only reads .md, .markdown and .txt up to 2 MB.
- **Comparison** is with the period just before (previous week, month, year), shown as a quiet
  delta in text, never colour alone and never red/green (it is not a score). Semesters are not
  compared: they differ in length and content.
- **CSV** is written for Excel in Belgium: semicolons, decimal comma, CRLF and a BOM. The
  totals use the same `insights_for` as the screen, so the file and Insights agree. Events are
  local time; all-day events have no minutes.

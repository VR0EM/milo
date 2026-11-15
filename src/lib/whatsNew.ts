/**
 * What changed in each version, newest first, in plain words for the person using Milo.
 * The release script refuses a version that has no entry here, so every update can tell
 * what it brings.
 */
export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.3.7",
    date: "2026-11-16",
    items: [
      "Tasks opens on an overview: Today, Upcoming, the Inbox and what is past its deadline, then your courses and lists.",
      "Each space is now a Project (a course, with parts, types and progress), a List (to-dos with steps) or Time only (sleep, travel, shifts). Change it with Edit on the space.",
      "A course page shows its progress, a count per type, and its parts. Add a part with New part; right-click a part to rename, move or archive it.",
      "Today has a list of its own: press + From my to-dos to choose what you want to do today. What is due today is on it by itself.",
      "To-dos you picked yesterday and did not finish: Milo asks each morning, or keeps them, or lets them go (Settings › Today).",
      "Notes you write down are now to-dos in the Inbox. Give them a space when you are ready; Tasks shows how many wait.",
      "While a routine runs, What now? shows its steps to tick off. A step can have steps of its own.",
      "Task types can be for one course or for all (Settings › Calendar & lists).",
      "The parts of a task are now called steps.",
      "Pull the bottom of an event above its start (or the top below its end) and the event turns over: the start becomes the end.",
      "A focus session stopped within a minute leaves nothing in the calendar. Very short events no longer hide the events right after them.",
    ],
  },
  {
    version: "0.3.6",
    date: "2026-11-15",
    items: [
      "The small focus timer works on Windows again (it was a white block in the corner).",
      "Day can show 1 to 14 days side by side: open the menu next to Day, or press 2 to 9 in the calendar.",
      "Click the month name, above the calendar or in the small month, to jump to any month and year.",
      "Times can be picked from a list; for the end it shows how long that makes it.",
      "Copy, cut and paste events with Ctrl+C, X and V (Cmd on a Mac). Click a spot first to paste it there.",
      "Pull the top or bottom of an event into another day for an event of several days.",
      "Drag the left edge of the panel on the right to make it wider or narrower.",
      "Drag a space into or out of a group, and drag groups to put them in order.",
      "Right-click a space to use it for new events and tasks.",
      "Zoomed out all the way, the calendar shows the whole day from 00 to 24.",
      "Scroll anywhere next to the content; the scrollbar sits at the right edge of the window.",
      "Focus lengths are now 15, 30, 45 and 60 minutes, or your own. Insights also shows a whole year.",
      "Reorder Today's blocks by dragging them in Settings.",
      "The archive can delete things for good, by hand or by itself after a time you choose.",
      "A new logo, and fewer question marks: only where something can be unclear.",
    ],
  },
  {
    version: "0.3.5",
    date: "2026-11-15",
    items: [
      "Dates are written out, like Thu 19 Nov 2026, so day and month can never be mixed up.",
      "Type a date day first (19/11, 19 nov, tomorrow, fri), or pick one from the small calendar next to the field.",
      "After an update, Milo tells you once what changed, here on Today. Every change is listed in Settings, under Data & app.",
      "Your next event shows next to Milo's icon in the menu bar, with how long until it starts (\"Lab in 25 min\") or how long is left. It can be turned off in Settings, under Calendar & lists.",
      "Press Cmd+K (Ctrl+K on Windows) to go anywhere, find a task, event or space, or type a date to open the calendar there.",
      "A 3-day view in the calendar: press 3, or pick it next to Day, Week and Month.",
      "Beside the calendar, \"Next up\" shows what comes next. One click shows it.",
      "Right-click a space or group in the sidebar for a menu: open, edit, hide in the calendar, a new space or group, or archive.",
    ],
  },
  {
    version: "0.3.4",
    date: "2026-11-15",
    items: [
      "Click a space in the sidebar for an overview of its tasks, events and time.",
      "Drag a task onto the calendar to set time aside for it. Starting focus from that block fills it in.",
      "Write something down from any app with Cmd+Shift+Space (Ctrl+Shift+Space on Windows). It waits in the Inbox on Today.",
      "\"What now?\" on Today suggests one next thing.",
      "Events can repeat: every week, every weekday or your own pattern, until a date you choose.",
      "Earlier versions of tasks and events can be brought back.",
      "Icons for spaces, and more choices under Appearance: am/pm clock, week from Sunday, the start screen and the screens in the sidebar.",
      "A short welcome guide on the first start. It can be opened again from Settings.",
    ],
  },
  {
    version: "0.3.3",
    date: "2026-11-14",
    items: ["The calendar has day, week and month views. Events of several days are one bar."],
  },
  {
    version: "0.3.2",
    date: "2026-11-12",
    items: ["All-day events, and events late in the evening are easier to click."],
  },
  {
    version: "0.3.1",
    date: "2026-11-12",
    items: ["Import & export and Archive moved into Settings, which folds into five blocks."],
  },
];

/** -1, 0 or 1, comparing "0.3.10" and "0.3.9" as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The releases after `seen`, up to and including `current`, newest first. */
export function unseenReleases(seen: string, current: string, releases = RELEASES): Release[] {
  return releases.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}

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

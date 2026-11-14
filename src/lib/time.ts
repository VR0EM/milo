export const MINUTE = 60_000;
export const SNAP_MINUTES = 15;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar-day arithmetic, safe across daylight saving changes. */
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

// Two display choices from Settings, set once per render of the app (see App.tsx).
let weekStartsOn: 0 | 1 = 1;
let hour12 = false;
export function setClockPrefs(prefs: { weekStart: 0 | 1; timeFormat: "24h" | "12h" }) {
  weekStartsOn = prefs.weekStart;
  hour12 = prefs.timeFormat === "12h";
}
export const weekStart = () => weekStartsOn;

/** The first day of the week (Monday, or Sunday when chosen in Settings). */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 7 - weekStartsOn) % 7));

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const minutesIntoDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export const atMinutes = (day: Date, minutes: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

export const snapMinutes = (m: number, step = SNAP_MINUTES) => Math.round(m / step) * step;

const pad = (n: number) => String(n).padStart(2, "0");

/** Always 24-hour "09:30": for fields and comparisons, never shown as a choice. */
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** "14:30", or "2:30 pm" when Settings says 12-hour. */
export const fmtHm = (hhmm: string) => {
  if (!hour12) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"}`;
};
/** A time as shown everywhere: "09:30" or "9:30 am". */
export const fmtTime = (d: Date) => fmtHm(toTimeInput(d));
/** A whole hour for the calendar's side: "09:00" or "9 am". */
export const fmtHour = (h: number) => (hour12 ? `${h % 12 || 12} ${h < 12 ? "am" : "pm"}` : `${pad(h)}:00`);
/** "09:00 – 10:30", or "9:00 – 10:30 am" (the am/pm once when both are the same). */
export const fmtRange = (a: Date, b: Date) => {
  if (hour12 && a.getHours() < 12 === b.getHours() < 12) return `${fmtTime(a).replace(/ [ap]m$/, "")} – ${fmtTime(b)}`;
  return `${fmtTime(a)} – ${fmtTime(b)}`;
};

export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromInputs(date: string, time: string): Date | null {
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lenient time input: "9", "930", "9:30", "09.30", "9h30", and with am/pm "2pm", "2:30 pm".
 * Returns HH:MM (24-hour) or null.
 */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2})[:.h ]?(\d{2})?\s*(a|am|p|pm)?$/.exec(text.trim().toLowerCase().replace(/\./g, ":").replace(/:(?=\s*[ap])/, ""));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].startsWith("p") ? 12 : 0);
  }
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

export function fmtDuration(ms: number) {
  const total = Math.round(ms / MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const fmtMonth = (d: Date) => monthFmt.format(d);
export const fmtWeekday = (d: Date) => weekdayFmt.format(d);
export const fmtLongDay = (d: Date) => longDayFmt.format(d);

const shortDayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
/** "Fri 20 Nov, 17:00". The time is left out when it is the end of the day. */
export function fmtMoment(d: Date) {
  const day = shortDayFmt.format(d);
  return d.getHours() === 23 && d.getMinutes() === 59 ? day : `${day}, ${fmtTime(d)}`;
}

/** Whole calendar days from today: 0 today, 1 tomorrow, -1 yesterday. */
export const daysFromToday = (d: Date) =>
  Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);

export function fmtRelativeDays(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** mm:ss, or h:mm:ss from one hour up. */
export function fmtClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** ISO 8601 week number (weeks start on Monday). */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

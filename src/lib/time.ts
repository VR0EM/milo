export const MINUTE = 60_000;
export const SNAP_MINUTES = 15;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar-day arithmetic, safe across daylight saving changes. */
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** Monday as the first day of the week. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const minutesIntoDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export const atMinutes = (day: Date, minutes: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

export const snapMinutes = (m: number, step = SNAP_MINUTES) => Math.round(m / step) * step;

const pad = (n: number) => String(n).padStart(2, "0");

/** 24-hour clock, e.g. 09:30. */
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtRange = (a: Date, b: Date) => `${fmtTime(a)} – ${fmtTime(b)}`;

export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromInputs(date: string, time: string): Date | null {
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lenient 24-hour input: "9", "930", "9:30", "09.30", "9h30" all work. Returns HH:MM or null. */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2})[:.h ]?(\d{2})?$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
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

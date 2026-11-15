/**
 * Reads what can be read for certain from a quick note, in Dutch, English or both:
 * the day, the time, the space and listed steps. A small language model is good at wording
 * (a title, what kind of thing it is) but unreliable at dates and times; this part is plain
 * rules, so it is always right when it finds something, and says nothing when it is unsure.
 * Whatever it finds is given to the model as fact and overrides its answer.
 */

export interface SpaceWords {
  /** The space as Milo names it. */
  name: string;
  /** Words that point to it, lower case: the course name, a translation, a short form. */
  words: string[];
}

export interface NoteHints {
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM, 24 hours; for a range the start. */
  time: string | null;
  space: string | null;
  /** Only for a list after a colon ("verslag: inleiding, code, conclusie"). */
  parts: string[] | null;
  /** "task" when the note says it is something to hand in or finish by a moment. */
  kind: "task" | "event" | null;
  /** The note without the words for the day and time, for a title. */
  rest: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Monday = 1 … Sunday = 7, as getDay() but with Sunday last.
const WEEKDAYS: [RegExp, number][] = [
  [/^(maandag|monday)$/, 1], [/^(dinsdag|tuesday)$/, 2], [/^(woensdag|wednesday)$/, 3], [/^(donderdag|thursday)$/, 4],
  [/^(vrijdag|friday)$/, 5], [/^(zaterdag|saturday)$/, 6], [/^(zondag|sunday)$/, 7],
];
// Short forms are only trusted next to a time or a date, or after "by"/"tegen"…:
// "do" and "sat" are also ordinary words.
const SHORT_DAYS: Record<string, number> = {
  ma: 1, di: 2, wo: 3, do: 4, vr: 5, vrij: 5, za: 6, zat: 6, zo: 7,
  mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7,
};
const MONTHS: [RegExp, number][] = [
  [/^jan(uari|uary)?$/, 1], [/^feb(ruari|ruary)?$/, 2], [/^(mrt|maart|mar|march)$/, 3], [/^apr(il)?$/, 4],
  [/^(mei|may)$/, 5], [/^(jun|juni|june)$/, 6], [/^(jul|juli|july)$/, 7], [/^aug(ustus|ust)?$/, 8],
  [/^sep(t|tember)?$/, 9], [/^(okt|oct|oktober|october)$/, 10], [/^nov(ember)?$/, 11], [/^dec(ember)?$/, 12],
];
const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1] ?? null;
const BEFORE = new Set(["by", "before", "on", "until", "due", "next", "this", "tegen", "voor", "op", "vanaf", "tot"]);

/** A day and month without a year: this year, or next year when it is more than a month ago. */
function dayMonth(day: number, month: number, year: number | null, today: Date): string | null {
  let y = year ?? today.getFullYear();
  if (year !== null && year < 100) y += 2000;
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  if (year === null && d < addDays(today, -31)) d = new Date(y + 1, month - 1, day);
  return iso(d);
}

/** The first given weekday after today (a note never means today by a weekday's name). */
const nextWeekday = (today: Date, wd: number) => {
  const now = ((today.getDay() + 6) % 7) + 1;
  return addDays(today, ((wd - now + 7) % 7) || 7);
};
/** That weekday in the week after this one (weeks start on Monday). */
const inNextWeek = (today: Date, wd: number) => {
  const now = ((today.getDay() + 6) % 7) + 1;
  return addDays(today, 7 - now + wd);
};

interface Found<T> { value: T; from: number; to: number }

function findDate(t: string, today: Date): Found<string> | null {
  // 1. A written date: 23/11, 4-12, 27/11/2026, 3 december, 27 nov, december 3.
  // Not a numbered range like "2.1-2.5" (exercises) or "1.2 - 1.4".
  let m = /(?<![\d.]\s*-\s*)\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b(?!\s*-\s*\d)/.exec(t) ??/(?<![\d.])(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?(?![\d.]|\s*u|\s*(am|pm))/.exec(t);
  if (m && Number(m[2]) <= 12 && Number(m[1]) >= 1) {
    // "4-6" in "hoofdstuk 4-6" is not a date: only trust a dash between day and month next to date words.
    const dashed = m[0].includes("-");
    const near = t.slice(Math.max(0, m.index - 12), m.index);
    if (!dashed || /(tegen|voor|op|deadline|due|by|before|on)\s*$/.test(near)) {
      const v = dayMonth(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, today);
      if (v) return { value: v, from: m.index, to: m.index + m[0].length };
    }
  }
  const words = [...t.matchAll(/[a-zà-ÿ]+|\d+/g)];
  for (let i = 0; i < words.length; i++) {
    const w = words[i][0];
    const month = monthOf(w);
    if (month) {
      const prev = words[i - 1]?.[0];
      const next = words[i + 1]?.[0];
      const year = words[i + 2]?.[0];
      const withYear = () => (year && /^\d{4}$/.test(year) ? Number(year) : null);
      if (prev && /^\d{1,2}$/.test(prev)) {
        const v = dayMonth(Number(prev), month, withYear(), today);
        if (v) return { value: v, from: words[i - 1].index!, to: words[i].index! + w.length };
      }
      if (next && /^\d{1,2}$/.test(next) && w.length >= 3) {
        const v = dayMonth(Number(next), month, withYear(), today);
        if (v) return { value: v, from: words[i].index!, to: words[i + 1].index! + next.length };
      }
    }
  }
  // 2. Words for days near today.
  const rel: [RegExp, number][] = [
    [/\b(overmorgen|day after tomorrow)\b/, 2], [/\b(morgen|tomorrow)\b/, 1], [/\b(vandaag|today|tonight|vanavond|vanmiddag|this evening)\b/, 0],
  ];
  for (const [re, n] of rel) {
    const r = re.exec(t);
    if (r) return { value: iso(addDays(today, n)), from: r.index, to: r.index + r[0].length };
  }
  // 3. A weekday, with or without "next week" before it.
  for (let i = 0; i < words.length; i++) {
    const raw = words[i][0];
    const w = raw.replace(/(avond|middag|ochtend|morgen|nacht)$/, "");
    let wd = WEEKDAYS.find(([re]) => re.test(w))?.[1] ?? null;
    if (wd === null && SHORT_DAYS[raw]) {
      const prev = words[i - 1]?.[0] ?? "";
      const after = t.slice(words[i].index! + raw.length, words[i].index! + raw.length + 8);
      if (BEFORE.has(prev) || /^\s*\d/.test(after) || i === words.length - 1) wd = SHORT_DAYS[raw];
    }
    if (wd === null) continue;
    const before = t.slice(Math.max(0, words[i].index! - 16), words[i].index!);
    const nextWeek = /(volgende week|next week)\s*$/.exec(before);
    const value = iso(nextWeek ? inNextWeek(today, wd) : nextWeekday(today, wd));
    const from = nextWeek ? words[i].index! - nextWeek[0].length - (before.length - before.trimEnd().length) : words[i].index!;
    return { value, from: Math.max(0, from), to: words[i].index! + raw.length };
  }
  return null;
}

/** Hours without am/pm from 1 to 7 are read as afternoon: nobody plans 3 at night. */
const guessPm = (h: number) => (h >= 1 && h <= 7 ? h + 12 : h);
const hm = (h: number, m: number) => (h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null);
const ampm = (h: number, s: string | undefined) => (s === "pm" && h < 12 ? h + 12 : s === "am" && h === 12 ? 0 : h);

function findTime(t: string): Found<string> | null {
  let m = /\b(middernacht|midnight)\b/.exec(t);
  if (m) return { value: "23:59", from: m.index, to: m.index + m[0].length };
  // A range: "van 17 tot 21u", "18-22u", "17u-21u", "5-9pm", "13u-17u". Only with "u", ":" or am/pm in it,
  // so "hoofdstuk 4-6" and "oefeningen 1-10" stay out.
  m = /(?:\bvan\s+)?\b(\d{1,2})(?:[:.u](\d{2}))?\s*(u|am|pm)?\s*(?:-|–|tot|to|till)\s*(\d{1,2})(?:[:.u](\d{2}))?\s*(u|am|pm)\b/.exec(t);
  if (m && (m[3] || m[6] || m[2])) {
    const suffix = m[3] === "u" ? undefined : (m[3] ?? (m[6] === "u" ? undefined : m[6]));
    const v = hm(ampm(Number(m[1]), suffix), Number(m[2] ?? 0));
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  // "half 3" = 2:30 (Dutch), read as afternoon.
  m = /\bhalf\s+(\d{1,2})\b/.exec(t);
  if (m) {
    const v = hm(guessPm(Number(m[1]) - 1 || 12), 30);
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  // "23u", "14u30", "8u40".
  m = /(?<![\w/.])(\d{1,2})u(\d{2})?\b/.exec(t);
  if (m) {
    const v = hm(Number(m[1]), Number(m[2] ?? 0));
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  // "2:30pm", "9:30", "23:59", "4:15 pm".
  m = /(?<![\d/.])(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/.exec(t);
  if (m) {
    const v = hm(ampm(Number(m[1]), m[3]), Number(m[2]));
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  // "11pm", "9am", "6 pm".
  m = /\b(\d{1,2})\s*(am|pm)\b/.exec(t);
  if (m) {
    const v = hm(ampm(Number(m[1]), m[2]), 0);
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  // "om 10", "at 10", "@ 3".
  m = /(?:\bom|\bat|@)\s+(\d{1,2})(?![\d/.:-])/.exec(t);
  if (m) {
    const v = hm(guessPm(Number(m[1])), 0);
    if (v) return { value: v, from: m.index, to: m.index + m[0].length };
  }
  return null;
}

/** "verslag: inleiding, code uitleggen, conclusie, tegen 27/11" → the three steps. */
function findParts(note: string): string[] | null {
  const colon = note.indexOf(":");
  if (colon < 0 || /\d:\d/.test(note.slice(colon - 1, colon + 2))) return null;
  const list = note
    .slice(colon + 1)
    .split(/,|\s+(?:en|and|&)\s+/i)
    .map((s) => s.trim())
    // A last item that is only the deadline is not a step.
    .filter((s) => s && !/^(tegen|voor|due|by|before|deadline)\b/i.test(s));
  return list.length >= 2 ? list : null;
}

const TASK_WORDS = /\b(inleveren|indienen|afgeven|deadline|due|submit|hand in|tegen|by|before|afwerken|af tegen)\b/;

export function noteHints(note: string, today: Date, spaces: SpaceWords[]): NoteHints {
  const t = note.toLowerCase().replace(/[’']/g, "'");
  const date = findDate(t, today);
  const time = findTime(t);
  const words = new Set(t.match(/[a-zà-ÿ0-9]+/g) ?? []);
  const space = spaces.find((s) => s.words.some((w) => (w.includes(" ") ? t.includes(w) : words.has(w))))?.name ?? null;
  const parts = findParts(note);
  // Only the clear cases; the model decides the rest.
  const kind = TASK_WORDS.test(t) ? "task" : time && !parts ? "event" : null;
  let rest = note;
  for (const f of [date, time].filter(Boolean).sort((a, b) => b!.from - a!.from)) {
    rest = rest.slice(0, f!.from) + rest.slice(f!.to);
  }
  rest = rest.replace(/\s+(om|at|op|on|tegen|voor|by|before|due|deadline)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
  return { date: date?.value ?? null, time: time?.value ?? null, space, parts, kind, rest };
}

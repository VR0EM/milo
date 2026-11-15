import { useEffect, useMemo, useState } from "react";
import { colorVar } from "../../lib/colors";
import { fmtUntil, pickNext } from "../../lib/nextUp";
import { useEvents, useSpaces } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, daysFromToday, fmtRange, fmtRelativeDays, fmtTime, startOfDay } from "../../lib/time";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * Beside the calendar while nothing is selected: the event running now or the next one, with
 * how long until it starts (or how long is left). One click shows it in the calendar.
 */
export function NextUp() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  // The coming week; the range moves with the date, not with every half minute.
  const today = startOfDay(now).getTime();
  const [from, to] = useMemo(() => [new Date(today), addDays(new Date(today), 8)], [today]);
  const events = useEvents(from, to).data ?? [];
  const spaces = useSpaces().data ?? [];
  const next = pickNext(events, spaces, now);
  if (!next) return null;

  const start = new Date(next.startAt);
  const end = new Date(next.endAt);
  const running = start <= now;
  // A countdown only when it helps: while it runs, or within three hours (as in the menu bar).
  const soon = running || start.getTime() - now.getTime() <= 3 * 3_600_000;
  const n = daysFromToday(start);
  const day = running ? "Now" : n <= 1 ? fmtRelativeDays(n).replace(/^./, (c) => c.toUpperCase()) : dayFmt.format(start);
  const color = colorVar(spaces.find((s) => s.id === next.spaceId)?.color ?? "gray");
  const show = () => {
    const ui = useUi.getState();
    ui.showDate(start);
    ui.select(next.id);
  };

  return (
    <section className="next-up" aria-label="Next up">
      <h2 className="next-up-head">{running ? "Now" : "Next up"}</h2>
      <button className="next-up-item" style={{ ["--c" as string]: color }} onClick={show} title="Show in the calendar">
        <span className="next-up-bar" />
        <span className="next-up-text">
          <span className="next-up-title">{next.title || "Untitled"}</span>
          <span className="next-up-when">
            {running ? `until ${fmtTime(end)}` : `${day} · ${fmtRange(start, end)}`}
          </span>
        </span>
        {soon && <span className="next-up-until">{fmtUntil(next, now)}</span>}
      </button>
    </section>
  );
}

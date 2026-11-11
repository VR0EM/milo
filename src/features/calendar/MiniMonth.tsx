import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useUi } from "../../lib/store";
import { addDays, fmtMonth, sameDay, startOfWeek } from "../../lib/time";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A small month to jump through weeks. The week on screen is marked. */
export function MiniMonth() {
  const viewStart = useUi((s) => s.viewStart);
  const [month, setMonth] = useState(() => {
    const mid = addDays(viewStart, 3);
    return new Date(mid.getFullYear(), mid.getMonth(), 1);
  });
  const today = new Date();
  const first = startOfWeek(month);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const weekends = useUi((s) => s.prefs.showWeekends);
  const shown = (d: Date) => d >= viewStart && d < addDays(viewStart, 7) && (weekends || (d.getDay() !== 0 && d.getDay() !== 6));
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="mini-month">
      <div className="mini-head">
        <span className="mini-title">{fmtMonth(month)}</span>
        <button className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" size={14} /></button>
        <button className="icon-btn" aria-label="Next month" onClick={() => step(1)}><Icon name="right" size={14} /></button>
      </div>
      <div className="mini-grid" role="grid" aria-label={fmtMonth(month)}>
        {WEEKDAYS.map((d) => <span key={d} className="mini-wd">{d}</span>)}
        {weeks.flat().map((d, i) => (
          <button
            key={d.getTime()}
            className={[
              "mini-day",
              d.getMonth() !== month.getMonth() ? "outside" : "",
              shown(d) ? "in-view" : "",
              // Round the marked band where it starts and ends on each row.
              shown(d) && (i % 7 === 0 || !shown(addDays(d, -1))) ? "band-start" : "",
              shown(d) && (i % 7 === 6 || !shown(addDays(d, 1))) ? "band-end" : "",
              sameDay(d, today) ? "today" : "",
            ].join(" ")}
            aria-label={d.toDateString()}
            onClick={() => useUi.getState().setViewStart(startOfWeek(d))}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { MonthPicker } from "../../components/MonthPicker";
import { rangeEnd, useUi } from "../../lib/store";
import { addDays, fmtMonth, sameDay, startOfWeek, weekStart } from "../../lib/time";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** A small month to jump through the calendar. The days on screen are marked. */
export function MiniMonth() {
  const viewStart = useUi((s) => s.viewStart);
  const mode = useUi((s) => s.calMode);
  const dayCount = useUi((s) => s.dayCount);
  // The month that holds what the calendar shows. It follows the calendar; the arrows here
  // only browse until the calendar moves again.
  const mid = mode === "week" ? addDays(viewStart, 3) : viewStart;
  const shownMonth = new Date(mid.getFullYear(), mid.getMonth(), 1).getTime();
  const [month, setMonth] = useState(() => new Date(shownMonth));
  const [picking, setPicking] = useState(false);
  useEffect(() => setMonth(new Date(shownMonth)), [shownMonth]);
  const today = new Date();
  const first = startOfWeek(month);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const weekends = useUi((s) => s.prefs.showWeekends);
  // In the month view the whole month is on screen, so nothing needs marking.
  const shown = (d: Date) =>
    mode !== "month" && d >= viewStart && d < rangeEnd(mode, viewStart, dayCount) && (mode === "day" || weekends || (d.getDay() !== 0 && d.getDay() !== 6));
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="mini-month">
      {/* The month in the middle, an arrow on each side; the name opens a month and year list. */}
      <div className="mini-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" size={14} /></button>
        <button className="month-title mini-title" aria-haspopup="dialog" aria-expanded={picking} title="Pick a month" onClick={() => setPicking(!picking)}>
          {fmtMonth(month)}
        </button>
        <button className="icon-btn" aria-label="Next month" onClick={() => step(1)}><Icon name="right" size={14} /></button>
        {picking && (
          <MonthPicker
            value={month}
            onPick={(d) => {
              setMonth(d);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
      <div className="mini-grid" role="grid" aria-label={fmtMonth(month)}>
        {Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStart() + i) % 7]).map((d) => <span key={d} className="mini-wd">{d}</span>)}
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
            onClick={() => useUi.getState().showDate(d)}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

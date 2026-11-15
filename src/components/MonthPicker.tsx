import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Pick a month and a year in two scrolling lists, for jumping far without clicking an arrow many
 * times. Opens under the month name that was clicked; closes with Esc or a click elsewhere.
 */
export function MonthPicker({ value, onPick, onClose }: { value: Date; onPick: (d: Date) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const month = value.getMonth();
  // A year is chosen first and stays open; choosing the month goes there.
  const [year, setYear] = useState(value.getFullYear());
  const years = Array.from({ length: 21 }, (_, i) => value.getFullYear() - 10 + i);

  // The chosen month and year in the middle of their lists.
  useLayoutEffect(() => {
    // Only the lists scroll (scrollIntoView would also move the panel around them).
    ref.current?.querySelectorAll<HTMLElement>("[aria-selected=true]").forEach((el) => {
      const col = el.parentElement!;
      col.scrollTop = el.offsetTop - col.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2;
    });
  }, []);

  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".month-title") && onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  return (
    <div className="month-picker" ref={ref} role="dialog" aria-label="Pick a month">
      <div className="mp-col" role="listbox" aria-label="Month">
        {MONTHS.map((m, i) => (
          <button key={m} role="option" aria-selected={i === month && year === value.getFullYear()} className={i === month && year === value.getFullYear() ? "on" : ""} onClick={() => onPick(new Date(year, i, 1))}>
            {m}
          </button>
        ))}
      </div>
      <div className="mp-col" role="listbox" aria-label="Year">
        {years.map((y) => (
          <button key={y} role="option" aria-selected={y === year} className={y === year ? "on" : ""} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

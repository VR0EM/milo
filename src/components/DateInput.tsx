import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { addDays, fmtDateField, fmtMonth, fromDateInput, parseDate, sameDay, startOfWeek, toDateInput, weekStart } from "../lib/time";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const POP_WIDTH = 248;

interface Props {
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  onChange: (value: string) => void;
  /** The earliest day that can be picked (YYYY-MM-DD). */
  min?: string;
  /** Shown while empty. Without it the field cannot be emptied: a cleared field goes back. */
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * A date field that always reads "Thu 19 Nov 2026", whatever the computer's language. The
 * browser's own date field follows the system and showed 11/19/2026 on a Mac, which is easy to
 * misread. Type a date (day first: "19/11", "19 nov", "tomorrow", "fri") or pick one from the
 * small month behind the calendar button.
 */
export function DateInput({ value, onChange, min, placeholder, ...rest }: Props) {
  const show = (v: string) => (v ? fmtDateField(fromDateInput(v)) : "");
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const allowed = (v: string) => !min || v >= min;
  const pick = (v: string) => {
    if (v !== value) onChange(v);
    setText(show(v));
  };

  const commit = () => {
    if (!text.trim()) {
      if (placeholder !== undefined) pick("");
      else setText(show(value));
      return;
    }
    const parsed = parseDate(text);
    if (parsed && allowed(parsed)) pick(parsed);
    else setText(show(value));
  };

  return (
    <span className={`date-input${value ? "" : " empty"}`} ref={wrapRef}>
      <input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        aria-label={rest["aria-label"]}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      <button
        type="button"
        className="date-btn"
        aria-label="Pick a day"
        aria-expanded={open}
        title="Pick a day"
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon name="calendar" size={14} />
      </button>
      {open && (
        <DatePopover
          anchor={wrapRef.current}
          value={value}
          min={min}
          onPick={(v) => {
            pick(v);
            setOpen(false);
            inputRef.current?.focus();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/** A small month under the field. It sits on top of everything, so a panel never cuts it off. */
function DatePopover({
  anchor,
  value,
  min,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  value: string;
  min?: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const start = value ? fromDateInput(value) : new Date();
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 280;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - POP_WIDTH - 8);
    // Below the field, or above it when there is no room below.
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // A scroll or a new window size would leave the month floating in the wrong place.
    const away = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = new Date();
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  // Into the open dialog when there is one (a dialog sits above the page), else onto the page.
  return createPortal(
    <div
      ref={popRef}
      className="date-pop mini-month"
      role="dialog"
      aria-label="Pick a day"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: POP_WIDTH }}
      // Keep the click inside the field's label from moving focus to the text field.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
    >
      <div className="mini-head">
        <span className="mini-title">{fmtMonth(month)}</span>
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" size={14} /></button>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => step(1)}><Icon name="right" size={14} /></button>
      </div>
      <div className="mini-grid">
        {Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStart() + i) % 7]).map((d) => <span key={d} className="mini-wd">{d}</span>)}
        {days.map((d) => {
          const v = toDateInput(d);
          return (
            <button
              type="button"
              key={v}
              disabled={!!min && v < min}
              className={[
                "mini-day",
                d.getMonth() !== month.getMonth() ? "outside" : "",
                sameDay(d, today) ? "is-today" : "",
                v === value ? "picked" : "",
              ].join(" ")}
              aria-label={fmtDateField(d)}
              aria-pressed={v === value}
              onClick={() => onPick(v)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="date-pop-foot">
        <button type="button" className="link" disabled={!!min && toDateInput(today) < min} onClick={() => onPick(toDateInput(today))}>Today</button>
      </div>
    </div>,
    anchor?.closest("dialog") ?? document.body,
  );
}

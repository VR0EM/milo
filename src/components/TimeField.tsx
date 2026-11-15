import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtHm, parseTime } from "../lib/time";

const STEP = 15;
const pad = (n: number) => String(n).padStart(2, "0");
const toHm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** "45 min", "1 h", "2 h 30". */
const span = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)}` : `${min / 60} h`);

/**
 * A time field that shows the clock chosen in Settings (24-hour or am/pm) and reads either.
 * The native time input follows the system locale, which could disagree with Milo.
 * Clicking it also opens a list of times every quarter hour to pick from; for an end time
 * (`from` given) the list starts after the start and shows how long that makes it.
 * `value` and what `onCommit` gets are always 24-hour "HH:MM".
 */
export function TimeField({ value, onCommit, from }: { value: string; onCommit: (hhmm: string) => void; from?: string }) {
  const [text, setText] = useState(fmtHm(value));
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setText(fmtHm(value)), [value]);

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed && parsed !== value) onCommit(parsed);
    else setText(fmtHm(value));
  };

  // The quarter hours of the day; for an end time the ones after the start, up to a day long.
  const startMin = from ? minutesOf(from) : null;
  const options =
    startMin === null
      ? Array.from({ length: (24 * 60) / STEP }, (_, i) => ({ min: i * STEP, note: "" }))
      : Array.from({ length: (24 * 60) / STEP }, (_, i) => ({ min: (startMin + (i + 1) * STEP) % (24 * 60), note: span((i + 1) * STEP) }));

  return (
    <>
      <input
        ref={inputRef}
        inputMode="numeric"
        placeholder="hh:mm"
        value={text}
        aria-haspopup="listbox"
        aria-expanded={open}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <TimeList
          anchor={inputRef.current}
          options={options}
          current={value}
          onPick={(min) => {
            const hm = toHm(min);
            setText(fmtHm(hm));
            setOpen(false);
            if (hm !== value) onCommit(hm);
            inputRef.current?.blur();
          }}
        />
      )}
    </>
  );
}

function TimeList({ anchor, options, current, onPick }: { anchor: HTMLElement | null; options: { min: number; note: string }[]; current: string; onPick: (min: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const cur = minutesOf(current);
  // The time now chosen, or the first one after it, is in view.
  const near = options.findIndex((o) => o.min >= cur);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const width = Math.max(r.width, 150);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    setPos({ left, top, width });
    const row = ref.current.querySelector<HTMLElement>(`[data-i="${Math.max(0, near)}"]`);
    if (row) ref.current.scrollTop = row.offsetTop - ref.current.clientHeight / 2 + row.offsetHeight / 2;
  }, [anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling the page around it would leave the list behind: it closes (the field keeps its text).
  useEffect(() => {
    // Only a scroll of something around the field counts (the calendar sliding next to it does not).
    const away = (e: Event) => {
      const t = e.target;
      if (anchor && t instanceof Node && t !== ref.current && t.contains(anchor)) anchor.blur();
    };
    window.addEventListener("scroll", away, true);
    const resize = () => anchor?.blur();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      className="time-list"
      role="listbox"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width }}
      // Keep the field focused while choosing, so a click here is not a blur first.
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.map((o, i) => (
        <button
          key={o.min + "-" + i}
          type="button"
          role="option"
          data-i={i}
          aria-selected={o.min === cur}
          className={o.min === cur ? "on" : ""}
          onClick={() => onPick(o.min)}
        >
          <span>{fmtHm(toHm(o.min))}</span>
          {o.note && <span className="time-note">{o.note}</span>}
        </button>
      ))}
    </div>,
    anchor?.closest("dialog") ?? document.body,
  );
}

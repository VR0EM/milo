import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colorVar } from "../../lib/colors";
import { useCreateEvent, useUpdateEvent } from "../../lib/queries";
import { useUi } from "../../lib/store";
import {
  MINUTE, SNAP_MINUTES, addDays, atMinutes, fmtRange, fmtWeekday, minutesIntoDay, sameDay, snapMinutes, startOfDay,
} from "../../lib/time";
import type { CalEvent, Space, Task } from "../../lib/types";
import { firstShown, shiftShown, shownDistance } from "./days";
import { layoutDay } from "./layout";

type Mode = "move" | "start" | "end" | "create";
interface Draft {
  id: string; // an event id, or "new" while drawing a new event
  start: Date;
  end: Date;
}
interface Shown {
  id: string;
  start: Date;
  end: Date;
  event: CalEvent | null;
}

const SNAP_MS = SNAP_MINUTES * MINUTE;
/** The smallest height an event gets, so a one-minute event can still be clicked. */
const MIN_EVENT_PX = 22;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  /** The rendered strip: BUFFER hidden days, the visible days, BUFFER hidden days. */
  days: Date[];
  visibleCount: number;
  buffer: number;
  weekends: boolean;
  events: CalEvent[];
  tasks: Task[];
  spaces: Space[];
  defaultSpaceId: string | null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WeekGrid({ days, visibleCount, buffer, weekends, events, tasks, spaces, defaultSpaceId }: Props) {
  const selectedTaskId = useUi((s) => s.selectedTaskId);
  const hourHeight = useUi((s) => s.hourHeight);
  const selectedId = useUi((s) => s.selectedEventId);
  const select = useUi((s) => s.select);
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null); // the visible window of the body
  const colsRef = useRef<HTMLDivElement>(null); // the moving strip of day columns
  const headStripRef = useRef<HTMLDivElement>(null);
  const alldayStripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pendingScroll = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Keep the latest values reachable from long-lived listeners.
  const live = useRef({ days, hourHeight, visibleCount, buffer, weekends });
  live.current = { days, hourHeight, visibleCount, buffer, weekends };

  // ---- smooth horizontal scrolling --------------------------------------------------------
  // The strip is moved with a transform only; React renders again only when a whole day has
  // been passed. `pos` is the fraction of a day scrolled past the first visible day, and
  // `pending` counts days the store has moved on that are not rendered yet.
  const pos = useRef(0);
  const pending = useRef(0);
  const anim = useRef<number | null>(null);
  const renderedStart = useRef(days[buffer]);

  const applyPos = () => {
    const { buffer: b, days: d } = live.current;
    const offset = Math.min(Math.max(b + pending.current + pos.current, 0), 2 * b);
    const t = `translate3d(${(-offset / d.length) * 100}%, 0, 0)`;
    for (const el of [headStripRef.current, alldayStripRef.current, colsRef.current]) if (el) el.style.transform = t;
  };

  const stopAnim = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  /** Move by a number of days (fractions allowed). Whole days passed update the store. */
  const moveBy = (deltaDays: number) => {
    const { buffer: b, weekends: w } = live.current;
    const room = b - 1 - Math.abs(pending.current);
    const p = pos.current + Math.max(-room, Math.min(room, deltaDays));
    const whole = Math.floor(p);
    pos.current = p - whole;
    if (whole !== 0) {
      pending.current += whole;
      const ui = useUi.getState();
      ui.setViewStart(shiftShown(firstShown(ui.viewStart, w), whole, w));
    }
    applyPos();
  };

  const animateTo = (target: number, ms: number, done?: () => void) => {
    stopAnim();
    const from = pos.current;
    if (ms <= 0 || reducedMotion() || from === target) {
      pos.current = target;
      applyPos();
      done?.();
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      pos.current = from + (target - from) * eased;
      applyPos();
      if (k < 1) anim.current = requestAnimationFrame(step);
      else {
        anim.current = null;
        done?.();
      }
    };
    anim.current = requestAnimationFrame(step);
  };

  /** After scrolling stops, settle softly on the nearest whole day. */
  const settle = () => {
    const target = Math.round(pos.current);
    animateTo(target, 220, () => {
      if (target !== 0) moveBy(0); // folds a full day into the store
    });
  };

  // Every render re-centres the strip on the store's day. Moves from the scroll gesture are
  // already on screen; moves from elsewhere (week buttons, T, the mini month) slide in.
  useLayoutEffect(() => {
    const prev = renderedStart.current;
    const next = days[buffer];
    renderedStart.current = next;
    const moved = shownDistance(prev, next, weekends, 3 * buffer);
    if (moved === null) {
      pending.current = 0;
      pos.current = 0;
    } else if (pending.current !== 0) {
      pending.current -= moved;
    } else if (moved !== 0) {
      stopAnim();
      if (Math.abs(moved) <= buffer && !reducedMotion()) {
        pos.current = -moved;
        applyPos();
        animateTo(0, 320);
        return;
      }
      pos.current = 0;
    }
    applyPos();
  });

  useEffect(() => stopAnim, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Open on the morning rather than at midnight.
  useLayoutEffect(() => {
    const ui = useUi.getState();
    // A little above the hour, so its label is not hidden under the day headers.
    if (scrollerRef.current) scrollerRef.current.scrollTop = Math.max(0, ui.prefs.dayStartHour * ui.hourHeight - 12);
  }, []);

  // After a zoom, keep the time under the pointer where it was.
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scrollerRef.current) {
      scrollerRef.current.scrollTop = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [hourHeight]);

  // Pinch or Ctrl+wheel zooms the time axis. A sideways swipe (or Shift + wheel) scrolls the
  // days freely and settles on a whole day. Each gesture keeps one direction, so a slightly
  // diagonal swipe does not wobble between scrolling hours and days.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let axis: "x" | "y" | null = null;
    let last = 0;
    let idle: number | undefined;
    const onWheel = (e: WheelEvent) => {
      const cols = colsRef.current!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ui = useUi.getState();
        const old = ui.hourHeight;
        // Capped per step, so one notch of a mouse wheel does not jump several zoom levels.
        ui.setHourHeight(old * Math.exp(-clamp(e.deltaY, -30, 30) * 0.01));
        const next = useUi.getState().hourHeight;
        if (next !== old) {
          const y = e.clientY - cols.top;
          pendingScroll.current = el.scrollTop + y * (next / old) - y;
        }
        return;
      }
      const t = performance.now();
      if (t - last > 160) axis = null;
      last = t;
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      const dx = (e.deltaX || (e.shiftKey ? e.deltaY : 0)) * unit;
      const dy = e.shiftKey ? 0 : e.deltaY * unit;
      if (axis === null) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis !== "x" || dx === 0) return;
      e.preventDefault();
      stopAnim();
      const dayWidth = viewportRef.current!.getBoundingClientRect().width / live.current.visibleCount;
      moveBy(dx / dayWidth);
      window.clearTimeout(idle);
      idle = window.setTimeout(settle, 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(idle);
    };
  }, []);

  /** The rendered day under x. The pointer is kept inside the visible window. */
  const dayIndexAt = (x: number) => {
    const vp = viewportRef.current!.getBoundingClientRect();
    const r = colsRef.current!.getBoundingClientRect(); // includes the current transform
    const n = live.current.days.length;
    const cx = clamp(x, vp.left + 1, vp.right - 1);
    return clamp(Math.floor((cx - r.left) / (r.width / n)), 0, n - 1);
  };

  function timeAt(x: number, y: number, snap: boolean, idx = dayIndexAt(x)): Date {
    const r = colsRef.current!.getBoundingClientRect();
    const { days, hourHeight } = live.current;
    const minutes = clamp(((y - r.top) / hourHeight) * 60, 0, 1440);
    return atMinutes(days[idx], snap ? snapMinutes(minutes) : minutes);
  }

  function beginDrag(e: React.PointerEvent, mode: Mode, ev?: CalEvent) {
    if (e.button !== 0) return;
    if (mode === "create" && !defaultSpaceId) return;
    const origin = { x: e.clientX, y: e.clientY };
    const t0 = timeAt(origin.x, origin.y, false).getTime();
    const anchor = timeAt(origin.x, origin.y, true).getTime();
    const s0 = ev ? new Date(ev.startAt).getTime() : 0;
    const e0 = ev ? new Date(ev.endAt).getTime() : 0;
    // Drawing and resizing stay inside the day where the drag started, so a sideways
    // slip of the hand cannot stretch an event across days. Only moving crosses days.
    // (An overnight event is made by typing an end time earlier than the start.)
    const lockDay = mode === "move" ? undefined : dayIndexAt(origin.x);
    let latest: Draft | null = null;

    const onMove = (m: PointerEvent) => {
      if (!dragging.current && Math.hypot(m.clientX - origin.x, m.clientY - origin.y) < 4) return;
      dragging.current = true;
      const t = timeAt(m.clientX, m.clientY, true, lockDay).getTime();
      if (mode === "move") {
        const raw = timeAt(m.clientX, m.clientY, false).getTime() - t0;
        const delta = Math.round(raw / SNAP_MS) * SNAP_MS;
        latest = { id: ev!.id, start: new Date(s0 + delta), end: new Date(e0 + delta) };
      } else if (mode === "end") {
        latest = { id: ev!.id, start: new Date(s0), end: new Date(Math.max(t, s0 + SNAP_MS)) };
      } else if (mode === "start") {
        latest = { id: ev!.id, start: new Date(Math.min(t, e0 - SNAP_MS)), end: new Date(e0) };
      } else {
        const a = Math.min(anchor, t);
        latest = { id: "new", start: new Date(a), end: new Date(Math.max(Math.max(anchor, t), a + SNAP_MS)) };
      }
      setDraft(latest);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const wasDragging = dragging.current;
      dragging.current = false;
      if (!wasDragging || !latest) return;
      const done = latest;
      // The draft stays on screen until the data layer has answered, so nothing jumps back.
      const clear = () => {
        if (!dragging.current) setDraft((d) => (d === done ? null : d));
      };
      const times = { startAt: done.start.toISOString(), endAt: done.end.toISOString() };
      if (mode === "create") {
        createNew(times.startAt, times.endAt, clear);
      } else if (done.start.getTime() !== s0 || done.end.getTime() !== e0) {
        updateEvent.mutate({ id: ev!.id, patch: times }, { onSettled: clear });
      } else {
        clear();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function createNew(startAt: string, endAt: string, onSettled?: () => void) {
    if (!defaultSpaceId) return;
    createEvent.mutate(
      { spaceId: defaultSpaceId, activityId: null, title: "", startAt, endAt, allDay: false, notes: "", status: "planned" },
      { onSuccess: (created) => select(created.id, true), onSettled },
    );
  }

  /** Double-click in the all-day row: a new all-day event on that day. */
  function createAllDay(day: Date) {
    if (!defaultSpaceId) return;
    const start = startOfDay(day);
    createEvent.mutate(
      { spaceId: defaultSpaceId, activityId: null, title: "", startAt: start.toISOString(), endAt: addDays(start, 1).toISOString(), allDay: true, notes: "", status: "planned" },
      { onSuccess: (created) => select(created.id, true) },
    );
  }

  function onDoubleClick(e: React.MouseEvent) {
    const t = timeAt(e.clientX, e.clientY, false);
    const start = atMinutes(t, Math.floor(minutesIntoDay(t) / 30) * 30);
    createNew(start.toISOString(), new Date(start.getTime() + useUi.getState().prefs.eventMinutes * MINUTE).toISOString());
  }

  const allDay = useMemo(() => events.filter((e) => e.allDay), [events]);
  const shown = useMemo<Shown[]>(() => {
    const list: Shown[] = events.filter((e) => !e.allDay).map((event) =>
      draft?.id === event.id
        ? { id: event.id, start: draft.start, end: draft.end, event }
        : { id: event.id, start: new Date(event.startAt), end: new Date(event.endAt), event },
    );
    if (draft?.id === "new") list.push({ id: "new", start: draft.start, end: draft.end, event: null });
    return list;
  }, [events, draft]);

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const px = (minutes: number) => (minutes / 60) * hourHeight;
  // The strip is as wide as all rendered days; each day is as wide as one visible column.
  const stripStyle = { width: `${(days.length / visibleCount) * 100}%` };

  return (
    <div className="grid-scroller" ref={scrollerRef}>
      <div className="grid-header">
        <div className="grid-header-row">
          <div className="gutter" />
          <div className="h-viewport">
            <div className="h-strip" ref={headStripRef} style={stripStyle}>
              {days.map((d) => (
                <div key={d.getTime()} className={`day-head${sameDay(d, now) ? " today" : ""}`}>
                  <span className="weekday">{fmtWeekday(d)}</span>
                  <span className="daynum">{d.getDate()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Above the hours: all-day events, and tasks on their deadline and target days. */}
        <div className="grid-header-row allday">
          <div className="gutter"><span className="allday-label">All day</span></div>
          <div className="h-viewport">
          <div className="h-strip" ref={alldayStripRef} style={stripStyle}>
          {days.map((d) => (
            <div
              key={d.getTime()}
              className="allday-cell"
              title="Double-click for an all-day event"
              onDoubleClick={(e) => e.target === e.currentTarget && createAllDay(d)}
            >
              {allDay
                .filter((e) => new Date(e.startAt) < addDays(d, 1) && new Date(e.endAt) > d)
                .map((e) => (
                  <button
                    key={e.id}
                    className={`task-chip allday-event${e.id === selectedId ? " selected" : ""}${e.status === "skipped" ? " done" : ""}`}
                    style={{ ["--c" as string]: colorVar(spaceById.get(e.spaceId)?.color ?? "gray") }}
                    title={e.title || "Untitled"}
                    onClick={() => select(e.id)}
                  >
                    <span className="chip-title">{e.title || "Untitled"}</span>
                  </button>
                ))}
              {tasks.flatMap((t) => {
                const due = !!t.deadlineAt && sameDay(new Date(t.deadlineAt), d);
                const aim = !due && !!t.targetAt && sameDay(new Date(t.targetAt), d);
                if (!due && !aim) return [];
                const space = spaceById.get(t.spaceId);
                const late = due && !t.completedAt && new Date(t.deadlineAt!) < now;
                const cls = ["task-chip", aim ? "aim" : "", t.completedAt ? "done" : "", t.id === selectedTaskId ? "selected" : ""].join(" ");
                return [
                  <button
                    key={t.id}
                    className={cls}
                    style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}
                    title={`${aim ? "Aim" : "Due"}: ${t.title || "Untitled"}${late ? " (overdue)" : ""}`}
                    onClick={() => useUi.getState().selectTask(t.id)}
                  >
                    <span className="chip-kind">{aim ? "Aim" : "Due"}</span>
                    <span className="chip-title">{t.title || "Untitled"}</span>
                  </button>,
                ];
              })}
            </div>
          ))}
          </div>
          </div>
        </div>
      </div>

      <div className="grid-body" style={{ height: 24 * hourHeight }}>
        <div className="gutter">
          {HOURS.slice(1).map((h) => (
            <div key={h} className="hour-label" style={{ top: h * hourHeight }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        <div className="grid-cols" ref={viewportRef} style={{ backgroundSize: `100% ${hourHeight}px` }}>
        <div
          className="h-strip body-strip"
          ref={colsRef}
          style={stripStyle}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("day-col")) return;
            select(null);
            beginDrag(e, "create");
          }}
          onDoubleClick={onDoubleClick}
        >
          {days.map((day) => (
            <div key={day.getTime()} className={`day-col${sameDay(day, now) ? " today" : ""}`}>
              {sameDay(day, now) && <div className="now-line" style={{ top: px(minutesIntoDay(now)) }} />}
              {layoutDay(shown, day).map((seg) => {
                const ev = seg.item.event;
                const space = spaceById.get(ev?.spaceId ?? defaultSpaceId ?? "");
                // Very short events (a deadline at 23:59) still get a clickable height, and one
                // that would run past midnight is lifted so it stays inside the day.
                const height = Math.max(px(seg.bottom - seg.top), MIN_EVENT_PX);
                const top = Math.min(px(seg.top), 24 * hourHeight - height);
                const cls = [
                  "event",
                  ev && ev.id === selectedId ? "selected" : "",
                  ev?.status === "skipped" ? "skipped" : "",
                  seg.item.end < now ? "past" : "",
                  seg.item.id === draft?.id ? "dragging" : "",
                ].join(" ");
                return (
                  <div
                    key={seg.item.id}
                    className={cls}
                    style={{
                      top,
                      height: height - 1,
                      left: `calc(${(seg.col / seg.cols) * 100}% + 1px)`,
                      width: `calc(${100 / seg.cols}% - 3px)`,
                      ["--c" as string]: colorVar(space?.color ?? "gray"),
                    }}
                    onPointerDown={(e) => {
                      if (!ev) return;
                      e.stopPropagation();
                      select(ev.id);
                      beginDrag(e, "move", ev);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (ev) select(ev.id, true);
                    }}
                  >
                    <div className="event-title">{ev?.title || (ev ? "Untitled" : "New event")}</div>
                    {height >= 36 && <div className="event-time">{fmtRange(seg.item.start, seg.item.end)}</div>}
                    {ev && seg.startsHere && (
                      <div className="handle top" onPointerDown={(e) => { e.stopPropagation(); select(ev.id); beginDrag(e, "start", ev); }} />
                    )}
                    {ev && seg.endsHere && (
                      <div className="handle bottom" onPointerDown={(e) => { e.stopPropagation(); select(ev.id); beginDrag(e, "end", ev); }} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

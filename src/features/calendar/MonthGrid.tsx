import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { colorVar } from "../../lib/colors";
import { useCreateEvent, useUpdateEvent } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, fmtLongDay, fmtTime, fmtWeekday, sameDay, startOfDay, startOfWeek, weekStart } from "../../lib/time";
import type { CalEvent, Space, Task } from "../../lib/types";
import { lanesPerColumn, layoutSpans } from "./spans";


/** Height of one line in a day cell, and the room above the first line. Keep in step with the CSS. */
const ITEM_PX = 22;
const HEAD_PX = 30;
const DAY_MS = 86_400_000;

/** The Mondays of every week that touches the month of `month`. */
export function monthWeeks(month: Date): Date[] {
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const weeks: Date[] = [];
  for (let w = startOfWeek(month); w < next; w = addDays(w, 7)) weeks.push(w);
  return weeks;
}

type Item =
  | { kind: "task"; key: string; task: Task; aim: boolean }
  | { kind: "timed"; key: string; event: CalEvent };

interface Props {
  /** The 1st of the month on screen. */
  month: Date;
  weekends: boolean;
  events: CalEvent[];
  tasks: Task[];
  spaces: Space[];
  defaultSpaceId: string | null;
}

/** While an event is dragged: which one, and the day under the pointer. */
interface Drag {
  id: string;
  over: number | null;
}

export function MonthGrid({ month, weekends, events, tasks, spaces, defaultSpaceId }: Props) {
  const selectedId = useUi((s) => s.selectedEventId);
  const selectedTaskId = useUi((s) => s.selectedTaskId);
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const weeks = useMemo(() => monthWeeks(month), [month.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = weekends ? 7 : 5;
  // Without weekends the five columns are Monday to Friday, also when weeks start on Sunday.
  const firstCol = !weekends && weekStart() === 0 ? 1 : 0;
  const today = new Date();
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const [drag, setDrag] = useState<Drag | null>(null);

  // How many lines fit in a day cell depends on the window height; the rest becomes "n more".
  const gridRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(3);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const rowH = el.clientHeight / weeks.length;
      setFits(Math.max(1, Math.floor((rowH - HEAD_PX - 4) / ITEM_PX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  const otherItemsOn = (d: Date): Item[] => {
    const due = tasks.flatMap((task): Item[] => {
      const isDue = !!task.deadlineAt && sameDay(new Date(task.deadlineAt), d);
      const aim = !isDue && !!task.targetAt && sameDay(new Date(task.targetAt), d);
      return isDue || aim ? [{ kind: "task", key: task.id, task, aim }] : [];
    });
    // Timed events show on the day they start, in order.
    const timed = events
      .filter((e) => !e.allDay && sameDay(new Date(e.startAt), d))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((event): Item => ({ kind: "timed", key: event.id, event }));
    return [...due, ...timed];
  };

  const openDay = (d: Date) => {
    const ui = useUi.getState();
    ui.setCalMode("day");
    ui.showDate(d);
  };

  const newAllDay = (d: Date) => {
    if (!defaultSpaceId) return;
    createEvent.mutate(
      { spaceId: defaultSpaceId, activityId: null, title: "", startAt: d.toISOString(), endAt: addDays(d, 1).toISOString(), allDay: true, notes: "", status: "planned" },
      { onSuccess: (created) => useUi.getState().select(created.id, true) },
    );
  };

  /** The day under a point on the screen, worked out from the week row and the column. */
  const dayAt = (x: number, y: number): Date | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>(".month-week");
    if (!row?.dataset.week) return null;
    const r = row.getBoundingClientRect();
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * cols)));
    return addDays(new Date(Number(row.dataset.week)), firstCol + col);
  };

  /** Drag an event to another day: it keeps its times and length. A press without moving is a click. */
  const beginDrag = (e: React.PointerEvent, ev: CalEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const grab = dayAt(x0, y0);
    if (!grab) return;
    let moved = false;
    let over: Date | null = grab;
    const onMove = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
      moved = true;
      over = dayAt(m.clientX, m.clientY);
      document.body.classList.add("month-dragging");
      setDrag({ id: ev.id, over: over?.getTime() ?? null });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("month-dragging");
      setDrag(null);
      if (!moved || !over) return;
      const shift = Math.round((startOfDay(over).getTime() - startOfDay(grab).getTime()) / DAY_MS);
      if (shift === 0) return;
      const before = { startAt: ev.startAt, endAt: ev.endAt };
      updateEvent.mutate(
        {
          id: ev.id,
          patch: { startAt: addDays(new Date(ev.startAt), shift).toISOString(), endAt: addDays(new Date(ev.endAt), shift).toISOString() },
        },
        {
          onSuccess: () =>
            useUi.getState().notify({
              text: `Moved to ${fmtLongDay(addDays(new Date(ev.startAt), shift))}`,
              undo: () => updateEvent.mutate({ id: ev.id, patch: before }),
            }),
        },
      );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const color = (spaceId: string) => ({ ["--c" as string]: colorVar(spaceById.get(spaceId)?.color ?? "gray") });

  return (
    <div className="month" style={{ ["--cols" as string]: cols }}>
      <div className="month-head">
        {Array.from({ length: cols }, (_, i) => addDays(weeks[0], firstCol + i)).map((d) => <span key={d.getDay()}>{fmtWeekday(d)}</span>)}
      </div>
      <div className="month-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((w) => {
          const days = Array.from({ length: cols }, (_, i) => addDays(w, firstCol + i));
          const spans = layoutSpans(events, days);
          // Bars use at most all lines but one, so there is always room to say what is hidden.
          const laneCap = Math.max(0, fits - 1);
          const lanes = lanesPerColumn(spans.filter((s) => s.lane < laneCap), cols);
          return (
            <div key={w.getTime()} className="month-week" data-week={w.getTime()}>
              {days.map((d, col) => {
                const items = otherItemsOn(d);
                const hiddenBars = spans.filter((s) => s.lane >= laneCap && s.from <= col && s.to >= col).length;
                const room = fits - lanes[col];
                const total = items.length + hiddenBars;
                const shown = total > room ? Math.max(0, room - 1) : items.length;
                const more = total - Math.min(shown, items.length);
                const isOver = drag?.over === d.getTime();
                return (
                  <div
                    key={d.getTime()}
                    className={[
                      "month-cell",
                      col === 0 ? "first-col" : "",
                      d.getMonth() !== month.getMonth() ? "outside" : "",
                      sameDay(d, today) ? "today" : "",
                      isOver ? "drop-target" : "",
                    ].join(" ")}
                    onDoubleClick={(e) => {
                      if (!(e.target as HTMLElement).closest("button")) newAllDay(d);
                    }}
                    // Ctrl/Cmd+V after this puts a copied event on this day (at its own time).
                    onPointerDown={(e) => {
                      if (e.button === 0 && !(e.target as HTMLElement).closest("button")) useUi.setState({ pasteAt: d, pasteDayOnly: true });
                    }}
                  >
                    <button className="month-daynum" title={`Open ${fmtLongDay(d)}`} aria-label={`Open ${fmtLongDay(d)}`} onClick={() => openDay(d)}>
                      {d.getDate() === 1 ? `1 ${d.toLocaleString("en-GB", { month: "short" })}` : d.getDate()}
                    </button>
                    <div className="month-items" style={{ marginTop: lanes[col] * ITEM_PX }}>
                      {items.slice(0, shown).map((it) =>
                        it.kind === "timed" ? (
                          <button
                            key={it.key}
                            className={[
                              "month-event",
                              it.event.id === selectedId ? "selected" : "",
                              it.event.status === "skipped" ? "skipped" : "",
                              drag?.id === it.event.id ? "drag-source" : "",
                            ].join(" ")}
                            style={color(it.event.spaceId)}
                            title={`${fmtTime(new Date(it.event.startAt))} ${it.event.title || "Untitled"}`}
                            onPointerDown={(e) => beginDrag(e, it.event)}
                            onClick={() => useUi.getState().select(it.event.id)}
                          >
                            <span className="month-dot" />
                            <span className="month-time">{fmtTime(new Date(it.event.startAt))}</span>
                            <span className="chip-title">{it.event.title || "Untitled"}</span>
                          </button>
                        ) : (
                          <button
                            key={it.key}
                            className={["task-chip", it.aim ? "aim" : "", it.task.completedAt ? "done" : "", it.task.id === selectedTaskId ? "selected" : ""].join(" ")}
                            style={color(it.task.spaceId)}
                            title={`${it.aim ? "Aim" : "Due"}: ${it.task.title || "Untitled"}`}
                            onClick={() => useUi.getState().selectTask(it.task.id)}
                          >
                            <span className="chip-kind">{it.aim ? "Aim" : "Due"}</span>
                            <span className="chip-title">{it.task.title || "Untitled"}</span>
                          </button>
                        ),
                      )}
                      {more > 0 && (
                        <button className="month-more" onClick={() => openDay(d)}>
                          {more} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {spans
                .filter((sp) => sp.lane < laneCap)
                .map((sp) => {
                  const e = sp.event;
                  return (
                    <button
                      key={e.id}
                      className={[
                        "task-chip allday-event allday-bar",
                        sp.cutStart ? "cut-start" : "",
                        sp.cutEnd ? "cut-end" : "",
                        e.id === selectedId ? "selected" : "",
                        e.status === "skipped" ? "done" : "",
                        drag?.id === e.id ? "drag-source" : "",
                      ].join(" ")}
                      style={{
                        ...color(e.spaceId),
                        left: `calc(${(sp.from / cols) * 100}% + 4px)`,
                        width: `calc(${((sp.to - sp.from + 1) / cols) * 100}% - 8px)`,
                        top: HEAD_PX + sp.lane * ITEM_PX,
                      }}
                      title={e.title || "Untitled"}
                      onPointerDown={(ev) => beginDrag(ev, e)}
                      onClick={() => useUi.getState().select(e.id)}
                    >
                      <span className="chip-title">{e.title || "Untitled"}</span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { Fragment, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useEvents, useSpaces, useTasks } from "../../lib/queries";
import { useUi, type TodayBlock } from "../../lib/store";
import { addDays, daysFromToday, fmtHm, fmtLongDay, fmtTime, startOfDay, toDateInput, toTimeInput } from "../../lib/time";
import { taskProgress, type Confirmation, type Space, type Task } from "../../lib/types";
import { SpaceMark } from "../../components/Icon";
import { DayPlan } from "./DayPlan";
import { EndOfDay } from "./EndOfDay";
import { GettingStarted } from "./GettingStarted";
import { WhatsNewCard } from "../whatsnew/WhatsNew";
import { useNow } from "../../lib/useNow";
import { deadlineLine } from "../tasks/TasksView";
import { FocusPanel } from "./FocusPanel";
import { TodayTodos } from "./TodayTodos";
import { WhatNow } from "./WhatNow";

const DEADLINE_WINDOW_DAYS = 14;

export function TodayView() {
  const now = useNow(15_000);
  const dayStart = useMemo(() => startOfDay(now), [toDateInput(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayEnd = useMemo(() => addDays(dayStart, 2), [dayStart]);

  const spaces = useSpaces().data ?? [];
  const events = useEvents(dayStart, dayEnd).data ?? [];
  const tasks = useTasks().data ?? [];

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const live = events.filter((e) => e.status !== "skipped" && !e.allDay);
  const order = useUi((s) => s.prefs.todayOrder);
  const hidden = useUi((s) => s.prefs.todayHidden);

  const deadlines = tasks
    .filter((t) => !t.completedAt && t.deadlineAt && daysFromToday(new Date(t.deadlineAt)) <= DEADLINE_WINDOW_DAYS)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!));

  // Every block decides for itself whether it has something to show; empty ones stay away.
  const blocks: Record<TodayBlock, React.ReactNode> = {
    todos: <TodayTodos now={now} />,
    day: <DayPlan now={now} events={events} spaceById={spaceById} />,
    whatnow: <WhatNow now={now} live={live} />,
    confirm: <ConfirmBlock now={now} />,
    deadlines: deadlines.length > 0 && <DeadlinesBlock deadlines={deadlines} spaceById={spaceById} />,
    wrapup: <EndOfDay now={now} events={events} />,
  };

  return (
    <>
      <main className="page">
        <header className="toolbar">
          <h1>
            {greeting(now)}
            <span className="h1-note tabular">{fmtLongDay(now)} · {fmtTime(now)}</span>
          </h1>
        </header>
        <div className="page-scroll">
          <WhatsNewCard />
          <GettingStarted events={events} />
          {order.filter((b) => !hidden.includes(b)).map((b) => <Fragment key={b}>{blocks[b]}</Fragment>)}
        </div>
      </main>
      <FocusPanel />
    </>
  );
}

function greeting(now: Date) {
  const h = now.getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

function DeadlinesBlock({ deadlines, spaceById }: { deadlines: Task[]; spaceById: Map<string, Space> }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2>Deadlines</h2>
        <span className="muted small">next {DEADLINE_WINDOW_DAYS} days</span>
      </div>
      <ul className="deadline-list">
        {deadlines.map((t) => {
          const due = deadlineLine(t)!;
          const pct = Math.round(taskProgress(t) * 100);
          const space = spaceById.get(t.spaceId);
          return (
            <li key={t.id}>
              <button
                className="deadline-row"
                style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}
                onClick={() => {
                  useUi.getState().setView("tasks");
                  useUi.getState().selectTask(t.id);
                }}
              >
                <SpaceMark icon={space?.icon} />
                <span className="deadline-title">{t.title || "Untitled"}</span>
                <span className="muted">{space?.name}</span>
                <span className="spacer" />
                <span className="muted">{pct}%</span>
                <span className={due.late ? "late" : ""}>{due.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Reminders that ask to be checked off today, such as medication. Hidden when there are none. */
function ConfirmBlock({ now }: { now: Date }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["confirmations"], queryFn: api.listConfirmations, staleTime: 0, refetchInterval: 60_000 });
  if (!data.length) return null;
  const set = async (c: Confirmation, done: boolean) => {
    try {
      await api.setConfirmed(c.ruleId, c.occurrence, done);
    } finally {
      qc.invalidateQueries({ queryKey: ["confirmations"] });
    }
  };
  const nowHm = toTimeInput(now);
  return (
    <section className="block">
      <div className="block-head">
        <h2>Check off today</h2>
        <span className="muted">{data.filter((c) => c.confirmedAt).length} of {data.length}</span>
      </div>
      <ul className="routine-list">
        {data.map((c) => (
          <li key={c.ruleId + c.occurrence}>
            <label className={`check routine-item${c.confirmedAt ? " on" : ""}`}>
              <input type="checkbox" checked={!!c.confirmedAt} onChange={(e) => set(c, e.target.checked)} />
              <span className="tabular confirm-time">{fmtHm(c.time)}</span>
              <span>{c.title}</span>
              <span className="spacer" />
              <span className="muted small">
                {c.confirmedAt ? `done at ${fmtTime(new Date(c.confirmedAt))}` : c.time > nowHm ? "later today" : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

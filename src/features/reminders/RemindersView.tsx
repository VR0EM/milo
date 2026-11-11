import { useEffect, useState } from "react";
import { api, autostart } from "../../lib/api";
import { DayToggles } from "../../components/DayToggles";
import { TimeField } from "../../components/TimeField";
import { useAction, useArchiveWithUndo, useReminderRules } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { parseTime } from "../../lib/time";
import type { ReminderRule, ReminderRuleInput } from "../../lib/types";

const blank: Omit<ReminderRuleInput, "kind" | "title"> = {
  enabled: true, minutesBefore: null, times: null, weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null,
};

export function RemindersView() {
  const rules = useReminderRules().data ?? [];
  const act = useAction("reminders");

  return (
    <main className="today full">
      <header className="toolbar">
        <h1>Reminders</h1>
        <div className="toolbar-actions">
          <button className="btn" onClick={() => act.mutate(() => api.sendTestReminder())}>Send a test reminder</button>
        </div>
      </header>
      <div className="today-scroll">
        <p className="muted">
          Reminders arrive as silent system notifications. Milo keeps running in the tray after you close the
          window, so they still arrive; quit from the tray icon to stop them.
        </p>

        {rules.map((r) => <RuleCard key={r.id} rule={r} />)}

        <div className="inline">
          <span className="muted">Add a reminder:</span>
          <button
            className="btn"
            onClick={() => act.mutate(() => api.createReminderRule({ ...blank, kind: "times", title: "New reminder", times: "09:00" }))}
          >
            At fixed times
          </button>
          <button
            className="btn"
            onClick={() =>
              act.mutate(() =>
                api.createReminderRule({ ...blank, kind: "interval", title: "New reminder", intervalMinutes: 60, startTime: "09:00", endTime: "18:00" }),
              )
            }
          >
            Every so often
          </button>
        </div>

        <Autostart />
      </div>
    </main>
  );
}

function RuleCard({ rule }: { rule: ReminderRule }) {
  const act = useAction("reminders");
  const archive = useArchiveWithUndo();
  const [title, setTitle] = useState(rule.title);
  const [times, setTimes] = useState(rule.times?.replace(/,/g, ", ") ?? "");

  const save = (patch: Partial<ReminderRuleInput>) => {
    const { id, ...current } = rule;
    act.mutate(() => api.updateReminderRule(id, { ...current, ...patch }));
  };

  const commitTimes = () => {
    const parsed = times.split(/[,;\s]+/).filter(Boolean).map(parseTime);
    if (!parsed.length || parsed.some((t) => !t)) {
      setTimes(rule.times?.replace(/,/g, ", ") ?? "");
      useUi.getState().notify({ text: "Times must look like 08:00, 20:00" });
      return;
    }
    const value = [...new Set(parsed as string[])].sort().join(",");
    setTimes(value.replace(/,/g, ", "));
    if (value !== rule.times) save({ times: value });
  };

  const number = (value: number | null, key: "minutesBefore" | "intervalMinutes", min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      defaultValue={value ?? ""}
      key={value}
      onBlur={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n) && n >= min && n <= max) n !== value && save({ [key]: n });
        else e.target.value = String(value ?? "");
      }}
    />
  );

  return (
    <section className={`reminder-card${rule.enabled ? "" : " off"}`}>
      <div className="reminder-head">
        {rule.kind === "event" ? (
          <h3>Events</h3>
        ) : (
          <input
            className="title-input"
            aria-label="Reminder name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => (title.trim() ? title !== rule.title && save({ title }) : setTitle(rule.title))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        )}
        <label className="switch">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <span>{rule.enabled ? "On" : "Off"}</span>
        </label>
      </div>

      <div className="reminder-body">
        {rule.kind === "event" && (
          <div className="inline">
            <span>Remind me</span>
            {number(rule.minutesBefore, "minutesBefore", 0, 240)}
            <span>minutes before an event starts.</span>
          </div>
        )}

        {rule.kind === "times" && (
          <label className="inline">
            <span>At</span>
            <input
              className="times"
              aria-label="Times"
              placeholder="08:00, 20:00"
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              onBlur={commitTimes}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <span className="muted">separate several times with a comma</span>
          </label>
        )}

        {rule.kind === "interval" && (
          <div className="inline">
            <span>Every</span>
            {number(rule.intervalMinutes, "intervalMinutes", 5, 720)}
            <span>minutes, from</span>
            <span className="short-wrap"><TimeField value={rule.startTime ?? "09:00"} onCommit={(t) => save({ startTime: t })} /></span>
            <span>until</span>
            <span className="short-wrap"><TimeField value={rule.endTime ?? "21:00"} onCommit={(t) => save({ endTime: t })} /></span>
          </div>
        )}

        {rule.kind !== "event" && <DayToggles value={rule.weekdays} onChange={(weekdays) => save({ weekdays })} />}
      </div>

      {rule.kind !== "event" && (
        <div className="panel-foot">
          <button className="btn quiet" onClick={() => archive("reminder_rule", rule.id, rule.title)}>Archive</button>
        </div>
      )}
    </section>
  );
}

function Autostart() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    autostart.isEnabled().then(setOn, () => {});
  }, []);
  if (!autostart.available) return null;
  return (
    <section className="reminder-card">
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            const next = e.target.checked;
            try {
              await autostart.set(next);
              setOn(next);
            } catch (err) {
              useUi.getState().notify({ text: String(err) });
            }
          }}
        />
        <span>Start Milo when the computer starts</span>
      </label>
      <p className="muted small">Needed for reminders to arrive without opening Milo yourself.</p>
    </section>
  );
}

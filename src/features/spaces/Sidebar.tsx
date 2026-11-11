import { colorVar } from "../../lib/colors";
import { useActiveFocus, useActivities, useGroups, useSpaces, useTaskTypes } from "../../lib/queries";
import { useUi, type View } from "../../lib/store";
import { fmtClock } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import type { Space } from "../../lib/types";

const NAV: [View, string][] = [["today", "Today"], ["calendar", "Calendar"], ["tasks", "Tasks"], ["insights", "Insights"], ["reminders", "Reminders"], ["import", "Import & export"]];

/** A quiet reminder that a focus session is running, visible from every screen. */
function FocusIndicator() {
  const session = useActiveFocus().data;
  const now = useNow(1000);
  if (!session) return null;
  const left = session.plannedMinutes * 60_000 - (now.getTime() - new Date(session.startedAt).getTime());
  return (
    <button className="focus-indicator" onClick={() => useUi.getState().setView("today")}>
      <span>Focus</span>
      <span className="tabular">{left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`}</span>
    </button>
  );
}

export function Sidebar() {
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const toggle = useUi((s) => s.toggleSpace);
  const open = useUi((s) => s.openDialog);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const taskTypes = (useTaskTypes().data ?? []).filter((t) => !t.deletedAt);

  const groupIds = new Set(groups.map((g) => g.id));
  const loose = spaces.filter((s) => !s.groupId || !groupIds.has(s.groupId));

  const row = (s: Space) => (
    <li key={s.id} className="side-row">
      <label className="space-toggle">
        <input type="checkbox" checked={!hidden.includes(s.id)} onChange={() => toggle(s.id)} />
        <span className="swatch" style={{ ["--c" as string]: colorVar(s.color) }} />
        <span className="side-name">{s.name}</span>
      </label>
      <button className="link" onClick={() => open({ kind: "space", item: s })}>Edit</button>
    </li>
  );

  return (
    <nav className="sidebar" aria-label="Spaces and activities">
      <div className="wordmark">Milo</div>

      <ul className="nav">
        {NAV.map(([v, label]) => (
          <li key={v}>
            <button className={view === v ? "current" : ""} aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
      <FocusIndicator />

      <section>
        <h2>Spaces</h2>
        <ul>{loose.map(row)}</ul>
        {groups.map((g) => (
          <div key={g.id} className="side-group">
            <div className="side-row">
              <span className="group-name">{g.name}</span>
              <button className="link" onClick={() => open({ kind: "group", item: g })}>Edit</button>
            </div>
            <ul>
              {spaces.filter((s) => s.groupId === g.id).map(row)}
              <li>
                <button className="link add" onClick={() => open({ kind: "space", groupId: g.id })}>Add space</button>
              </li>
            </ul>
          </div>
        ))}
        <div className="side-actions">
          <button className="link" onClick={() => open({ kind: "space", groupId: null })}>New space</button>
          <button className="link" onClick={() => open({ kind: "group" })}>New group</button>
        </div>
      </section>

      <section>
        <h2>Activities</h2>
        <ul>
          {activities.map((a) => (
            <li key={a.id} className="side-row">
              <span className="side-name">{a.name}</span>
              <button className="link" onClick={() => open({ kind: "activity", item: a })}>Edit</button>
            </li>
          ))}
        </ul>
        <div className="side-actions">
          <button className="link" onClick={() => open({ kind: "activity" })}>New activity</button>
        </div>
      </section>

      <section>
        <h2>Task types</h2>
        <ul>
          {taskTypes.map((t) => (
            <li key={t.id} className="side-row">
              <span className="side-name">{t.name}</span>
              <button className="link" onClick={() => open({ kind: "task_type", item: t })}>Edit</button>
            </li>
          ))}
        </ul>
        <div className="side-actions">
          <button className="link" onClick={() => open({ kind: "task_type" })}>New task type</button>
        </div>
      </section>
    </nav>
  );
}

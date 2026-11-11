import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, autostart } from "../../lib/api";
import { useActivities, useGroups, useTaskTypes } from "../../lib/queries";
import { useUi, type Accent, type Font, type TextSize, type Theme } from "../../lib/store";
import { MOD_LABEL } from "../shortcuts/keys";
import { Icon } from "../../components/Icon";

const ACCENTS: [Accent, string][] = [["blue", "Blue"], ["teal", "Teal"], ["green", "Green"], ["plum", "Violet"], ["clay", "Coral"]];
const FONTS: [Font, string, string][] = [
  ["system", "Standard", "The computer's own typeface"],
  ["rounded", "Rounded", "Softer letter ends (rounded on Mac)"],
  ["humanist", "Humanist", "Open, slightly warmer shapes"],
  ["serif", "Serif", "Like a printed book"],
];
const SIZES: [TextSize, string][] = [["small", "Small"], ["default", "Default"], ["large", "Large"]];
const THEMES: [Theme, string][] = [["system", "Match the computer"], ["light", "Light"], ["dark", "Dark"]];
const CATEGORY: Record<string, string> = { class: "Counts as class", self_study: "Counts as self-study", other: "Not study time" };

/** One labelled setting: what it is on the left, the control on the right. */
function Row({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        {help && <div className="muted small">{help}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);

  return (
    <main className="page full">
      <header className="toolbar">
        <h1>Settings</h1>
      </header>
      <div className="page-scroll settings">
        <section className="block">
          <h2>Appearance</h2>
          <Row title="Theme">
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {THEMES.map(([t, label]) => (
                <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ theme: t })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Accent colour" help="Used for today, the current selection and buttons.">
            <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map(([a, label]) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={prefs.accent === a}
                  aria-label={label}
                  title={label}
                  data-accent-swatch={a}
                  className={prefs.accent === a ? "on" : ""}
                  onClick={() => setPrefs({ accent: a })}
                />
              ))}
            </div>
          </Row>
        </section>

        <section className="block">
          <h2>Text</h2>
          <Row title="Typeface">
            <div className="font-picker" role="radiogroup" aria-label="Typeface">
              {FONTS.map(([f, label, hint]) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={prefs.font === f}
                  title={hint}
                  className={prefs.font === f ? "on" : ""}
                  data-font-sample={f}
                  onClick={() => setPrefs({ font: f })}
                >
                  <span className="font-sample">Aa</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row title="Text size">
            <div className="segmented" role="radiogroup" aria-label="Text size">
              {SIZES.map(([t, label]) => (
                <button key={t} role="radio" aria-checked={prefs.textSize === t} className={prefs.textSize === t ? "on" : ""} onClick={() => setPrefs({ textSize: t })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
        </section>

        <section className="block">
          <h2>Calendar</h2>
          <Row title="Show weekends">
            <label className="switch-control">
              <input type="checkbox" role="switch" checked={prefs.showWeekends} onChange={(e) => setPrefs({ showWeekends: e.target.checked })} />
              <span>{prefs.showWeekends ? "On" : "Off"}</span>
            </label>
          </Row>
          <Row title="New events last" help="For double-click and the N key. Dragging draws any length.">
            <select value={prefs.eventMinutes} onChange={(e) => setPrefs({ eventMinutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
            </select>
          </Row>
          <Row title="Open the calendar at" help="The hour shown at the top when the calendar opens.">
            <select value={prefs.dayStartHour} onChange={(e) => setPrefs({ dayStartHour: Number(e.target.value) })}>
              {Array.from({ length: 13 }, (_, h) => h).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </Row>
        </section>

        <Lists />
        <Startup />
        <Data />

        <section className="block">
          <h2>Keyboard</h2>
          <Row title="Keyboard shortcuts" help={`Press ? anywhere, or ${MOD_LABEL}, to come back here.`}>
            <button className="btn" onClick={() => useUi.setState({ shortcutsOpen: true })}>Show shortcuts</button>
          </Row>
        </section>
      </div>
    </main>
  );
}

function ListBox({ title, add, children }: { title: string; add: () => void; children: React.ReactNode }) {
  return (
    <div className="list-box">
      <div className="list-box-head">
        <h3>{title}</h3>
        <button className="btn small" onClick={add}><Icon name="plus" size={12} />Add</button>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ListItem({ name, meta, onEdit }: { name: string; meta?: string; onEdit: () => void }) {
  return (
    <li className="list-item">
      <span className="list-name">{name}</span>
      {meta && <span className="list-meta">{meta}</span>}
      <button className="link" onClick={onEdit}>Edit</button>
    </li>
  );
}

function Lists() {
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);
  const types = (useTaskTypes().data ?? []).filter((t) => !t.deletedAt);
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const open = useUi((s) => s.openDialog);

  return (
    <section className="block">
      <h2>Lists</h2>
      <p className="muted small">The choices offered when you plan events and tasks. Archived items keep their history.</p>
      <ListBox title="Activities" add={() => open({ kind: "activity" })}>
        {activities.map((a) => <ListItem key={a.id} name={a.name} meta={CATEGORY[a.category]} onEdit={() => open({ kind: "activity", item: a })} />)}
      </ListBox>
      <ListBox title="Task types" add={() => open({ kind: "task_type" })}>
        {types.map((t) => <ListItem key={t.id} name={t.name} onEdit={() => open({ kind: "task_type", item: t })} />)}
      </ListBox>
      <ListBox title="Groups of spaces" add={() => open({ kind: "group" })}>
        {groups.map((g) => <ListItem key={g.id} name={g.name} onEdit={() => open({ kind: "group", item: g })} />)}
      </ListBox>
    </section>
  );
}

function Startup() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    autostart.isEnabled().then(setOn, () => {});
  }, []);
  return (
    <section className="block">
      <h2>Startup</h2>
      <Row
        title="Start Milo when the computer starts"
        help={autostart.available ? "Needed for reminders to arrive without opening Milo yourself." : "Only in the desktop app."}
      >
        <label className="switch-control">
          <input
            type="checkbox"
            role="switch"
            disabled={!autostart.available}
            checked={on}
            onChange={async (e) => {
              const next = e.target.checked;
              try {
                await autostart.set(next);
                setOn(next);
              } catch (err) {
                useUi.getState().notify({ text: String(err), error: true });
              }
            }}
          />
          <span>{on ? "On" : "Off"}</span>
        </label>
      </Row>
    </section>
  );
}

function Data() {
  const { data } = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: 0 });
  return (
    <section className="block">
      <h2>Your data</h2>
      <Row title="Stored on this computer" help="One database file. No account, nothing in the cloud.">
        <code className="path" title={data?.dataDir}>{data?.dataDir ?? "…"}</code>
      </Row>
      <Row title="Daily backups" help="A full copy is made once a day and kept, next to the database.">
        <span className="muted">
          {data ? (data.backupCount ? `${data.backupCount} kept · newest ${data.lastBackup?.replace(/^milo-|\.sqlite$/g, "")}` : "None yet") : "…"}
        </span>
      </Row>
      <Row title="Export everything" help="One JSON file with all data, archived items included.">
        <button className="btn" onClick={() => useUi.getState().setView("import")}>Go to Import &amp; export</button>
      </Row>
      {data && <p className="muted small">Milo {data.version}</p>}
    </section>
  );
}

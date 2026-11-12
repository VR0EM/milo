import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, autostart, files } from "../../lib/api";
import type { BackupFile } from "../../lib/types";
import { checkForUpdate, installUpdate, useUpdates } from "../../lib/updates";
import { useActivities, useGroups, useTaskTypes } from "../../lib/queries";
import { useUi, type Accent, type Font, type TextSize, type Theme } from "../../lib/store";
import { MOD_LABEL } from "../shortcuts/keys";
import { Icon } from "../../components/Icon";
import { HelpTip } from "../../components/HelpTip";

const ACCENTS: [Accent, string][] = [["blue", "Blue"], ["teal", "Teal"], ["green", "Green"], ["plum", "Violet"], ["clay", "Coral"]];
const FONTS: [Font, string, string][] = [
  ["system", "Standard", "The computer's own typeface"],
  ["rounded", "Rounded", "Softer letter ends (rounded on Mac)"],
  ["humanist", "Humanist", "Open, slightly warmer shapes"],
  ["serif", "Serif", "Like a printed book"],
];
const SIZES: [TextSize, string][] = [["small", "Small"], ["default", "Default"], ["large", "Large"]];
const THEMES: [Theme, string][] = [["system", "Match the computer"], ["light", "Light"], ["dark", "Dark"]];
const CATEGORY: Record<string, string> = { class: "Class", self_study: "Self-study", other: "Not productive" };

/** One labelled setting: the name (with an optional "?" explanation) on the left, the control on the right. */
function Row({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {info && <HelpTip label={`About ${title.toLowerCase()}`}>{info}</HelpTip>}
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
          <Row title="Theme" info="Match the computer follows the light or dark setting of Windows or macOS.">
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {THEMES.map(([t, label]) => (
                <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ theme: t })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Accent colour" info="Marks today in the calendar, the selected item, buttons and checkboxes. The last circle lets you pick any colour.">
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
              <label className={`accent-custom${prefs.accent === "custom" ? " on" : ""}`} title="Your own colour" style={{ ["--sw" as string]: prefs.customAccent }}>
                <input
                  type="color"
                  aria-label="Your own accent colour"
                  value={prefs.customAccent}
                  onChange={(e) => setPrefs({ accent: "custom", customAccent: e.target.value })}
                  onClick={() => setPrefs({ accent: "custom" })}
                />
              </label>
            </div>
          </Row>
        </section>

        <section className="block">
          <h2>Text</h2>
          <Row title="Typeface" info="Only typefaces already on the computer are used. Rounded is rounded on a Mac and looks like Standard on Windows.">
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
          <Row title="Text size" info="Makes all text in Milo smaller or larger.">
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
          <Row title="Show weekends" info="Off hides Saturday and Sunday in the calendar. Events on those days are kept.">
            <label className="switch-control">
              <input type="checkbox" role="switch" checked={prefs.showWeekends} onChange={(e) => setPrefs({ showWeekends: e.target.checked })} />
              <span>{prefs.showWeekends ? "On" : "Off"}</span>
            </label>
          </Row>
          <Row title="New events last" info="The length of an event made by double-clicking or pressing N. Dragging on the calendar draws any length.">
            <select value={prefs.eventMinutes} onChange={(e) => setPrefs({ eventMinutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
            </select>
          </Row>
          <Row title="Open the calendar at" info="The hour shown at the top when the calendar opens. Earlier hours are a scroll away.">
            <select value={prefs.dayStartHour} onChange={(e) => setPrefs({ dayStartHour: Number(e.target.value) })}>
              {Array.from({ length: 13 }, (_, h) => h).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </Row>
        </section>

        <Updates />
        <Lists />
        <Startup />
        <Data />

        <section className="block">
          <h2>Keyboard</h2>
          <Row title="Keyboard shortcuts" info={`Press ? anywhere for the list. ${MOD_LABEL}, opens Settings.`}>
            <button className="btn" onClick={() => useUi.setState({ shortcutsOpen: true })}>Show shortcuts</button>
          </Row>
        </section>
      </div>
    </main>
  );
}

function ListBox({ title, info, add, children }: { title: string; info: string; add: () => void; children: React.ReactNode }) {
  return (
    <div className="list-box">
      <div className="list-box-head">
        <h3>{title}<HelpTip label={`About ${title.toLowerCase()}`}>{info}</HelpTip></h3>
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
      <ListBox title="Activities" info="What kind of time an event was: class, self-study, lab, exam and so on. Each one counts as class, self-study or not productive, which is what Insights adds up." add={() => open({ kind: "activity" })}>
        {activities.map((a) => <ListItem key={a.id} name={a.name} meta={CATEGORY[a.category]} onEdit={() => open({ kind: "activity", item: a })} />)}
      </ListBox>
      <ListBox title="Task types" info="Kinds of tasks, such as an assignment, theory to study, or a lab. Shown on every task." add={() => open({ kind: "task_type" })}>
        {types.map((t) => <ListItem key={t.id} name={t.name} onEdit={() => open({ kind: "task_type", item: t })} />)}
      </ListBox>
      <ListBox title="Groups of spaces" info="Groups bundle spaces in the sidebar, for example School with one space per course. A group can be folded away." add={() => open({ kind: "group" })}>
        {groups.map((g) => <ListItem key={g.id} name={g.name} onEdit={() => open({ kind: "group", item: g })} />)}
      </ListBox>
    </section>
  );
}

function Updates() {
  const { available, status, progress, error } = useUpdates();
  const auto = useUi((s) => s.prefs.autoUpdates);
  const { data } = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: 0 });
  const busy = status === "checking" || status === "installing";
  const line =
    status === "checking" ? "Checking…"
    : status === "installing" ? (progress === null ? "Installing…" : `Downloading ${Math.round(progress * 100)}%`)
    : available ? `Milo ${available.version} is ready to install`
    : status === "up-to-date" ? "Milo is up to date"
    : status === "error" ? `Could not check: ${error}`
    : "";
  return (
    <section className="block">
      <h2>Updates</h2>
      <Row title="Version" info="New versions are published on GitHub. Milo shows when one is ready; it is only installed when you click Install.">
        <span className="muted">{data ? `Milo ${data.version}` : "…"}</span>
      </Row>
      <Row title="New version">
        <div className="inline">
          {line && <span className={`small ${status === "error" ? "late" : "muted"}`}>{line}</span>}
          {available && status !== "installing" ? (
            <button className="btn primary small" onClick={() => installUpdate()}>Install and restart</button>
          ) : (
            <button className="btn small" disabled={!files.available || busy} onClick={() => checkForUpdate()}>Check now</button>
          )}
        </div>
      </Row>
      <Row
        title="Check when Milo starts"
        info="At most once a day, Milo asks GitHub which version is the newest. Nothing about you or your data is sent. Off means Milo only checks when you press Check now."
      >
        <label className="switch-control">
          <input type="checkbox" role="switch" checked={auto} onChange={(e) => useUi.getState().setPrefs({ autoUpdates: e.target.checked })} />
          <span>{auto ? "On" : "Off"}</span>
        </label>
      </Row>
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
        info="Milo then waits quietly in the tray, so reminders arrive without opening it yourself. Only in the desktop app."
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
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: 0 });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backupSettings, staleTime: 0 }).data;
  const [restoring, setRestoring] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backups"] });
  const notify = (text: string, error = false) => useUi.getState().notify({ text, error });

  const chooseMirror = async () => {
    try {
      const path = await files.folder();
      if (!path) return;
      const copied = await api.setBackupMirror(path);
      notify(copied ? `Copied ${copied} backup${copied === 1 ? "" : "s"} to the second folder` : "The second folder is up to date");
    } catch (e) {
      notify(String(e), true);
    } finally {
      refresh();
    }
  };

  return (
    <section className="block">
      <h2>Your data</h2>
      <Row title="Stored on this computer" info="Everything is in one database file in this folder. No account, nothing in the cloud.">
        <code className="path" title={data?.dataDir}>{data?.dataDir ?? "…"}</code>
      </Row>
      <Row title="Daily backups" info="Once a day Milo saves a full copy of the database in a backups folder next to it. Old copies are kept.">
        <span className="muted">
          {backups ? (backups.backups.length ? `${backups.backups.length} kept · newest ${backups.backups[0].date}` : "None yet") : "…"}
        </span>
      </Row>
      <Row
        title="Second backup folder"
        info="Copies of the daily backups also go to a folder you choose, such as a USB stick or a folder that your own cloud app syncs. If the laptop breaks, the copies are still there."
      >
        <div className="inline">
          {backups?.mirrorDir ? <code className="path" title={backups.mirrorDir}>{backups.mirrorDir}</code> : <span className="muted">Not set</span>}
          <button className="btn small" disabled={!files.available} onClick={chooseMirror}>{backups?.mirrorDir ? "Change…" : "Choose folder…"}</button>
          {backups?.mirrorDir && (
            <button className="link" onClick={() => api.setBackupMirror(null).then(refresh, (e) => notify(String(e), true))}>Stop</button>
          )}
        </div>
      </Row>
      <Row
        title="Restore a backup"
        info="Puts Milo back to how it was on an earlier day. What you have now is saved as a backup first, so nothing is lost."
      >
        <button className="btn small" disabled={!files.available || !backups?.backups.length} onClick={() => setRestoring(true)}>Choose a backup…</button>
      </Row>
      <Row title="Export everything" info="One JSON file with all your data, archived items included, to keep or move elsewhere.">
        <button className="btn small" onClick={() => useUi.getState().setView("import")}>Go to Import &amp; export</button>
      </Row>
      {data && <p className="muted small">Milo {data.version}</p>}
      {restoring && backups && <RestoreDialog backups={backups.backups} onClose={() => { setRestoring(false); refresh(); }} />}
    </section>
  );
}

function RestoreDialog({ backups, onClose }: { backups: BackupFile[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [pick, setPick] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const restore = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const safety = await api.restoreBackup(pick.name);
      await qc.invalidateQueries();
      useUi.getState().notify({ text: `Restored the backup of ${pick.date}. Your data from just before is kept as ${safety}.` });
      onClose();
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose}>
      <h2>Restore a backup</h2>
      {!pick ? (
        <>
          <p className="muted small">Pick the day to go back to.</p>
          <ul className="rows restore-list">
            {backups.map((b) => (
              <li key={b.name} className="row">
                <span className="row-title">{b.date.startsWith("before-restore") ? `Just before a restore (${b.date.replace("before-restore-", "")})` : b.date}</span>
                <span className="muted small">{Math.max(1, Math.round(b.bytes / 1024))} KB</span>
                <button className="btn small" onClick={() => setPick(b)}>Choose</button>
              </li>
            ))}
          </ul>
          <div className="dialog-foot">
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p>
            Milo will look exactly like it did in the backup of <strong>{pick.date}</strong>. Changes made since then
            are saved as a separate backup first, so you can come back to them.
          </p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setPick(null)} disabled={busy}>Back</button>
            <span className="spacer" />
            <button className="btn primary" onClick={restore} disabled={busy}>{busy ? "Restoring…" : `Restore ${pick.date}`}</button>
          </div>
        </>
      )}
    </dialog>
  );
}

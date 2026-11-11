import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, files } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import {
  useActivities, useArchiveWithUndo, useImportSources, useSpaces, useTitleMappings, useUnmappedTitles,
} from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtRelativeDays, fmtTime, toDateInput } from "../../lib/time";
import type { Activity, CsvPreview, ImportSource, Space, SyncReport, TitleMapping } from "../../lib/types";

const notify = (text: string) => useUi.getState().notify({ text });

function describe(name: string, r: SyncReport) {
  const parts = [
    r.added && `${r.added} added`,
    r.updated && `${r.updated} updated`,
    r.removed && `${r.removed} archived`,
    r.kept && `${r.kept} kept as you changed them`,
    r.skipped && `${r.skipped} rows without a readable date skipped`,
  ].filter(Boolean);
  return `${name}: ${parts.length ? parts.join(", ") : "no changes"}`;
}

/** Everything import-related changes events and the title lists. */
function useRefresh() {
  const qc = useQueryClient();
  return () => ["events", "importSources", "unmappedTitles", "titleMappings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function lastSynced(s: ImportSource) {
  if (!s.lastSyncedAt) return "never synced";
  const d = new Date(s.lastSyncedAt);
  const n = daysFromToday(d);
  return `synced ${n === 0 ? `today at ${fmtTime(d)}` : fmtRelativeDays(n)}`;
}

export function ImportView() {
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);

  return (
    <main className="today full">
      <header className="toolbar">
        <h1>Import &amp; export</h1>
      </header>
      <div className="today-scroll">
        <CalendarLinks spaces={spaces} />
        <FileImport spaces={spaces} />
        <TitleLinks spaces={spaces} activities={activities} />
        <Export />
      </div>
    </main>
  );
}

function SpaceSelect({ spaces, value, onChange, label }: { spaces: Space[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <select aria-label={label ?? "Space"} value={value} onChange={(e) => onChange(e.target.value)}>
      {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function CalendarLinks({ spaces }: { spaces: Space[] }) {
  const sources = (useImportSources().data ?? []).filter((s) => s.kind === "ics_url");
  const refresh = useRefresh();
  const archive = useArchiveWithUndo();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const space = spaceId || spaces[0]?.id || "";

  const run = async (key: string, label: string, work: () => Promise<SyncReport>) => {
    setBusy(key);
    try {
      notify(describe(label, await work()));
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const add = () =>
    run("new", name.trim() || "Calendar", async () => {
      const report = await api.addCalendarLink({ name: name.trim() || "Calendar", location: url.trim(), spaceId: space, enabled: true });
      setName("");
      setUrl("");
      return report;
    });

  return (
    <section className="today-block">
      <h2>Calendar links</h2>
      <p className="muted small">
        A link to an .ics calendar, such as a school timetable or the secret iCal address of a Google calendar.
        Links sync when Milo starts and every {6} hours, and with "Sync now".
      </p>

      {sources.map((s) => (
        <div key={s.id} className="import-row">
          <div className="grow">
            <div className="name">{s.name}</div>
            <div className="muted small ellipsis" title={s.location}>{s.location}</div>
            <div className={`small ${s.lastError ? "late" : "muted"}`}>
              {s.lastError ? `Last sync failed: ${s.lastError}` : lastSynced(s)}
            </div>
          </div>
          <SpaceSelect
            spaces={spaces}
            label="Space for titles without a link"
            value={s.spaceId}
            onChange={(id) => api.updateImportSource(s.id, { name: s.name, location: s.location, spaceId: id, enabled: s.enabled }).then(refresh, notify)}
          />
          <button className="btn" disabled={busy !== null} onClick={() => run(s.id, s.name, () => api.syncCalendarLink(s.id))}>
            {busy === s.id ? "Syncing…" : "Sync now"}
          </button>
          <button className="link" onClick={() => archive("import_source", s.id, s.name)}>Archive</button>
        </div>
      ))}

      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input placeholder="School timetable" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Link</span>
          <input placeholder="https://… or webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Default space</span>
          <SpaceSelect spaces={spaces} value={space} onChange={setSpaceId} />
        </label>
        <button className="btn primary" type="submit" disabled={!url.trim() || !space || busy !== null}>
          {busy === "new" ? "Adding…" : "Add"}
        </button>
      </form>
      <p className="muted small">The default space is used for titles that have no title link yet.</p>
    </section>
  );
}

function FileImport({ spaces }: { spaces: Space[] }) {
  const refresh = useRefresh();
  const [spaceId, setSpaceId] = useState("");
  const [csv, setCsv] = useState<{ path: string; preview: CsvPreview; title: number; date: number } | null>(null);
  const space = spaceId || spaces[0]?.id || "";

  const report = async (label: string, work: Promise<SyncReport>) => {
    try {
      notify(describe(label, await work));
    } catch (e) {
      notify(String(e));
    } finally {
      refresh();
    }
  };

  const pickIcs = async () => {
    const path = await files.open("Calendar", ["ics", "ical"]).catch((e) => (notify(String(e)), null));
    if (path) report(baseName(path), api.importIcsFile(path, space));
  };

  const pickCsv = async () => {
    const path = await files.open("CSV", ["csv"]).catch((e) => (notify(String(e)), null));
    if (!path) return;
    try {
      const preview = await api.inspectCsv(path);
      setCsv({ path, preview, title: preview.titleColumn, date: preview.dateColumn });
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <section className="today-block">
      <h2>Import a file</h2>
      <p className="muted small">
        An .ics file, for example a Google Calendar export (Settings, Import &amp; export), or a CSV file exported from a
        Notion database. Importing the same file again updates the events instead of adding them twice.
      </p>
      <div className="inline">
        <span>Into</span>
        <SpaceSelect spaces={spaces} value={space} onChange={setSpaceId} label="Default space for the file" />
        <button className="btn" disabled={!files.available || !space} onClick={pickIcs}>Choose .ics file…</button>
        <button className="btn" disabled={!files.available || !space} onClick={pickCsv}>Choose CSV file…</button>
        {!files.available && <span className="muted small">Only in the desktop app.</span>}
      </div>

      {csv && (
        <div className="today-block">
          <div className="block-head">
            <h2>{baseName(csv.path)}</h2>
            <span className="spacer" />
            <button className="link" onClick={() => setCsv(null)}>Cancel</button>
          </div>
          <div className="inline">
            <label className="inline">
              <span>Title column</span>
              <select value={csv.title} onChange={(e) => setCsv({ ...csv, title: Number(e.target.value) })}>
                {csv.preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
            <label className="inline">
              <span>Date column</span>
              <select value={csv.date} onChange={(e) => setCsv({ ...csv, date: Number(e.target.value) })}>
                {csv.preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
          </div>
          <table className="preview">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {csv.preview.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r[csv.title]}</td>
                  <td>{r[csv.date]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">The other columns are kept in each event's notes. Rows without a readable date are skipped.</p>
          <div>
            <button
              className="btn primary"
              onClick={() => {
                const { path, title, date } = csv;
                setCsv(null);
                report(baseName(path), api.importCsv(path, title, date, space));
              }}
            >
              Import
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function TitleLinks({ spaces, activities }: { spaces: Space[]; activities: Activity[] }) {
  const unmapped = useUnmappedTitles().data ?? [];
  const mappings = useTitleMappings().data ?? [];
  const refresh = useRefresh();

  return (
    <section className="today-block">
      <h2>Title links</h2>
      <p className="muted small">
        Imported events with the same title always go to the same space and activity. Events you changed yourself are
        left as they are.
      </p>

      {unmapped.length > 0 && (
        <>
          <h2 className="sub">Titles without a link</h2>
          {unmapped.map((u) => (
            <NewLink key={u.title} title={u.title} count={u.count} spaces={spaces} activities={activities} onDone={refresh} />
          ))}
        </>
      )}

      {mappings.length > 0 && (
        <>
          <h2 className="sub">Links</h2>
          {mappings.map((m) => <LinkRow key={m.id} mapping={m} spaces={spaces} activities={activities} />)}
        </>
      )}

      {unmapped.length === 0 && mappings.length === 0 && <p className="muted">Links appear here after the first import.</p>}
    </section>
  );
}

function ActivitySelect({ activities, value, onChange }: { activities: Activity[]; value: string; onChange: (id: string) => void }) {
  return (
    <select aria-label="Activity" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No activity</option>
      {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function NewLink({ title, count, spaces, activities, onDone }: {
  title: string; count: number; spaces: Space[]; activities: Activity[]; onDone: () => void;
}) {
  const [spaceId, setSpaceId] = useState("");
  const [activityId, setActivityId] = useState(() => activities.find((a) => a.category === "class")?.id ?? "");
  return (
    <div className="import-row mapping-row">
      <span className="title ellipsis" title={title}>{title}</span>
      <span className="muted small">{count}×</span>
      <select aria-label="Space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
        <option value="">Choose a space…</option>
        {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ActivitySelect activities={activities} value={activityId} onChange={setActivityId} />
      <button
        className="btn"
        disabled={!spaceId}
        onClick={() =>
          api
            .createTitleMapping({ pattern: title, matchType: "exact", spaceId, activityId: activityId || null })
            .then(onDone, notify)
        }
      >
        Link
      </button>
    </div>
  );
}

function LinkRow({ mapping, spaces, activities }: { mapping: TitleMapping; spaces: Space[]; activities: Activity[] }) {
  const refresh = useRefresh();
  const archive = useArchiveWithUndo();
  const [pattern, setPattern] = useState(mapping.pattern);
  const space = spaces.find((s) => s.id === mapping.spaceId);
  const save = (patch: Partial<TitleMapping>) => {
    const { id, ...current } = mapping;
    api.updateTitleMapping(id, { ...current, ...patch }).then(refresh, notify);
  };
  return (
    <div className="import-row mapping-row" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
      <select aria-label="Match" value={mapping.matchType} onChange={(e) => save({ matchType: e.target.value as TitleMapping["matchType"] })}>
        <option value="exact">Title is</option>
        <option value="contains">Title contains</option>
      </select>
      <input
        className="title"
        aria-label="Title"
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        onBlur={() => (pattern.trim() ? pattern !== mapping.pattern && save({ pattern }) : setPattern(mapping.pattern))}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="swatch big-sq" />
      <SpaceSelect spaces={spaces} value={mapping.spaceId} onChange={(spaceId) => save({ spaceId })} />
      <ActivitySelect activities={activities} value={mapping.activityId ?? ""} onChange={(id) => save({ activityId: id || null })} />
      <button className="link" onClick={() => archive("title_mapping", mapping.id, `Link "${mapping.pattern}"`)}>Archive</button>
    </div>
  );
}

function Export() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const path = await files.save(`milo-export-${toDateInput(new Date())}.json`).catch((e) => (notify(String(e)), null));
    if (!path) return;
    setBusy(true);
    try {
      const rows = await api.exportAll(path);
      notify(`Exported ${rows} rows to ${baseName(path)}`);
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="today-block">
      <h2>Export</h2>
      <p className="muted small">
        One JSON file with everything in Milo, archived items included. Daily backups of the database are made
        automatically as well.
      </p>
      <div>
        <button className="btn" disabled={!files.available || busy} onClick={run}>{busy ? "Exporting…" : "Export all data…"}</button>
      </div>
    </section>
  );
}

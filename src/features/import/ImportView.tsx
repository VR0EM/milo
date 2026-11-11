import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, files } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { HelpTip } from "../../components/HelpTip";
import { Icon } from "../../components/Icon";
import {
  useActivities, useArchiveWithUndo, useImportSources, useSpaces, useTitleMappings, useUnmappedTitles,
} from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtRelativeDays, fmtTime, toDateInput } from "../../lib/time";
import type { Activity, CsvPreview, ImportSource, Space, SyncReport, TitleMapping } from "../../lib/types";

const notify = (text: string) => useUi.getState().notify({ text });
/** Errors stay on screen until dismissed. */
const fail = (e: unknown) => useUi.getState().notify({ text: String(e), error: true });

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
    <main className="page full">
      <header className="toolbar">
        <h1>Import &amp; export</h1>
      </header>
      <div className="page-scroll">
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

/** Only the site of a link: the rest often holds a personal key and is noise on screen. */
function host(url: string) {
  try {
    return new URL(url.replace(/^webcal:/i, "https:")).host;
  } catch {
    return url;
  }
}

function CalendarLinks({ spaces }: { spaces: Space[] }) {
  const sources = (useImportSources().data ?? []).filter((s) => s.kind === "ics_url");
  const refresh = useRefresh();
  const archive = useArchiveWithUndo();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [importAs, setImportAs] = useState<"events" | "tasks">("events");
  const [busy, setBusy] = useState<string | null>(null);
  const space = spaceId || spaces[0]?.id || "";

  const run = async (key: string, label: string, work: () => Promise<SyncReport>) => {
    setBusy(key);
    try {
      notify(describe(label, await work()));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const add = async () => {
    const ok = await run("new", name.trim() || "Calendar", () =>
      api.addCalendarLink({ name: name.trim() || "Calendar", location: url.trim(), spaceId: space, enabled: true, importAs }),
    );
    if (ok) {
      setName("");
      setUrl("");
      setAdding(false);
    }
  };

  return (
    <section className="block">
      <div className="block-head">
        <h2>
          Calendar links
          <HelpTip>
            A link to an online calendar (.ics), such as a school timetable or the secret iCal address of a Google calendar.
            Milo checks each link when it starts and every 6 hours, or when you press Sync. Choose "As tasks" for a
            list of deadlines (like hand-ins): each item becomes a task with that deadline, which you can tick off.
            If you change an imported item yourself, your version is kept.
          </HelpTip>
        </h2>
        <span className="spacer" />
        {!adding && <button className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={12} />Add link</button>}
      </div>

      {sources.length === 0 && !adding && <p className="muted">No calendar links yet.</p>}
      {sources.length > 0 && (
        <ul className="rows">
          {sources.map((s) => (
            <li key={s.id} className="row">
              <div className="row-main">
                <span className="row-title">{s.name}</span>
                <span className={`row-sub ${s.lastError ? "late" : ""}`} title={s.lastError ?? s.location}>
                  {host(s.location)} · {s.lastError ? "last sync failed" : lastSynced(s)}
                </span>
              </div>
              <SpaceSelect
                spaces={spaces}
                label={`Space for ${s.name}`}
                value={s.spaceId}
                onChange={(id) => api.updateImportSource(s.id, { name: s.name, location: s.location, spaceId: id, enabled: s.enabled, importAs: s.importAs }).then(refresh, fail)}
              />
              <select
                aria-label={`Bring ${s.name} in as`}
                title="Events go in the calendar; tasks get a deadline in Tasks"
                value={s.importAs}
                disabled={busy !== null}
                onChange={(e) => {
                  const next = e.target.value as "events" | "tasks";
                  run(s.id, s.name, async () => {
                    await api.updateImportSource(s.id, { name: s.name, location: s.location, spaceId: s.spaceId, enabled: s.enabled, importAs: next });
                    return api.syncCalendarLink(s.id);
                  });
                }}
              >
                <option value="events">As events</option>
                <option value="tasks">As tasks</option>
              </select>
              <button className="btn small" disabled={busy !== null} onClick={() => run(s.id, s.name, () => api.syncCalendarLink(s.id))}>
                {busy === s.id ? "Syncing…" : "Sync"}
              </button>
              <button className="link" onClick={() => archive("import_source", s.id, s.name)}>Archive</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          className="add-link"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add();
          }}
        >
          <input autoFocus placeholder="Name, e.g. Timetable" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="https://… or webcal://…" aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} />
          <SpaceSelect spaces={spaces} value={space} onChange={setSpaceId} label="Space for new items" />
          <select aria-label="Bring it in as" value={importAs} onChange={(e) => setImportAs(e.target.value as "events" | "tasks")}>
            <option value="events">As events</option>
            <option value="tasks">As tasks</option>
          </select>
          <button className="btn primary small" type="submit" disabled={!url.trim() || !space || busy !== null}>{busy === "new" ? "Adding…" : "Add"}</button>
          <button className="link" type="button" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
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
      fail(e);
    } finally {
      refresh();
    }
  };

  const pickIcs = async () => {
    const path = await files.open("Calendar", ["ics", "ical"]).catch((e) => (fail(e), null));
    if (path) report(baseName(path), api.importIcsFile(path, space));
  };

  const pickCsv = async () => {
    const path = await files.open("CSV", ["csv"]).catch((e) => (fail(e), null));
    if (!path) return;
    try {
      const preview = await api.inspectCsv(path);
      setCsv({ path, preview, title: preview.titleColumn, date: preview.dateColumn });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <section className="block">
      <div className="block-head">
        <h2>
          Import a file
          <HelpTip>
            An .ics file, for example exported from Google Calendar (Settings, Import &amp; export), or a CSV file exported
            from a Notion database. Importing the same file again updates its events instead of adding them twice.
          </HelpTip>
        </h2>
      </div>
      <div className="inline">
        <button className="btn" disabled={!files.available || !space} onClick={pickIcs}>Calendar file (.ics)…</button>
        <button className="btn" disabled={!files.available || !space} onClick={pickCsv}>Notion export (.csv)…</button>
        <span className="muted">into</span>
        <SpaceSelect spaces={spaces} value={space} onChange={setSpaceId} label="Space for the imported events" />
        {!files.available && <span className="muted small">Only in the desktop app.</span>}
      </div>

      {csv && (
        <div className="block">
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
          <p className="muted small">Other columns go into each event's notes.</p>
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
  const [reviewing, setReviewing] = useState(false);
  const [rule, setRule] = useState(false);

  return (
    <section className="block">
      <div className="block-head">
        <h2>
          Title links
          <HelpTip>
            Tell Milo where imported events belong, by their title. "Title is" matches one exact title; "Title contains"
            matches every title with those words, for example "ingeleverd" for all hand-in deadlines. Events you changed
            yourself are left as they are.
          </HelpTip>
        </h2>
        <span className="spacer" />
        {!rule && <button className="btn small" onClick={() => setRule(true)}><Icon name="plus" size={12} />Add link</button>}
      </div>

      {rule && <NewRule spaces={spaces} activities={activities} onDone={() => { setRule(false); refresh(); }} />}

      {unmapped.length > 0 && (
        <div className="callout">
          <span>
            {unmapped.length} imported {unmapped.length === 1 ? "title has" : "titles have"} no link yet and use the calendar's own space.
          </span>
          <button className="link" onClick={() => setReviewing(!reviewing)}>{reviewing ? "Hide" : "Review"}</button>
        </div>
      )}
      {reviewing && (
        <ul className="rows">
          {unmapped.map((u) => (
            <NewLink key={u.title} title={u.title} count={u.count} spaces={spaces} activities={activities} onDone={refresh} />
          ))}
        </ul>
      )}

      {mappings.length > 0 && (
        <ul className="rows">
          {mappings.map((m) => <LinkRow key={m.id} mapping={m} spaces={spaces} activities={activities} />)}
        </ul>
      )}
      {mappings.length === 0 && unmapped.length === 0 && !rule && <p className="muted">No links yet.</p>}
    </section>
  );
}

function NewRule({ spaces, activities, onDone }: { spaces: Space[]; activities: Activity[]; onDone: () => void }) {
  const [pattern, setPattern] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [activityId, setActivityId] = useState("");
  return (
    <form
      className="add-link"
      onSubmit={(e) => {
        e.preventDefault();
        api.createTitleMapping({ pattern, matchType: "contains", spaceId, activityId: activityId || null }).then(onDone, fail);
      }}
    >
      <span className="muted">Title contains</span>
      <input autoFocus placeholder="e.g. ingeleverd" aria-label="Words in the title" value={pattern} onChange={(e) => setPattern(e.target.value)} />
      <select aria-label="Space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
        <option value="">Choose a space…</option>
        {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ActivitySelect activities={activities} value={activityId} onChange={setActivityId} />
      <button className="btn primary small" type="submit" disabled={!pattern.trim() || !spaceId}>Add</button>
      <button className="link" type="button" onClick={onDone}>Cancel</button>
    </form>
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
  const [activityId, setActivityId] = useState("");
  return (
    <li className="row mapping-row">
      <span className="row-title ellipsis" title={title}>{title}</span>
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
            .then(onDone, fail)
        }
      >
        Link
      </button>
    </li>
  );
}

function LinkRow({ mapping, spaces, activities }: { mapping: TitleMapping; spaces: Space[]; activities: Activity[] }) {
  const refresh = useRefresh();
  const archive = useArchiveWithUndo();
  const [pattern, setPattern] = useState(mapping.pattern);
  const space = spaces.find((s) => s.id === mapping.spaceId);
  const save = (patch: Partial<TitleMapping>) => {
    const { id, ...current } = mapping;
    api.updateTitleMapping(id, { ...current, ...patch }).then(refresh, fail);
  };
  return (
    <li className="row mapping-row" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
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
    </li>
  );
}

function Export() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const path = await files.save(`milo-export-${toDateInput(new Date())}.json`).catch((e) => (fail(e), null));
    if (!path) return;
    setBusy(true);
    try {
      const rows = await api.exportAll(path);
      notify(`Exported ${rows} rows to ${baseName(path)}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="block">
      <div className="block-head">
        <h2>
          Export
          <HelpTip>One JSON file with everything in Milo, archived items included. Daily backups are made automatically as well.</HelpTip>
        </h2>
        <span className="spacer" />
        <button className="btn small" disabled={!files.available || busy} onClick={run}>{busy ? "Exporting…" : "Export all data…"}</button>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtMoment, fmtRelativeDays } from "../../lib/time";
import type { ArchivedItem, Entity } from "../../lib/types";

const KIND: Record<Entity, string> = {
  event: "Event",
  task: "Task",
  task_part: "Task part",
  space: "Space",
  group: "Group",
  activity: "Activity",
  task_type: "Task type",
  routine: "Routine",
  routine_item: "Routine step",
  reminder_rule: "Reminder",
  import_source: "Calendar",
  title_mapping: "Title link",
  semester: "Semester",
};

/** Midnight means a whole day (all-day events, date-only deadlines): show only the date. */
function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (d.getHours() || d.getMinutes()) return fmtMoment(d);
  // fmtMoment leaves out the time for the last minute of a day.
  return fmtMoment(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59));
}

function archivedWhen(iso: string) {
  const n = daysFromToday(new Date(iso));
  return `archived ${fmtRelativeDays(n)}`;
}

/** The archive, shown as a part of Settings. */
export function ArchiveSettings() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Entity | "">("");
  const qc = useQueryClient();

  // Wait until typing pauses before searching.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 200);
    return () => clearTimeout(t);
  }, [text]);

  const { data } = useQuery({
    queryKey: ["archive", query],
    queryFn: () => api.listArchived(query),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const items = data?.items ?? [];
  const kinds = [...new Set(items.map((i) => i.entity))];
  const shown = kind ? items.filter((i) => i.entity === kind) : items;

  // One row at a time asks "Delete for good?" in place; nothing goes on the first click.
  const [asking, setAsking] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const keep = useQuery({ queryKey: ["archiveKeep"], queryFn: api.archiveKeepSetting });

  const forget = async (item: ArchivedItem) => {
    setAsking(null);
    try {
      await api.deleteForever(item.entity, item.id);
      await qc.invalidateQueries({ queryKey: ["archive"] });
      useUi.getState().notify({ text: `${item.label || KIND[item.entity]} deleted for good` });
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
    }
  };

  const emptyAll = async () => {
    setEmptying(false);
    try {
      const n = await api.emptyArchive();
      await qc.invalidateQueries({ queryKey: ["archive"] });
      useUi.getState().notify({ text: n === 1 ? "1 item deleted for good" : `${n} items deleted for good` });
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
    }
  };

  const restore = async (item: ArchivedItem) => {
    try {
      await api.setArchived(item.entity, item.id, false);
      // A restored item can show up on any screen, so refresh everything.
      await qc.invalidateQueries();
      useUi.getState().notify({ text: `${item.label || KIND[item.entity]} restored` });
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
    }
  };

  return (
    <div className="sub-blocks">
        <div className="archive-keep">
          <label className="inline">
            <span>Delete archived items for good after</span>
            <select
              aria-label="Delete archived items for good after"
              value={keep.data ?? ""}
              onChange={async (e) => {
                await api.setArchiveKeepSetting(e.target.value ? Number(e.target.value) : null);
                qc.invalidateQueries({ queryKey: ["archiveKeep"] });
              }}
            >
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">3 months</option>
              <option value="365">1 year</option>
            </select>
          </label>
          <span className="spacer" />
          {emptying ? (
            <span className="inline confirm">
              <span>Delete everything here for good? A backup of today stays.</span>
              <button className="btn small danger" onClick={emptyAll}>Delete</button>
              <button className="btn small" onClick={() => setEmptying(false)}>Keep</button>
            </span>
          ) : (
            <button className="link" disabled={items.length === 0} onClick={() => setEmptying(true)}>Empty the archive…</button>
          )}
        </div>
        <div className="inline">
          <input className="search" type="search" placeholder="Search by name" aria-label="Search the archive" value={text} onChange={(e) => setText(e.target.value)} />
          <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value as Entity | "")}>
            <option value="">Everything</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
          </select>
          <span className="muted small">{shown.length} {shown.length === 1 ? "item" : "items"}</span>
        </div>

        <div className="archive-list">
          {shown.length === 0 && <p className="muted">{query ? "Nothing archived matches that name." : "Nothing is archived."}</p>}
          {shown.map((item) => (
            <div key={`${item.entity}-${item.id}`} className="archive-row">
              <span className="archive-kind">{KIND[item.entity]}</span>
              <div className="archive-main">
                <div className="label ellipsis">{item.label || "Untitled"}</div>
                <div className="muted small ellipsis">
                  {[
                    item.context,
                    item.when && fmtWhen(item.when),
                    item.removedBySync ? "removed from its imported calendar" : archivedWhen(item.archivedAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {asking === `${item.entity}-${item.id}` ? (
                <span className="inline confirm">
                  <span className="small">Delete for good?</span>
                  <button className="btn small danger" onClick={() => forget(item)}>Delete</button>
                  <button className="btn small" onClick={() => setAsking(null)}>Keep</button>
                </span>
              ) : (
                <>
                  <button className="link" onClick={() => setAsking(`${item.entity}-${item.id}`)}>Delete…</button>
                  <button className="btn" onClick={() => restore(item)}>Restore</button>
                </>
              )}
            </div>
          ))}
          {data && data.hiddenEvents > 0 && (
            <p className="muted small">
              {data.hiddenEvents} older archived events are not listed. Search by name to find them.
            </p>
          )}
        </div>
    </div>
  );
}

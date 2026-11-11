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

export function ArchiveView() {
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
    <main className="page full">
      <header className="toolbar">
        <h1>Archive</h1>
      </header>
      <div className="page-scroll">
        <p className="muted">
          Nothing in Milo is ever deleted. Everything you archive stays here, and can be brought back.
        </p>
        <div className="inline">
          <input className="search" type="search" placeholder="Search by name" aria-label="Search the archive" value={text} onChange={(e) => setText(e.target.value)} />
          <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value as Entity | "")}>
            <option value="">Everything</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
          </select>
          <span className="muted small">{shown.length} {shown.length === 1 ? "item" : "items"}</span>
        </div>

        <section className="block">
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
              <button className="btn" onClick={() => restore(item)}>Restore</button>
            </div>
          ))}
          {data && data.hiddenEvents > 0 && (
            <p className="muted small">
              {data.hiddenEvents} older archived events are not listed. Search by name to find them.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

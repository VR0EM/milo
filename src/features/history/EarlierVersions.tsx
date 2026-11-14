import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useActivities, useSpaces, useTaskTypes } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtTime } from "../../lib/time";
import type { CalEvent, Change, Task } from "../../lib/types";

const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const when = (iso: string) => {
  const d = new Date(iso);
  const n = daysFromToday(d);
  return `${n === 0 ? "Today" : n === -1 ? "Yesterday" : day.format(d)} ${fmtTime(d)}`;
};
const moment = (iso: unknown) => (typeof iso === "string" && iso ? `${day.format(new Date(iso))} ${fmtTime(new Date(iso))}` : "none");

type Names = { space: (id: unknown) => string; activity: (id: unknown) => string; type: (id: unknown) => string };

/** What an earlier version had that the item has not now, in a few words. */
function differences(entity: "event" | "task", was: Record<string, unknown>, now: Record<string, unknown>, names: Names): string[] {
  const out: string[] = [];
  const changed = (k: string) => (was[k] ?? null) !== (now[k] ?? null);
  if (changed("title")) out.push(`title “${String(was.title || "Untitled")}”`);
  if (entity === "event") {
    if (changed("startAt") || changed("endAt") || changed("allDay")) {
      const s = new Date(String(was.startAt));
      out.push(was.allDay ? `all day ${day.format(s)}` : `${day.format(s)} ${fmtTime(s)} – ${fmtTime(new Date(String(was.endAt)))}`);
    }
    if (changed("activityId")) out.push(`activity ${names.activity(was.activityId)}`);
    if (changed("status")) out.push(was.status === "skipped" ? "marked as did not happen" : "not marked as did not happen");
  } else {
    if (changed("deadlineAt")) out.push(`deadline ${moment(was.deadlineAt)}`);
    if (changed("targetAt")) out.push(`aim ${moment(was.targetAt)}`);
    if (changed("priority")) out.push(`priority ${was.priority ?? "none"}`);
    if (changed("typeId")) out.push(`type ${names.type(was.typeId)}`);
  }
  if (changed("spaceId")) out.push(`space ${names.space(was.spaceId)}`);
  if (changed("notes")) out.push(String(was.notes) ? "other notes" : "no notes");
  return out;
}

/** "Earlier versions" at the bottom of a panel: each edit can be put back. */
export function EarlierVersions({ entity, item }: { entity: "event" | "task"; item: CalEvent | Task }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const spaces = useSpaces().data ?? [];
  const activities = useActivities().data ?? [];
  const types = useTaskTypes().data ?? [];
  // The list is fetched again whenever the item itself changes.
  const changes = useQuery({
    queryKey: ["changes", entity, item.id, JSON.stringify(item)],
    queryFn: () => api.listChanges(entity, item.id),
    staleTime: 0,
  }).data ?? [];
  const names: Names = {
    space: (id) => spaces.find((s) => s.id === id)?.name ?? "none",
    activity: (id) => activities.find((a) => a.id === id)?.name ?? "none",
    type: (id) => types.find((t) => t.id === id)?.name ?? "none",
  };
  const current = item as unknown as Record<string, unknown>;
  const rows = changes
    .map((c) => ({ c, diff: differences(entity, c.snapshot, current, names) }))
    .filter((r) => r.diff.length > 0);
  if (rows.length === 0) return null;

  const restore = async (c: Change) => {
    try {
      await api.restoreChange(c.id);
      await qc.invalidateQueries({ queryKey: [entity === "event" ? "events" : "tasks"] });
      qc.invalidateQueries({ queryKey: ["changes"] });
      useUi.getState().notify({ text: `Put back as it was ${when(c.createdAt).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}. The version before is kept too.` });
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
    }
  };

  return (
    <div className="versions">
      <button type="button" className="link versions-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Earlier versions ({rows.length})
      </button>
      {open && (
        <ul>
          {rows.map(({ c, diff }) => (
            <li key={c.id} className="version-row">
              <div className="version-text">
                <span className="version-when">{when(c.createdAt)}</span>
                <span className="muted small">{diff.join(" · ")}</span>
              </div>
              <button type="button" className="btn small" onClick={() => restore(c)}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Browser-only stand-in for the Rust commands (development preview). Not used in the app.
// Data lives in memory for the lifetime of the page.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SystemOne, normalize, sameThing } from "./systemOne";
type Row = Record<string, any>;

const ts = () => new Date().toISOString();
const base = (id: string, sortOrder: number) => ({ id, sortOrder, createdAt: ts(), updatedAt: ts(), deletedAt: null });

/** Settings › Next event in the menu bar (kept in memory, like everything here). */
let menubarOn = true;
/** Settings › Archive: delete archived items for good after this many days (null = never). */
let archiveKeep: number | null = null;
const tables: Record<string, Row[]> = {
  group: [{ ...base("seed-group-school", 0), name: "School" }],
  space: [
    { ...base("seed-space-inbox", -1), groupId: null, name: "Inbox", color: "gray", role: "normal", kind: "inbox", icon: null },
    { ...base("seed-space-personal", 0), groupId: null, name: "Personal", color: "blue", role: "normal", kind: "list", icon: "home" },
    { ...base("seed-space-sleep", 1), groupId: null, name: "Sleep", color: "purple", role: "sleep", kind: "none", icon: "moon" },
    { ...base("seed-space-transport", 2), groupId: null, name: "Transport", color: "gray", role: "normal", kind: "none", icon: "bus" },
  ],
  activity: [
    { ...base("seed-activity-class", 0), name: "Class", category: "class" },
    { ...base("seed-activity-study", 1), name: "Study", category: "self_study" },
    { ...base("seed-activity-lab", 2), name: "Lab", category: "class" },
    { ...base("seed-activity-exam", 3), name: "Exam", category: "other" },
  ],
  event: [],
  series: [],
  change: [],
  section: [],
  task_type: [
    { ...base("seed-type-assignment", 0), name: "Assignment", spaceId: null },
    { ...base("seed-type-theory", 1), name: "Theory", spaceId: null },
    { ...base("seed-type-lab", 2), name: "Lab", spaceId: null },
  ],
  task: [],
  task_part: [],
  routine: [
    { ...base("seed-routine-morning", 0), name: "Morning", startTime: "07:00", endTime: "10:00", weekdays: "1234567" },
    { ...base("seed-routine-evening", 1), name: "Evening", startTime: "21:00", endTime: "23:30", weekdays: "1234567" },
  ],
  routine_item: [],
  focus: [],
  title_mapping: [],
  semester: [],
  reminder_rule: [
    { ...base("seed-reminder-events", 0), kind: "event", title: "Events", enabled: true, minutesBefore: 10, times: null, weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null, askConfirm: false },
    { ...base("seed-reminder-medication", 1), kind: "times", title: "Medication", enabled: false, minutesBefore: null, times: "08:00", weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null, askConfirm: true },
    { ...base("seed-reminder-water", 2), kind: "interval", title: "Water", enabled: false, minutesBefore: null, times: null, weekdays: "1234567", intervalMinutes: 90, startTime: "09:00", endTime: "21:00", askConfirm: false },
    { ...base("seed-reminder-focus", 3), kind: "focus", title: "Focus sessions", enabled: true, minutesBefore: null, times: null, weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null, askConfirm: false },
  ],
};
const checks = new Set<string>();
const confirmed = new Map<string, string>();

const routineView = (id: string): Row => {
  const r = tables.routine.find((x) => x.id === id);
  if (!r) throw "Not found";
  return { ...r, items: tables.routine_item.filter((i) => i.routineId === id && !i.deletedAt).map((i) => ({ ...i })) };
};

const taskView = (id: string): Row => {
  const t = tables.task.find((r) => r.id === id);
  if (!t) throw "Not found";
  return { ...t, parts: tables.task_part.filter((p) => p.taskId === id && !p.deletedAt).map((p) => ({ ...p })) };
};

function syncTask(taskId: string) {
  const parts = tables.task_part.filter((p) => p.taskId === taskId && !p.deletedAt);
  if (!parts.length) return;
  const t = tables.task.find((r) => r.id === taskId)!;
  const all = parts.every((p) => p.doneAt);
  if (all && !t.completedAt) t.completedAt = ts();
  if (!all) t.completedAt = null;
}

function create(table: string, input: Row, extra: Row = {}): Row {
  if ("name" in input && !String(input.name).trim()) throw "Name cannot be empty";
  const row = { ...base(crypto.randomUUID(), tables[table].length), ...input, ...extra };
  tables[table].push(row);
  return { ...row };
}

function update(table: string, id: string, input: Row): Row {
  const row = tables[table].find((r) => r.id === id);
  if (!row) throw "Not found";
  if ("name" in input && !String(input.name).trim()) throw "Name cannot be empty";
  Object.assign(row, input, { updatedAt: ts() });
  return { ...row };
}

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Browser stand-in for series.rs: same rules, written out half a year ahead. */
function setRepeat(id: string, rule: Row | null): Row {
  const e = tables.event.find((r) => r.id === id);
  if (!e) throw "Not found";
  if (e.source === "import") throw "Imported events repeat in the calendar they come from";
  const cut = e.startAt > ts() ? e.startAt : ts();
  if (e.seriesId) {
    // Untouched future occurrences go; edited ones are set aside (as in series.rs).
    const later = tables.event.filter((r) => r.seriesId === e.seriesId && !r.deletedAt && r.startAt > cut && r.id !== e.id);
    later.forEach((r) => {
      if (r.updatedAt === r.createdAt) tables.event.splice(tables.event.indexOf(r), 1);
      else Object.assign(r, { deletedAt: ts(), replaced: true });
    });
    const old = tables.series.find((r) => r.id === e.seriesId);
    if (old) old.rule = { ...old.rule, untilDate: dateKey(new Date(cut)) };
  }
  if (!rule) { e.seriesId = null; return { ...e }; }
  const start = new Date(e.startAt);
  const length = new Date(e.endAt).getTime() - start.getTime();
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const series = create("series", { rule, firstDate: dateKey(first) });
  e.seriesId = series.id;
  const until = rule.untilDate ? new Date(`${rule.untilDate}T23:59`) : new Date(Date.now() + 180 * 86_400_000);
  const days = rule.weekdays ? String(rule.weekdays).split("").map(Number) : [((first.getDay() + 6) % 7) + 1];
  const week0 = new Date(first); week0.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  for (let d = new Date(first); d <= until; d.setDate(d.getDate() + 1)) {
    const diff = Math.round((d.getTime() - first.getTime()) / 86_400_000);
    const on =
      rule.freq === "daily" ? diff % rule.interval === 0
      : rule.freq === "weekly" ? days.includes(((d.getDay() + 6) % 7) + 1) && Math.floor(Math.round((d.getTime() - week0.getTime()) / 86_400_000) / 7) % rule.interval === 0
      : d.getDate() === first.getDate() && ((d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth()) % rule.interval === 0;
    if (!on) continue;
    const s = e.allDay ? new Date(d) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), start.getHours(), start.getMinutes());
    if (s.toISOString() <= cut) continue;
    create("event", {
      spaceId: e.spaceId, activityId: e.activityId, title: e.title, startAt: s.toISOString(),
      endAt: new Date(s.getTime() + length).toISOString(), allDay: e.allDay, notes: e.notes, status: "planned", taskId: null,
    }, { source: "manual", sourceId: null, locallyModified: false, seriesId: series.id });
  }
  return { ...e };
}

/** Browser stand-in for history.rs: keeps the old version, one per two minutes of edits. */
function remember(entity: string, id: string, input: Row) {
  const row = tables[entity].find((r) => r.id === id);
  if (!row) return;
  // Changing an item right after making it (naming a new event) keeps no version.
  if (Date.now() - new Date(row.createdAt).getTime() < 120_000) return;
  if (Object.keys(input).every((k) => row[k] === input[k] || (row[k] ?? null) === (input[k] ?? null))) return;
  const last = tables.change.filter((c) => c.entity === entity && c.entityId === id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  if (last && Date.now() - new Date(last.createdAt).getTime() < 120_000) return;
  tables.change.push({ ...base(crypto.randomUUID(), 0), entity, entityId: id, snapshot: { ...row } });
}

/** A section only counts in its own space (as section_in in repo.rs). */
function sectionIn(input: Row): string | null {
  const sec = input.sectionId && tables.section.find((r) => r.id === input.sectionId);
  return sec && sec.spaceId === input.spaceId ? sec.id : null;
}

function checkEvent(input: Row) {
  if (input.endAt <= input.startAt) throw "An event must end after it starts";
}

export async function mockInvoke<T>(cmd: string, a: Row): Promise<T> {
  const out = ((): unknown => {
    switch (cmd) {
      case "list_groups": return tables.group.map((r) => ({ ...r })).sort((x, y) => x.sortOrder - y.sortOrder);
      case "reorder_groups": {
        const ids = (a.ids as string[]).filter((id) => tables.group.some((r) => r.id === id));
        const order = [...ids, ...tables.group.map((r) => r.id).filter((id) => !ids.includes(id))];
        order.forEach((id, i) => { tables.group.find((r) => r.id === id)!.sortOrder = i; });
        return null;
      }
      case "move_space": {
        if (a.groupId && !tables.group.some((r) => r.id === a.groupId && !r.deletedAt)) throw "That group does not exist";
        tables.space.find((r) => r.id === a.id)!.groupId = a.groupId ?? null;
        return mockInvoke("reorder_spaces", { ids: a.ids });
      }
      case "list_spaces": return tables.space.map((r): Row => ({ icon: null, kind: "list", ...r })).sort((x, y) => x.sortOrder - y.sortOrder);
      case "reorder_spaces": {
        // Same as repo::reorder_spaces: the named spaces swap among their own places, then all
        // spaces are numbered again, so lists never collide.
        const all = tables.space.filter((r) => r.kind !== "inbox").sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
        const moved = (a.ids as string[]).filter((id) => all.some((r) => r.id === id));
        const slots = all.map((r, i) => (moved.includes(r.id) ? i : -1)).filter((i) => i >= 0);
        const order = all.map((r) => r.id);
        slots.forEach((slot, n) => { order[slot] = moved[n]; });
        order.forEach((id, i) => { tables.space.find((r) => r.id === id)!.sortOrder = i; });
        return null;
      }
      case "list_activities": return tables.activity.map((r) => ({ ...r }));
      case "create_group": return create("group", a.input);
      case "update_group": return update("group", a.id, a.input);
      case "create_space": {
        const kind = a.input.kind ?? "list";
        if (!["project", "list", "none"].includes(kind)) throw `Unknown kind: ${kind}`;
        return create("space", { ...a.input, kind });
      }
      case "update_space": {
        const row = tables.space.find((r) => r.id === a.id);
        const kind = row?.kind === "inbox" ? "inbox" : (a.input.kind ?? row?.kind ?? "list");
        return update("space", a.id, { ...a.input, kind });
      }
      case "suggest_spaces": {
        // As suggest.rs without the model: words learned from her titles, never sure.
        const spaces = tables.space.filter((s) => !s.deletedAt && (a.forEvents ? s.kind !== "inbox" : s.kind === "project" || s.kind === "list"));
        const ids = spaces.map((s) => s.id);
        const model = new SystemOne([
          ...spaces.map((s) => ({ text: s.name, label: s.id, weight: 3 })),
          ...tables.section.filter((x) => !x.deletedAt && ids.includes(x.spaceId)).map((x) => ({ text: x.name, label: x.spaceId })),
          ...[...tables.task, ...tables.event].filter((t) => !t.deletedAt && t.title && ids.includes(t.spaceId)).map((t) => ({ text: t.title, label: t.spaceId })),
        ], { threshold: 0 });
        return (a.texts as string[]).map((text) => {
          const d = model.decide(text, ids);
          if (!d.ranked.length) return { choices: [], sure: false, why: null };
          return { choices: d.ranked.slice(0, 3).map((r) => ({ spaceId: r.label, p: r.p })), sure: false, why: d.why.length ? `“${d.why.join("”, “")}” before` : null };
        });
      }
      case "suggest_in_space": {
        const labels = a.what === "section"
          ? tables.section.filter((x) => !x.deletedAt && x.spaceId === a.spaceId)
          : tables.task_type.filter((x) => !x.deletedAt && (!x.spaceId || x.spaceId === a.spaceId));
        const key = a.what === "section" ? "sectionId" : "typeId";
        const ids = labels.map((l) => l.id);
        const model = new SystemOne([
          ...labels.map((l) => ({ text: l.name, label: l.id })),
          ...tables.task.filter((t) => !t.deletedAt && t.title && ids.includes(t[key]) && (a.what === "type" || t.spaceId === a.spaceId)).map((t) => ({ text: t.title, label: t[key] })),
        ], { threshold: 0 });
        return (a.texts as string[]).map((text) => {
          const d = model.decide(text, ids);
          return { choices: d.ranked.slice(0, 3).map((r) => ({ spaceId: r.label, p: r.p })), sure: false, why: null };
        });
      }
      case "search": {
        // As search.rs: every word somewhere; repeats of one event as one result.
        const words = normalize(String(a.query)).split(" ").filter(Boolean);
        if (!words.length) return { events: [], tasks: [] };
        const now = ts();
        const spaceName = (id: string) => tables.space.find((s) => s.id === id)?.name ?? "";
        const has = (hay: string) => words.every((w) => hay.includes(w));
        const groups = new Map<string, Row>();
        for (const e of tables.event.filter((x) => !x.deletedAt)) {
          const t = normalize(e.title);
          if (!has(`${t} ${normalize(e.notes ?? "")} ${normalize(e.location ?? "")} ${normalize(spaceName(e.spaceId))}`)) continue;
          const key = `${t}|${e.spaceId}`;
          const g = groups.get(key) ?? { title: e.title, spaceId: e.spaceId, location: "", count: 0, last: null, next: null, inTitle: false };
          groups.set(key, g);
          g.count++;
          g.inTitle ||= has(t);
          const when = { eventId: e.id, startAt: e.startAt, allDay: e.allDay };
          if (e.startAt <= now) { if (!g.last || e.startAt > g.last.startAt) { g.last = when; g.location = e.location || g.location; } }
          else if (!g.next || e.startAt < g.next.startAt) { g.next = when; g.location = e.location || g.location; }
        }
        const events = [...groups.values()].sort((x, y) =>
          Number(y.inTitle) - Number(x.inTitle) || Number(!x.next) - Number(!y.next) ||
          (x.next ? x.next.startAt.localeCompare(y.next.startAt) : (y.last?.startAt ?? "").localeCompare(x.last?.startAt ?? "")));
        const tasks = tables.task.filter((t) => !t.deletedAt).filter((t) => {
          const steps = tables.task_part.filter((p) => p.taskId === t.id && !p.deletedAt).map((p) => p.title).join(" ");
          return has(`${normalize(t.title)} ${normalize(t.notes ?? "")} ${normalize(spaceName(t.spaceId))} ${normalize(steps)}`);
        }).map((t) => ({ id: t.id, title: t.title, spaceId: t.spaceId, deadlineAt: t.deadlineAt, completedAt: t.completedAt, inTitle: has(normalize(t.title)) }))
          .sort((x, y) => Number(y.inTitle) - Number(x.inTitle) || Number(!!x.completedAt) - Number(!!y.completedAt) || (x.deadlineAt ?? "9999").localeCompare(y.deadlineAt ?? "9999"));
        return { events: events.slice(0, 100), tasks: tasks.slice(0, 100) };
      }
      case "similar_todos": {
        const open = tables.task.filter((t) => !t.deletedAt && !t.completedAt && t.title);
        return (a.items as [string, string][]).map(([id, text]) => {
          const hit = open.find((t) => t.id !== id && sameThing(text, t.title));
          return hit ? { taskId: hit.id, title: hit.title, spaceId: hit.spaceId } : null;
        });
      }
      case "smart_model_status": return { installed: false, downloading: false, bytes: 82_661_403 };
      case "download_smart_model": case "remove_smart_model": throw "The suggestion model only works in the desktop app";
      case "list_sections": return tables.section.filter((r) => !r.deletedAt).sort((x, y) => x.sortOrder - y.sortOrder).map((r) => ({ ...r }));
      case "create_section": return create("section", { spaceId: a.spaceId, name: String(a.name).trim() });
      case "update_section": return update("section", a.id, { name: String(a.name).trim() });
      case "reorder_sections": (a.ids as string[]).forEach((id, i) => { const r = tables.section.find((x) => x.id === id); if (r) r.sortOrder = i; }); return null;
      case "create_activity": return create("activity", a.input);
      case "update_activity": return update("activity", a.id, a.input);
      case "event_by_id": return tables.event.filter((e) => e.id === a.id && !e.deletedAt).map((e) => ({ ...e }));
      case "list_events":
        return tables.event
          .filter((e) => !e.deletedAt && e.startAt < a.to && e.endAt > a.from)
          .sort((x, y) => x.startAt.localeCompare(y.startAt))
          .map((r) => ({ ...r }));
      case "create_event": checkEvent(a.input); return create("event", { taskId: null, location: "", ...a.input }, { source: "manual", sourceId: null, locallyModified: false, seriesId: null });
      case "update_event": checkEvent(a.input); remember("event", a.id, a.input); return update("event", a.id, a.input);
      case "list_task_types": return tables.task_type.map((r) => ({ ...r }));
      case "create_task_type": return create("task_type", a.input);
      case "update_task_type": return update("task_type", a.id, a.input);
      case "list_tasks": return tables.task.filter((t) => !t.deletedAt).map((t) => taskView(t.id));
      case "create_task": return taskView(create("task", { ...a.input, sectionId: sectionIn(a.input) }, { completedAt: null, sourceId: null, locallyModified: false, todayOn: null }).id);
      case "update_task": {
        const input = { ...a.input, sectionId: sectionIn(a.input) };
        remember("task", a.id, input);
        return taskView(update("task", a.id, input).id);
      }
      case "set_task_today":
        if (a.day && !/^\d{4}-\d{2}-\d{2}$/.test(a.day)) throw `Not a date: ${a.day}`;
        return taskView(update("task", a.id, { todayOn: a.day ?? null }).id);
      case "set_task_completed":
        if (taskView(a.id).parts.length) throw "This task is completed by finishing its parts";
        return taskView(update("task", a.id, { completedAt: a.completed ? ts() : null }).id);
      case "create_task_part": {
        if (!String(a.input.title).trim()) throw "Title cannot be empty";
        create("task_part", { taskId: a.taskId, title: a.input.title, weight: a.input.weight ?? 1, doneAt: null });
        syncTask(a.taskId);
        return taskView(a.taskId);
      }
      case "update_task_part": return taskView(update("task_part", a.id, a.input).taskId);
      case "set_part_done": {
        const p = update("task_part", a.id, { doneAt: a.done ? ts() : null });
        syncTask(p.taskId);
        return taskView(p.taskId);
      }
      case "list_routines":
        return tables.routine.filter((r) => !r.deletedAt).sort((x, y) => x.startTime.localeCompare(y.startTime)).map((r) => routineView(r.id));
      case "create_routine": return routineView(create("routine", a.input).id);
      case "update_routine": return routineView(update("routine", a.id, a.input).id);
      case "create_routine_item":
        if (!String(a.title).trim()) throw "Title cannot be empty";
        if (a.parentId && tables.routine_item.find((i) => i.id === a.parentId)?.routineId !== a.routineId) throw "That step is not in this routine";
        create("routine_item", { routineId: a.routineId, title: a.title, parentId: a.parentId ?? null });
        return routineView(a.routineId);
      case "update_routine_item": return routineView(update("routine_item", a.id, { title: a.title }).routineId);
      case "list_routine_checks":
        return [...checks].filter((k) => k.endsWith("|" + a.day)).map((k) => k.split("|")[0]);
      case "set_routine_check":
        if (a.checked) checks.add(`${a.itemId}|${a.day}`); else checks.delete(`${a.itemId}|${a.day}`);
        return null;
      case "active_focus": {
        const f = tables.focus.find((x) => !x.endedAt && !x.deletedAt);
        return f ? { ...f } : null;
      }
      case "start_focus":
        if (tables.focus.some((x) => !x.endedAt && !x.deletedAt)) throw "A focus session is already running";
        return create("focus", { ...a.input, eventId: a.input.eventId ?? null }, { startedAt: ts(), endedAt: null });
      case "finish_focus": {
        const f = tables.focus.find((x) => x.id === a.id)!;
        const end = new Date(Math.max(Date.now(), new Date(f.startedAt).getTime() + 1)).toISOString();
        // Started from a planned block: that block takes the real times.
        const planned = f.eventId && tables.event.find((e) => e.id === f.eventId && !e.deletedAt);
        if (planned) {
          Object.assign(f, { endedAt: end });
          return update("event", planned.id, { startAt: f.startedAt, endAt: end });
        }
        const ev = create("event", {
          spaceId: f.spaceId, activityId: f.activityId, title: f.title || "Focus", startAt: f.startedAt, endAt: end,
          allDay: false, notes: "", status: "planned", taskId: f.taskId ?? null,
        }, { source: "focus", seriesId: null });
        Object.assign(f, { endedAt: end, eventId: ev.id });
        return ev;
      }
      case "list_series": return tables.series.filter((r) => !r.deletedAt).map((r) => ({ id: r.id, rule: r.rule, firstDate: r.firstDate }));
      case "set_repeat": return setRepeat(a.id, a.rule);
      case "add_inbox":
        if (!String(a.text).trim()) throw "Note cannot be empty";
        return (async () => {
          let t: any = await mockInvoke("create_task", { input: { spaceId: "seed-space-inbox", typeId: null, title: String(a.text).trim(), notes: "", deadlineAt: a.deadlineAt ?? null, targetAt: null, priority: null, sectionId: null } });
          for (const s of (a.steps ?? []) as string[]) t = await mockInvoke("create_task_part", { taskId: t.id, input: { title: s } });
          return t;
        })();
      case "open_capture": case "hide_capture": return null;
      case "list_changes":
        return tables.change.filter((c) => c.entity === a.entity && c.entityId === a.id)
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 20)
          .map((c) => ({ id: c.id, createdAt: c.createdAt, snapshot: c.snapshot }));
      case "restore_change": {
        const ch = tables.change.find((c) => c.id === a.id);
        if (!ch) throw "Not found";
        const table = ch.entity === "event" ? "event" : "task";
        const current = tables[table].find((r) => r.id === ch.entityId)!;
        tables.change.push({ ...base(crypto.randomUUID(), 0), entity: ch.entity, entityId: ch.entityId, snapshot: { ...current } });
        const keys = table === "event"
          ? ["spaceId", "activityId", "title", "startAt", "endAt", "allDay", "notes", "status", "taskId"]
          : ["spaceId", "typeId", "title", "notes", "deadlineAt", "targetAt", "priority", "sectionId"];
        keys.forEach((k) => { current[k] = ch.snapshot[k] ?? null; });
        current.updatedAt = ts();
        return null;
      }
      case "discard_focus": update("focus", a.id, { endedAt: ts(), deletedAt: ts() }); return null;
      case "list_reminder_rules": return tables.reminder_rule.filter((r) => !r.deletedAt).map((r) => ({ ...r }));
      case "create_reminder_rule": return create("reminder_rule", { ...a.input, name: a.input.title });
      case "update_reminder_rule":
        if (!String(a.input.title).trim()) throw "Title cannot be empty";
        if (!a.input.weekdays) throw "Pick at least one day";
        return update("reminder_rule", a.id, a.input);
      case "send_test_reminder": return null;
      case "list_import_sources": return (tables.import_source ?? []).filter((r) => !r.deletedAt).map((r) => ({ ...r }));
      case "demo_seed_import": {
        // Browser demo only: a calendar link with a few imported deadlines.
        tables.import_source = [{ ...base("demo-source", 0), kind: "ics_url", name: "Deadlines", location: "https://learning.example.edu/calendar/export.php?userid=1&authtoken=secret", spaceId: "seed-space-personal", enabled: true, lastSyncedAt: ts(), lastError: null, importAs: "events" }];
        const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 0, 0); return d; };
        ["Lab 1 due: cloud basics", "Lab 2 due: user accounts", "Lab 3 due: device setup", "Company visit"].forEach((title, i) => {
          const start = day(i * 3 + 1);
          create("event", { spaceId: "seed-space-personal", activityId: null, title, startAt: new Date(start.getTime() - 3600000).toISOString(), endAt: start.toISOString(), allDay: false, notes: "", status: "planned" }, { source: "import", sourceId: "demo-source", locallyModified: false });
        });
        return null;
      }
      case "list_title_mappings": return tables.title_mapping.filter((r) => !r.deletedAt).map((r) => ({ ...r }));
      case "list_unmapped_titles": {
        const maps = tables.title_mapping.filter((m) => !m.deletedAt);
        const hit = (t: string) => maps.some((m) => (m.matchType === "exact" ? m.pattern.toLowerCase() === t.toLowerCase() : t.toLowerCase().includes(m.pattern.toLowerCase())));
        const counts = new Map<string, number>();
        tables.event.filter((e) => e.source === "import" && !e.deletedAt && !hit(e.title)).forEach((e) => counts.set(e.title, (counts.get(e.title) ?? 0) + 1));
        return [...counts].map(([title, count]) => ({ title, count }));
      }
      case "create_title_mapping": return create("title_mapping", a.input);
      case "update_title_mapping": return update("title_mapping", a.id, a.input);
      case "follow_import": return update("event", a.id, { locallyModified: false });
      case "add_calendar_link": case "sync_calendar_link": case "import_ics_file": case "inspect_csv": case "import_csv": case "export_all":
        throw "Import and export only work in the desktop app";
      case "list_archived": {
        const q = String(a.query ?? "").toLowerCase();
        const label = (r: Row) => r.title ?? r.name ?? r.pattern ?? "";
        const items = Object.entries(tables)
          .filter(([k]) => !["focus", "series", "change"].includes(k))
          .flatMap(([entity, rows]) =>
            rows.filter((r) => r.deletedAt && !r.replaced && label(r).toLowerCase().includes(q)).map((r) => ({
              entity, id: r.id, label: label(r), context: null, when: r.startAt ?? r.deadlineAt ?? null,
              archivedAt: r.deletedAt, removedBySync: false,
            })),
          )
          .sort((x, y) => y.archivedAt.localeCompare(x.archivedAt));
        return { items, hiddenEvents: 0 };
      }
      case "list_confirmations": {
        const d = new Date();
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return tables.reminder_rule
          .filter((r) => !r.deletedAt && r.enabled && r.askConfirm && r.kind === "times")
          .flatMap((r) => String(r.times).split(",").map((time) => ({
            ruleId: r.id, title: r.title, time, occurrence: `${day}T${time}`, confirmedAt: confirmed.get(`${r.id}|${day}T${time}`) ?? null,
          })));
      }
      case "set_confirmed":
        if (a.done) confirmed.set(`${a.ruleId}|${a.occurrence}`, ts()); else confirmed.delete(`${a.ruleId}|${a.occurrence}`);
        return null;
      case "backup_settings": return { mirrorDir: null, backups: [] };
      case "set_backup_mirror": case "restore_backup": throw "Backups can only be managed in the desktop app";
      case "update_import_source": return update("import_source", a.id, a.input);
      case "show_focus_mini": case "size_focus_mini": case "close_focus_mini": case "show_main_window": return null;
      case "archive_keep_setting": return archiveKeep;
      case "set_archive_keep_setting": archiveKeep = a.days ?? null; return null;
      case "delete_forever": {
        const table = (tables as Record<string, Row[]>)[a.entity];
        const i = table?.findIndex((r) => r.id === a.id) ?? -1;
        if (i < 0) throw "It is already gone";
        if (!table[i].deletedAt) throw "Only archived items can be deleted for good";
        if (a.entity === "event" && table[i].sourceId) throw "An imported event stays archived, so its calendar link does not add it again";
        table.splice(i, 1);
        return null;
      }
      case "empty_archive": {
        let n = 0;
        for (const [name, table] of Object.entries(tables as Record<string, Row[]>)) {
          for (let i = table.length - 1; i >= 0; i--) {
            if (table[i].deletedAt && !(name === "event" && table[i].sourceId) && name !== "space" && name !== "group") { table.splice(i, 1); n++; }
          }
        }
        return n;
      }
      case "menubar_setting": return menubarOn;
      case "set_menubar_setting": menubarOn = a.on; return null;
      case "app_info":
        return { dataDir: "(browser preview: data lives in memory)", backupDir: "", backupCount: 0, lastBackup: null, version: "dev" };
      case "get_insights": return mockInsights(a.from, a.to);
      case "list_semesters":
        return tables.semester.filter((r) => !r.deletedAt).sort((x, y) => y.startDate.localeCompare(x.startDate)).map((r) => ({ ...r }));
      case "create_semester":
        if (a.input.endDate < a.input.startDate) throw "The semester must end after it starts";
        return create("semester", a.input);
      case "update_semester": return update("semester", a.id, a.input);
      case "set_archived": {
        const row = update(a.entity, a.id, { deletedAt: a.archived ? ts() : null });
        if (a.entity === "task_part") syncTask(row.taskId);
        return null;
      }
      default: throw `Unknown command: ${cmd}`;
    }
  })();
  return out as T;
}

/** Same rules as src-tauri/src/insights.rs, simplified, for the browser preview. */
function mockInsights(from: string, to: string) {
  const day = (iso: string) => new Date(`${iso}T00:00`);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [f, t] = [day(from), day(to)];
  const weekly = (t.getTime() - f.getTime()) / 864e5 > 31;
  const bucketOf = (d: Date) => {
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (weekly) b.setDate(b.getDate() - ((b.getDay() + 6) % 7));
    return key(b);
  };
  const buckets = new Map<string, { class: number; selfStudy: number }>();
  for (const d = new Date(f); d < t; d.setDate(d.getDate() + 1)) if (!buckets.has(bucketOf(d))) buckets.set(bucketOf(d), { class: 0, selfStudy: 0 });
  const totals = { class: 0, selfStudy: 0, other: 0, sleep: 0 };
  const spaces = new Map<string, { spaceId: string; class: number; selfStudy: number; other: number; sleep: number }>();
  let sessions = 0;
  const nights = new Map<string, number>();
  const limit = Math.min(t.getTime(), Date.now());
  for (const e of tables.event) {
    if (e.deletedAt || e.status === "skipped" || e.allDay) continue;
    const a = Math.max(new Date(e.startAt).getTime(), f.getTime());
    const b = Math.min(new Date(e.endAt).getTime(), limit);
    if (b <= a) continue;
    const m = Math.floor((b - a) / 60000);
    const space = tables.space.find((s) => s.id === e.spaceId);
    const s = spaces.get(e.spaceId) ?? { spaceId: e.spaceId, class: 0, selfStudy: 0, other: 0, sleep: 0 };
    spaces.set(e.spaceId, s);
    if (space?.role === "sleep") {
      s.sleep += m;
      totals.sleep += m;
      const k = key(new Date(e.endAt));
      nights.set(k, (nights.get(k) ?? 0) + m);
      continue;
    }
    const cat = tables.activity.find((x) => x.id === e.activityId)?.category;
    if (cat !== "class" && cat !== "self_study") { totals.other += m; s.other += m; continue; }
    sessions += 1;
    const field = cat === "class" ? "class" : "selfStudy";
    totals[field] += m; s[field] += m;
    const bk = buckets.get(bucketOf(new Date(a)));
    if (bk) bk[field] += m;
  }
  const nightList = [...nights].filter(([d]) => d >= from && d < to).sort().map(([date, minutes]) => ({ date, minutes }));
  return {
    bucket: weekly ? "week" : "day",
    buckets: [...buckets].map(([start, v]) => ({ start, ...v })),
    totals,
    spaces: [...spaces.values()].sort((x, y) => y.class + y.selfStudy + y.other + y.sleep - (x.class + x.selfStudy + x.other + x.sleep)),
    tasksDone: tables.task.filter((t) => !t.deletedAt && t.completedAt && t.completedAt >= f.toISOString() && t.completedAt < new Date(limit).toISOString()).length,
    productiveSessions: sessions,
    nights: nightList,
    sleepAverage: nightList.length ? Math.floor(nightList.reduce((n, x) => n + x.minutes, 0) / nightList.length) : null,
    elapsedDays: Math.max(0, Math.ceil((limit - f.getTime()) / 864e5)),
  };
}

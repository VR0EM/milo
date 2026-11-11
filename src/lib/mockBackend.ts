// Browser-only stand-in for the Rust commands (development preview). Not used in the app.
// Data lives in memory for the lifetime of the page.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const ts = () => new Date().toISOString();
const base = (id: string, sortOrder: number) => ({ id, sortOrder, createdAt: ts(), updatedAt: ts(), deletedAt: null });

const tables: Record<string, Row[]> = {
  group: [{ ...base("seed-group-school", 0), name: "School" }],
  space: [
    { ...base("seed-space-personal", 0), groupId: null, name: "Personal", color: "blue", role: "normal" },
    { ...base("seed-space-sleep", 1), groupId: null, name: "Sleep", color: "purple", role: "sleep" },
    { ...base("seed-space-transport", 2), groupId: null, name: "Transport", color: "gray", role: "normal" },
  ],
  activity: [
    { ...base("seed-activity-class", 0), name: "Class", category: "class" },
    { ...base("seed-activity-study", 1), name: "Study", category: "self_study" },
    { ...base("seed-activity-lab", 2), name: "Lab", category: "class" },
    { ...base("seed-activity-exam", 3), name: "Exam", category: "other" },
  ],
  event: [],
  task_type: [
    { ...base("seed-type-assignment", 0), name: "Assignment" },
    { ...base("seed-type-theory", 1), name: "Theory" },
    { ...base("seed-type-lab", 2), name: "Lab" },
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
    { ...base("seed-reminder-events", 0), kind: "event", title: "Events", enabled: true, minutesBefore: 10, times: null, weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null },
    { ...base("seed-reminder-medication", 1), kind: "times", title: "Medication", enabled: false, minutesBefore: null, times: "08:00", weekdays: "1234567", intervalMinutes: null, startTime: null, endTime: null },
    { ...base("seed-reminder-water", 2), kind: "interval", title: "Water", enabled: false, minutesBefore: null, times: null, weekdays: "1234567", intervalMinutes: 90, startTime: "09:00", endTime: "21:00" },
  ],
};
const checks = new Set<string>();

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

function checkEvent(input: Row) {
  if (input.endAt <= input.startAt) throw "An event must end after it starts";
}

export async function mockInvoke<T>(cmd: string, a: Row): Promise<T> {
  const out = ((): unknown => {
    switch (cmd) {
      case "list_groups": return tables.group.map((r) => ({ ...r }));
      case "list_spaces": return tables.space.map((r) => ({ ...r }));
      case "list_activities": return tables.activity.map((r) => ({ ...r }));
      case "create_group": return create("group", a.input);
      case "update_group": return update("group", a.id, a.input);
      case "create_space": return create("space", a.input);
      case "update_space": return update("space", a.id, a.input);
      case "create_activity": return create("activity", a.input);
      case "update_activity": return update("activity", a.id, a.input);
      case "list_events":
        return tables.event
          .filter((e) => !e.deletedAt && e.startAt < a.to && e.endAt > a.from)
          .sort((x, y) => x.startAt.localeCompare(y.startAt))
          .map((r) => ({ ...r }));
      case "create_event": checkEvent(a.input); return create("event", a.input, { source: "manual", sourceId: null, locallyModified: false });
      case "update_event": checkEvent(a.input); return update("event", a.id, a.input);
      case "list_task_types": return tables.task_type.map((r) => ({ ...r }));
      case "create_task_type": return create("task_type", a.input);
      case "update_task_type": return update("task_type", a.id, a.input);
      case "list_tasks": return tables.task.filter((t) => !t.deletedAt).map((t) => taskView(t.id));
      case "create_task": return taskView(create("task", a.input, { completedAt: null }).id);
      case "update_task": return taskView(update("task", a.id, a.input).id);
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
        create("routine_item", { routineId: a.routineId, title: a.title });
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
        return create("focus", a.input, { startedAt: ts(), endedAt: null, eventId: null });
      case "finish_focus": {
        const f = tables.focus.find((x) => x.id === a.id)!;
        const end = new Date(Math.max(Date.now(), new Date(f.startedAt).getTime() + 1)).toISOString();
        const ev = create("event", {
          spaceId: f.spaceId, activityId: f.activityId, title: f.title || "Focus", startAt: f.startedAt, endAt: end,
          allDay: false, notes: "", status: "planned",
        }, { source: "focus" });
        Object.assign(f, { endedAt: end, eventId: ev.id });
        return ev;
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
        tables.import_source = [{ ...base("demo-source", 0), kind: "ics_url", name: "Deadlines", location: "https://learning.example.edu/calendar/export.php?userid=1&authtoken=secret", spaceId: "seed-space-personal", enabled: true, lastSyncedAt: ts(), lastError: null }];
        const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 0, 0); return d; };
        ["01 M365 intro labo moet worden ingeleverd", "02 Entra ID labo moet worden ingeleverd", "03 Intune labo moet worden ingeleverd", "Bedrijfsbezoek Umicore"].forEach((title, i) => {
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
          .filter(([k]) => k !== "focus")
          .flatMap(([entity, rows]) =>
            rows.filter((r) => r.deletedAt && label(r).toLowerCase().includes(q)).map((r) => ({
              entity, id: r.id, label: label(r), context: null, when: r.startAt ?? r.deadlineAt ?? null,
              archivedAt: r.deletedAt, removedBySync: false,
            })),
          )
          .sort((x, y) => y.archivedAt.localeCompare(x.archivedAt));
        return { items, hiddenEvents: 0 };
      }
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

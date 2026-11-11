// Browser preview only (`npm run dev`, open with ?demo): fills the in-memory stand-in
// with a realistic student week, so screens can be judged with real-looking content.
// Never runs inside the desktop app.

import { api } from "./api";
import { mockInvoke } from "./mockBackend";

export async function seedDemo() {
  const g = (await api.listGroups())[0];
  const mk = (name: string, color: string) => api.createSpace({ groupId: g.id, name, color, role: "normal" });
  const an = await mk("Analysis 2", "green");
  const ph = await mk("Physics", "orange");
  const ch = await mk("Chemistry", "teal");
  const pr = await mk("Programming", "purple");
  const work = await api.createSpace({ groupId: null, name: "Work", color: "red", role: "normal" });

  const ws = new Date();
  ws.setHours(0, 0, 0, 0);
  ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const at = (d: number, h: number, m = 0) => {
    const x = new Date(ws);
    x.setDate(x.getDate() + d);
    x.setHours(h, m, 0, 0);
    return x.toISOString();
  };
  const C = "seed-activity-class", S = "seed-activity-study", L = "seed-activity-lab";
  const rows: [number, string, string | null, number, number, number, number, string][] = [
    [0, an.id, C, 8, 30, 10, 30, "Analysis 2 - HOC"], [0, ph.id, C, 13, 0, 15, 0, "Physics - HOC"],
    [0, an.id, S, 16, 0, 17, 30, "Exercises ch. 4"], [1, ch.id, L, 9, 0, 12, 0, "Chemistry lab"],
    [1, pr.id, S, 14, 0, 16, 0, "Programming project"], [2, an.id, C, 8, 30, 10, 30, "Analysis 2 - WPO"],
    [2, "seed-space-transport", null, 7, 45, 8, 25, "Train"], [2, work.id, null, 17, 0, 21, 0, "Shift"],
    [2, ph.id, S, 11, 0, 12, 30, "Physics problems"], [3, ph.id, C, 10, 0, 12, 0, "Physics - WPO"],
    [3, an.id, S, 14, 0, 15, 30, "Exercises ch. 5"], [4, pr.id, C, 9, 0, 11, 0, "Programming - HOC"],
    [4, ch.id, C, 13, 0, 15, 0, "Chemistry - HOC"], [5, "seed-space-personal", null, 11, 0, 13, 0, "Brunch with Sam"],
  ];
  for (const [d, spaceId, activityId, h1, m1, h2, m2, title] of rows) {
    await api.createEvent({ spaceId, activityId, title, startAt: at(d, h1, m1), endAt: at(d, h2, m2), allDay: false, notes: "", status: "planned" });
  }
  for (let n = 0; n < 7; n++) {
    await api.createEvent({ spaceId: "seed-space-sleep", activityId: null, title: "Sleep", startAt: at(n - 1, 23, 30), endAt: at(n, 7, 15), allDay: false, notes: "", status: "planned" });
  }

  const due = (n: number, h = 23, m = 59) => {
    const x = new Date();
    x.setDate(x.getDate() + n);
    x.setHours(h, m, 0, 0);
    return x.toISOString();
  };
  const t1 = await api.createTask({ spaceId: an.id, typeId: "seed-type-theory", title: "Chapters 4-6", notes: "", deadlineAt: due(9), targetAt: due(6), priority: "medium" });
  for (const p of ["Chapter 4", "Chapter 5", "Chapter 6"]) await api.createTaskPart(t1.id, p);
  const withParts = (await api.listTasks()).find((t) => t.id === t1.id)!;
  await api.setPartDone(withParts.parts[0].id, true);
  await api.createTask({ spaceId: ph.id, typeId: "seed-type-assignment", title: "Problem set 3", notes: "", deadlineAt: due(2, 17, 0), targetAt: null, priority: "high" });
  const t3 = await api.createTask({ spaceId: ch.id, typeId: "seed-type-lab", title: "Lab report titration", notes: "", deadlineAt: due(5), targetAt: due(3), priority: "low" });
  for (const p of ["Data", "Discussion", "Conclusion"]) await api.createTaskPart(t3.id, p);

  await mockInvoke("demo_seed_import", {});

  const [morning, evening] = await api.listRoutines();
  for (const s of ["Medication", "Glass of water", "Check Today"]) await api.createRoutineItem(morning.id, s);
  for (const s of ["Pack bag", "Plan tomorrow", "Screens off"]) await api.createRoutineItem(evening.id, s);
}

// Browser preview only (`npm run dev`, open with ?demo): fills the in-memory stand-in
// with a realistic student week, so screens can be judged with real-looking content.
// Never runs inside the desktop app.

import { api } from "./api";
import { mockInvoke } from "./mockBackend";

export async function seedDemo() {
  const g = (await api.listGroups())[0];
  const mk = (name: string, color: string) => api.createSpace({ groupId: g.id, name, color, role: "normal", kind: "project" });
  const an = await mk("Analysis 2", "green");
  const ph = await mk("Physics", "orange");
  const ch = await mk("Chemistry", "teal");
  const pr = await mk("Programming", "purple");
  const work = await api.createSpace({ groupId: null, name: "Work", color: "red", role: "normal", kind: "none" });
  const errands = await api.createSpace({ groupId: null, name: "Errands", color: "pink", role: "normal", kind: "list" });

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
    [0, an.id, C, 8, 30, 10, 30, "Analysis 2 - Lecture"], [0, ph.id, C, 13, 0, 15, 0, "Physics - Lecture"],
    [0, an.id, S, 16, 0, 17, 30, "Exercises ch. 4"], [1, ch.id, L, 9, 0, 12, 0, "Chemistry lab"],
    [1, pr.id, S, 14, 0, 16, 0, "Programming project"], [2, an.id, C, 8, 30, 10, 30, "Analysis 2 - Tutorial"],
    [2, "seed-space-transport", null, 7, 45, 8, 25, "Train"], [2, work.id, null, 17, 0, 21, 0, "Shift"],
    [2, ph.id, S, 11, 0, 12, 30, "Physics problems"], [3, ph.id, C, 10, 0, 12, 0, "Physics - Tutorial"],
    [3, an.id, S, 14, 0, 15, 30, "Exercises ch. 5"], [4, pr.id, C, 9, 0, 11, 0, "Programming - Lecture"],
    [4, ch.id, C, 13, 0, 15, 0, "Chemistry - Lecture"], [5, "seed-space-personal", null, 11, 0, 13, 0, "Brunch with Sam"],
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
  const s1 = await api.createSection(ch.id, "01 Acids and bases");
  const s2 = await api.createSection(ch.id, "02 Titration");
  await api.createSection(ch.id, "03 Redox");
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const done1 = await api.createTask({ spaceId: ch.id, typeId: "seed-type-theory", title: "Read chapter 1", notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: s1.id });
  await api.setTaskCompleted(done1.id, true);
  const done2 = await api.createTask({ spaceId: ch.id, typeId: "seed-type-assignment", title: "Exercises pH", notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: s1.id });
  await api.setTaskCompleted(done2.id, true);
  await api.createTask({ spaceId: ch.id, typeId: "seed-type-theory", title: "Theory: equivalence point", notes: "", deadlineAt: due(4), targetAt: null, priority: null, sectionId: s2.id });
  await api.createTask({ spaceId: ch.id, typeId: "seed-type-lab", title: "Prepare the lab", notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: s2.id });

  for (const title of ["Pick up package at the post office", "Return library books", "Buy vitamin D"]) {
    await api.createTask({ spaceId: errands.id, typeId: null, title, notes: "", deadlineAt: title.startsWith("Return") ? due(5, 17, 0) : null, targetAt: null, priority: null, sectionId: null });
  }
  const groceries = await api.createTask({ spaceId: errands.id, typeId: null, title: "Groceries", notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: null });
  for (const p of ["Milk", "Bread", "Coffee"]) await api.createTaskPart(groceries.id, p);
  const post = (await api.listTasks()).find((t) => t.title.startsWith("Pick up package"))!;
  await api.setTaskToday(post.id, todayKey);

  const note1 = await api.addInbox("Ask Lotte for the notes");
  await api.addInbox("Look up the bus to the exam hall");
  await api.setTaskToday(note1.id, todayKey);

  const t1 = await api.createTask({ spaceId: an.id, typeId: "seed-type-theory", title: "Chapters 4-6", notes: "", deadlineAt: due(9), targetAt: due(6), priority: "medium" });
  for (const p of ["Chapter 4", "Chapter 5", "Chapter 6"]) await api.createTaskPart(t1.id, p);
  const withParts = (await api.listTasks()).find((t) => t.id === t1.id)!;
  await api.setPartDone(withParts.parts[0].id, true);
  await api.createTask({ spaceId: ph.id, typeId: "seed-type-assignment", title: "Problem set 3", notes: "", deadlineAt: due(2, 17, 0), targetAt: null, priority: "high" });
  const t3 = await api.createTask({ spaceId: ch.id, typeId: "seed-type-lab", title: "Lab report titration", notes: "", deadlineAt: due(-1), targetAt: null, priority: "low", sectionId: s2.id });
  await api.setTaskToday(t3.id, todayKey);
  for (const p of ["Data", "Discussion", "Conclusion"]) await api.createTaskPart(t3.id, p);

  await mockInvoke("demo_seed_import", {});

  const [morning, evening] = await api.listRoutines();
  for (const s of ["Medication", "Glass of water", "Check Today", "Pack backpack"]) await api.createRoutineItem(morning.id, s);
  const pack = (await api.listRoutines()).find((r) => r.id === morning.id)!.items.find((i) => i.title === "Pack backpack")!;
  for (const s of ["Laptop and charger", "Water bottle"]) await api.createRoutineItem(morning.id, s, pack.id);
  for (const s of ["Pack bag", "Plan tomorrow", "Screens off"]) await api.createRoutineItem(evening.id, s);
}

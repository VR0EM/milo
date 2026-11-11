// Mirrors src-tauri/src/models.rs. Kept by hand for now: the surface is small,
// and generated bindings can replace this file later without touching callers.

export interface Group {
  id: string;
  name: string;
  sortOrder: number;
  deletedAt: string | null;
}
export type GroupInput = Pick<Group, "name">;

export type SpaceRole = "normal" | "sleep";
export interface Space {
  id: string;
  groupId: string | null;
  name: string;
  color: string;
  role: SpaceRole;
  sortOrder: number;
  deletedAt: string | null;
}
export type SpaceInput = Pick<Space, "groupId" | "name" | "color" | "role">;

export type ActivityCategory = "class" | "self_study" | "other";
export interface Activity {
  id: string;
  name: string;
  category: ActivityCategory;
  sortOrder: number;
  deletedAt: string | null;
}
export type ActivityInput = Pick<Activity, "name" | "category">;

export type EventStatus = "planned" | "skipped";
export interface CalEvent {
  id: string;
  spaceId: string;
  activityId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  notes: string;
  status: EventStatus;
  source: string;
  sourceId: string | null;
  locallyModified: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export type EventInput = Pick<
  CalEvent,
  "spaceId" | "activityId" | "title" | "startAt" | "endAt" | "allDay" | "notes" | "status"
>;

export interface TaskType {
  id: string;
  name: string;
  sortOrder: number;
  deletedAt: string | null;
}

export interface TaskPart {
  id: string;
  taskId: string;
  title: string;
  weight: number;
  doneAt: string | null;
  sortOrder: number;
}

export interface Task {
  id: string;
  spaceId: string;
  typeId: string | null;
  title: string;
  notes: string;
  deadlineAt: string | null;
  targetAt: string | null;
  completedAt: string | null;
  priority: Priority | null;
  sourceId: string | null;
  locallyModified: boolean;
  sortOrder: number;
  createdAt: string;
  parts: TaskPart[];
}
export type Priority = "low" | "medium" | "high";
export type TaskInput = Pick<Task, "spaceId" | "typeId" | "title" | "notes" | "deadlineAt" | "targetAt" | "priority">;

export const toTaskInput = (t: Task): TaskInput => ({
  spaceId: t.spaceId,
  typeId: t.typeId,
  title: t.title,
  notes: t.notes,
  deadlineAt: t.deadlineAt,
  targetAt: t.targetAt,
  priority: t.priority,
});

/** 0..1. With parts: the done share by weight. Without: done or not. */
export function taskProgress(t: Task): number {
  if (!t.parts.length) return t.completedAt ? 1 : 0;
  const total = t.parts.reduce((n, p) => n + p.weight, 0);
  const done = t.parts.reduce((n, p) => n + (p.doneAt ? p.weight : 0), 0);
  return total ? done / total : 0;
}

export interface RoutineItem {
  id: string;
  routineId: string;
  title: string;
  sortOrder: number;
}
export interface Routine {
  id: string;
  name: string;
  startTime: string; // 'HH:MM'
  endTime: string; // earlier than startTime means it runs past midnight
  weekdays: string; // '1' = Monday ... '7' = Sunday
  sortOrder: number;
  items: RoutineItem[];
}
export type RoutineInput = Pick<Routine, "name" | "startTime" | "endTime" | "weekdays">;

export interface FocusSession {
  id: string;
  spaceId: string;
  activityId: string | null;
  taskId: string | null;
  title: string;
  plannedMinutes: number;
  startedAt: string;
  endedAt: string | null;
  eventId: string | null;
}
export type FocusInput = Pick<FocusSession, "spaceId" | "activityId" | "taskId" | "title" | "plannedMinutes">;

export type ReminderKind = "event" | "times" | "interval" | "focus";

export interface Confirmation {
  ruleId: string;
  title: string;
  time: string;
  occurrence: string;
  confirmedAt: string | null;
}

export interface BackupFile {
  name: string;
  date: string;
  bytes: number;
}
export interface ReminderRule {
  id: string;
  kind: ReminderKind;
  title: string;
  enabled: boolean;
  minutesBefore: number | null; // event
  times: string | null; // times: 'HH:MM,HH:MM'
  weekdays: string;
  intervalMinutes: number | null; // interval
  startTime: string | null;
  endTime: string | null;
  askConfirm: boolean;
}
export type ReminderRuleInput = Omit<ReminderRule, "id">;

export interface ImportSource {
  id: string;
  kind: "ics_url" | "ics_file" | "csv";
  name: string;
  location: string;
  spaceId: string;
  enabled: boolean;
  importAs: "events" | "tasks";
  lastSyncedAt: string | null;
  lastError: string | null;
}
export type ImportSourceInput = Pick<ImportSource, "name" | "location" | "spaceId" | "enabled" | "importAs">;

export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  kept: number;
  unchanged: number;
  skipped: number;
}

export interface TitleMapping {
  id: string;
  pattern: string;
  matchType: "exact" | "contains";
  spaceId: string;
  activityId: string | null;
}
export type TitleMappingInput = Omit<TitleMapping, "id">;

export interface UnmappedTitle {
  title: string;
  count: number;
}

export interface CsvPreview {
  headers: string[];
  rows: string[][];
  titleColumn: number;
  dateColumn: number;
}

/** All values are minutes. */
export interface Insights {
  bucket: "day" | "week";
  buckets: { start: string; class: number; selfStudy: number }[];
  totals: { class: number; selfStudy: number; other: number; sleep: number };
  spaces: { spaceId: string; class: number; selfStudy: number; other: number; sleep: number }[];
  nights: { date: string; minutes: number }[];
  sleepAverage: number | null;
  elapsedDays: number;
  tasksDone: number;
  productiveSessions: number;
}

export interface Semester {
  id: string;
  name: string;
  startDate: string; // 'YYYY-MM-DD', inclusive
  endDate: string; // 'YYYY-MM-DD', inclusive
}
export type SemesterInput = Omit<Semester, "id">;

export interface ArchivedItem {
  entity: Entity;
  id: string;
  label: string;
  context: string | null;
  when: string | null;
  archivedAt: string;
  removedBySync: boolean;
}

export type Entity =
  | "semester"
  | "import_source"
  | "title_mapping"
  | "reminder_rule"
  | "group" | "space" | "activity" | "event" | "task" | "task_part" | "task_type" | "routine" | "routine_item";

export const toInput = (e: CalEvent): EventInput => ({
  spaceId: e.spaceId,
  activityId: e.activityId,
  title: e.title,
  startAt: e.startAt,
  endAt: e.endAt,
  allDay: e.allDay,
  notes: e.notes,
  status: e.status,
});

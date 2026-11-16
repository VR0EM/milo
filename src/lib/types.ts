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
/** What a space is for: a course with parts, a list to tick off, time only, or the hidden Inbox. */
export type SpaceKind = "project" | "list" | "none" | "inbox";
/** The hidden space quick notes land in. */
export const INBOX_ID = "seed-space-inbox";
export interface Space {
  id: string;
  groupId: string | null;
  name: string;
  color: string;
  role: SpaceRole;
  kind: SpaceKind;
  /** A drawn icon name (see SPACE_ICONS), or null for the plain square. */
  icon: string | null;
  sortOrder: number;
  deletedAt: string | null;
}
export type SpaceInput = Pick<Space, "groupId" | "name" | "color" | "role"> & {
  icon?: string | null;
  /** Left out: a new space is a list, an existing one keeps its kind. */
  kind?: Exclude<SpaceKind, "inbox">;
};

/** A course or list a note may belong to, with how likely (0..1). */
export interface SpaceChoice {
  spaceId: string;
  p: number;
}
/** Up to three choices, most likely first; `sure` when the first is likely and clearly ahead. */
export interface SpaceSuggestion {
  choices: SpaceChoice[];
  sure: boolean;
  /** Why the first choice, in a few words. */
  why: string | null;
}
/** One occurrence of a found event. */
export interface SearchWhen {
  eventId: string;
  startAt: string;
  allDay: boolean;
}
/** One event, or all events with the same title in the same space (a weekly class). */
export interface EventHit {
  title: string;
  spaceId: string;
  location: string;
  count: number;
  last: SearchWhen | null;
  next: SearchWhen | null;
  inTitle: boolean;
}
export interface TaskHit {
  id: string;
  title: string;
  spaceId: string;
  deadlineAt: string | null;
  completedAt: string | null;
  inTitle: boolean;
}
export interface SearchResults {
  events: EventHit[];
  tasks: TaskHit[];
}

/** An open to-do that a note seems to repeat. */
export interface Similar {
  taskId: string;
  title: string;
  spaceId: string;
}
/** The optional suggestion model (Settings › Calendar & lists). */
export interface ModelStatus {
  installed: boolean;
  downloading: boolean;
  bytes: number;
}

/** A part of a course ("02 Titration"). */
export interface Section {
  id: string;
  spaceId: string;
  name: string;
  sortOrder: number;
}

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
  /** Where it takes place ("ELL.01.01"), or empty. */
  location: string;
  status: EventStatus;
  source: string;
  sourceId: string | null;
  locallyModified: boolean;
  /** The task this is time for ("Work on: ..."), if any. */
  taskId: string | null;
  /** The repeat this occurrence belongs to, if any. */
  seriesId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export type EventInput = Pick<
  CalEvent,
  "spaceId" | "activityId" | "title" | "startAt" | "endAt" | "allDay" | "notes" | "status"
> & { taskId?: string | null; location?: string };

export type RepeatFreq = "daily" | "weekly" | "monthly";
export interface RepeatRule {
  freq: RepeatFreq;
  interval: number;
  /** Weekly: "135" = Mon, Wed, Fri (1 = Monday). Empty = the event's own weekday. */
  weekdays: string;
  /** Local "YYYY-MM-DD", inclusive; null repeats without end. */
  untilDate: string | null;
}
export interface EventSeries {
  id: string;
  rule: RepeatRule;
  firstDate: string;
}

/** An earlier version of an event or task; `snapshot` has the same shape as the item. */
export interface Change {
  id: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export interface TaskType {
  id: string;
  name: string;
  /** The course it is for; null = every course. */
  spaceId: string | null;
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
  /** The part of a course it belongs to. */
  sectionId: string | null;
  /** The local day ('YYYY-MM-DD') it was put on Today; null = not picked. */
  todayOn: string | null;
  sourceId: string | null;
  locallyModified: boolean;
  sortOrder: number;
  createdAt: string;
  parts: TaskPart[];
}
export type Priority = "low" | "medium" | "high";
export type TaskInput = Pick<Task, "spaceId" | "typeId" | "title" | "notes" | "deadlineAt" | "targetAt" | "priority"> & {
  sectionId?: string | null;
};

export const toTaskInput = (t: Task): TaskInput => ({
  spaceId: t.spaceId,
  typeId: t.typeId,
  title: t.title,
  notes: t.notes,
  deadlineAt: t.deadlineAt,
  targetAt: t.targetAt,
  priority: t.priority,
  sectionId: t.sectionId,
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
  /** A step under another step. */
  parentId: string | null;
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
export type FocusInput = Pick<FocusSession, "spaceId" | "activityId" | "taskId" | "title" | "plannedMinutes"> & {
  /** A planned block this session fills; it takes the real times when the session ends. */
  eventId?: string | null;
};

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
  | "group" | "space" | "activity" | "event" | "task" | "task_part" | "task_type" | "routine" | "routine_item" | "section";

export const toInput = (e: CalEvent): EventInput => ({
  spaceId: e.spaceId,
  activityId: e.activityId,
  title: e.title,
  startAt: e.startAt,
  endAt: e.endAt,
  allDay: e.allDay,
  notes: e.notes,
  status: e.status,
  taskId: e.taskId,
  location: e.location,
});

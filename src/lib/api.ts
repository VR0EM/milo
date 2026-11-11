// The single door to the data layer. The UI never talks to SQLite directly.
// Inside Tauri every call is a Rust command; in a plain browser (vite dev without
// Tauri) an in-memory stand-in is used so the UI can be developed and checked.

import { invoke } from "@tauri-apps/api/core";
import { mockInvoke } from "./mockBackend";
import type {
  Activity, ActivityInput, CalEvent, Entity, EventInput, Group, GroupInput, Space, SpaceInput, Task, TaskInput, TaskType,
  ArchivedItem, Insights, Semester, SemesterInput,
  CsvPreview, ImportSource, ImportSourceInput, SyncReport, TitleMapping, TitleMappingInput, UnmappedTitle,
  FocusInput, FocusSession, ReminderRule, ReminderRuleInput, Routine, RoutineInput,
} from "./types";

const inTauri = "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args ?? {});
}

export const api = {
  listGroups: () => call<Group[]>("list_groups"),
  createGroup: (input: GroupInput) => call<Group>("create_group", { input }),
  updateGroup: (id: string, input: GroupInput) => call<Group>("update_group", { id, input }),

  listSpaces: () => call<Space[]>("list_spaces"),
  createSpace: (input: SpaceInput) => call<Space>("create_space", { input }),
  updateSpace: (id: string, input: SpaceInput) => call<Space>("update_space", { id, input }),

  listActivities: () => call<Activity[]>("list_activities"),
  createActivity: (input: ActivityInput) => call<Activity>("create_activity", { input }),
  updateActivity: (id: string, input: ActivityInput) => call<Activity>("update_activity", { id, input }),

  listEvents: (from: string, to: string) => call<CalEvent[]>("list_events", { from, to }),
  createEvent: (input: EventInput) => call<CalEvent>("create_event", { input }),
  updateEvent: (id: string, input: EventInput) => call<CalEvent>("update_event", { id, input }),

  listTaskTypes: () => call<TaskType[]>("list_task_types"),
  createTaskType: (name: string) => call<TaskType>("create_task_type", { input: { name } }),
  updateTaskType: (id: string, name: string) => call<TaskType>("update_task_type", { id, input: { name } }),

  listTasks: () => call<Task[]>("list_tasks"),
  createTask: (input: TaskInput) => call<Task>("create_task", { input }),
  updateTask: (id: string, input: TaskInput) => call<Task>("update_task", { id, input }),
  setTaskCompleted: (id: string, completed: boolean) => call<Task>("set_task_completed", { id, completed }),
  createTaskPart: (taskId: string, title: string) => call<Task>("create_task_part", { taskId, input: { title } }),
  updateTaskPart: (id: string, title: string, weight: number) =>
    call<Task>("update_task_part", { id, input: { title, weight } }),
  setPartDone: (id: string, done: boolean) => call<Task>("set_part_done", { id, done }),

  listRoutines: () => call<Routine[]>("list_routines"),
  createRoutine: (input: RoutineInput) => call<Routine>("create_routine", { input }),
  updateRoutine: (id: string, input: RoutineInput) => call<Routine>("update_routine", { id, input }),
  createRoutineItem: (routineId: string, title: string) => call<Routine>("create_routine_item", { routineId, title }),
  updateRoutineItem: (id: string, title: string) => call<Routine>("update_routine_item", { id, title }),
  listRoutineChecks: (day: string) => call<string[]>("list_routine_checks", { day }),
  setRoutineCheck: (itemId: string, day: string, checked: boolean) =>
    call<void>("set_routine_check", { itemId, day, checked }),

  activeFocus: () => call<FocusSession | null>("active_focus"),
  startFocus: (input: FocusInput) => call<FocusSession>("start_focus", { input }),
  finishFocus: (id: string) => call<CalEvent>("finish_focus", { id }),
  discardFocus: (id: string) => call<void>("discard_focus", { id }),

  listReminderRules: () => call<ReminderRule[]>("list_reminder_rules"),
  createReminderRule: (input: ReminderRuleInput) => call<ReminderRule>("create_reminder_rule", { input }),
  updateReminderRule: (id: string, input: ReminderRuleInput) => call<ReminderRule>("update_reminder_rule", { id, input }),
  sendTestReminder: () => call<void>("send_test_reminder"),

  followImport: (id: string) => call<CalEvent>("follow_import", { id }),
  listImportSources: () => call<ImportSource[]>("list_import_sources"),
  addCalendarLink: (input: ImportSourceInput) => call<SyncReport>("add_calendar_link", { input }),
  updateImportSource: (id: string, input: ImportSourceInput) => call<ImportSource>("update_import_source", { id, input }),
  syncCalendarLink: (id: string) => call<SyncReport>("sync_calendar_link", { id }),
  importIcsFile: (path: string, spaceId: string) => call<SyncReport>("import_ics_file", { path, spaceId }),
  inspectCsv: (path: string) => call<CsvPreview>("inspect_csv", { path }),
  importCsv: (path: string, titleColumn: number, dateColumn: number, spaceId: string) =>
    call<SyncReport>("import_csv", { path, titleColumn, dateColumn, spaceId }),
  listTitleMappings: () => call<TitleMapping[]>("list_title_mappings"),
  createTitleMapping: (input: TitleMappingInput) => call<TitleMapping>("create_title_mapping", { input }),
  updateTitleMapping: (id: string, input: TitleMappingInput) => call<TitleMapping>("update_title_mapping", { id, input }),
  listUnmappedTitles: () => call<UnmappedTitle[]>("list_unmapped_titles"),
  exportAll: (path: string) => call<number>("export_all", { path }),

  getInsights: (from: string, to: string) => call<Insights>("get_insights", { from, to }),
  listSemesters: () => call<Semester[]>("list_semesters"),
  createSemester: (input: SemesterInput) => call<Semester>("create_semester", { input }),
  updateSemester: (id: string, input: SemesterInput) => call<Semester>("update_semester", { id, input }),

  listArchived: (query: string) => call<{ items: ArchivedItem[]; hiddenEvents: number }>("list_archived", { query }),

  appInfo: () =>
    call<{ dataDir: string; backupDir: string; backupCount: number; lastBackup: string | null; version: string }>("app_info"),

  setArchived: (entity: Entity, id: string, archived: boolean) =>
    call<void>("set_archived", { entity, id, archived }),
};

/** Start-with-the-computer switch. Only exists inside the desktop app. */
export const autostart = {
  available: inTauri,
  async isEnabled() {
    return inTauri ? (await import("@tauri-apps/plugin-autostart")).isEnabled() : false;
  },
  async set(on: boolean) {
    if (!inTauri) return;
    const plugin = await import("@tauri-apps/plugin-autostart");
    await (on ? plugin.enable() : plugin.disable());
  },
};

/** Native open/save dialogs. Only inside the desktop app; returns null when cancelled. */
export const files = {
  available: inTauri,
  async open(name: string, extensions: string[]): Promise<string | null> {
    if (!inTauri) throw "Files can only be opened in the desktop app";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false, filters: [{ name, extensions }] });
    return typeof picked === "string" ? picked : null;
  },
  async save(defaultPath: string): Promise<string | null> {
    if (!inTauri) throw "Files can only be saved in the desktop app";
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath, filters: [{ name: "JSON", extensions: ["json"] }] });
  },
};

/** Called when the background sync changed data, so the screens refresh. */
export async function onDataChanged(fn: () => void) {
  if (!inTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen("data-changed", fn);
}

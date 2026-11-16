// The single door to the data layer. The UI never talks to SQLite directly.
// Inside Tauri every call is a Rust command; in a plain browser (vite dev without
// Tauri) an in-memory stand-in is used so the UI can be developed and checked.

import { invoke } from "@tauri-apps/api/core";
import { mockInvoke } from "./mockBackend";
import type {
  Activity, ActivityInput, CalEvent, Entity, EventInput, Group, GroupInput, Space, SpaceInput, Task, TaskInput, TaskType,
  ArchivedItem, BackupFile, Confirmation, Insights, Semester, SemesterInput,
  CsvPreview, ImportSource, ImportSourceInput, SyncReport, TitleMapping, TitleMappingInput, UnmappedTitle,
  FocusInput, FocusSession, FocusTask, ReminderRule, ReminderRuleInput, Routine, RoutineInput,
  EventSeries, RepeatRule, Change, Section, ModelStatus, SearchResults, Similar, SpaceSuggestion,
} from "./types";

const inTauri = "__TAURI_INTERNALS__" in window;
/** Inside the desktop app (not the browser preview). */
export const inDesktop = inTauri;

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
  /** A list of one, or empty when the event was archived. */
  eventById: (id: string) => call<CalEvent[]>("event_by_id", { id }),
  createEvent: (input: EventInput) => call<CalEvent>("create_event", { input }),
  updateEvent: (id: string, input: EventInput) => call<CalEvent>("update_event", { id, input }),

  listTaskTypes: () => call<TaskType[]>("list_task_types"),
  createTaskType: (name: string, spaceId: string | null = null) => call<TaskType>("create_task_type", { input: { name, spaceId } }),
  updateTaskType: (id: string, name: string, spaceId: string | null) => call<TaskType>("update_task_type", { id, input: { name, spaceId } }),

  /** For each note, up to three courses or lists it may belong to. */
  suggestSpaces: (texts: string[], forEvents = false) => call<SpaceSuggestion[]>("suggest_spaces", { texts, forEvents }),
  /** Within a course: the part ("section") or type ("type") each to-do may belong to. */
  suggestInSpace: (spaceId: string, what: "section" | "type", texts: string[]) =>
    call<SpaceSuggestion[]>("suggest_in_space", { spaceId, what, texts }),
  /** For each [id, text]: an open to-do it seems to repeat, or null. */
  similarTodos: (items: [string, string][]) => call<(Similar | null)[]>("similar_todos", { items }),
  /** The to-dos of a Markdown checklist, made in a space (parts, to-dos, steps). */
  importTodos: (spaceId: string, todos: { title: string; done: boolean; section: string | null; steps: { title: string; done: boolean }[] }[]) =>
    call<{ taskIds: string[]; newSectionIds: string[]; steps: number }>("import_todos", { spaceId, todos }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  /** A CSV file for Excel of [from, to): every event, or the totals per space. */
  exportCsv: (path: string, from: string, to: string, what: "events" | "totals") => call<void>("export_csv", { path, from, to, what }),
  /** Every event (any date) and to-do (also done) with these words. */
  search: (query: string) => call<SearchResults>("search", { query }),
  smartModelStatus: () => call<ModelStatus>("smart_model_status"),
  downloadSmartModel: () => call<void>("download_smart_model"),
  removeSmartModel: () => call<void>("remove_smart_model"),

  listSections: () => call<Section[]>("list_sections"),
  createSection: (spaceId: string, name: string) => call<Section>("create_section", { spaceId, name }),
  updateSection: (id: string, name: string) => call<Section>("update_section", { id, name }),
  reorderSections: (ids: string[]) => call<void>("reorder_sections", { ids }),

  listTasks: () => call<Task[]>("list_tasks"),
  createTask: (input: TaskInput) => call<Task>("create_task", { input }),
  updateTask: (id: string, input: TaskInput) => call<Task>("update_task", { id, input }),
  setTaskCompleted: (id: string, completed: boolean) => call<Task>("set_task_completed", { id, completed }),
  /** On Today for `day` ('YYYY-MM-DD'), or off it with null. */
  setTaskToday: (id: string, day: string | null) => call<Task>("set_task_today", { id, day }),
  createTaskPart: (taskId: string, title: string) => call<Task>("create_task_part", { taskId, input: { title } }),
  updateTaskPart: (id: string, title: string, weight: number) =>
    call<Task>("update_task_part", { id, input: { title, weight } }),
  setPartDone: (id: string, done: boolean) => call<Task>("set_part_done", { id, done }),

  listRoutines: () => call<Routine[]>("list_routines"),
  createRoutine: (input: RoutineInput) => call<Routine>("create_routine", { input }),
  updateRoutine: (id: string, input: RoutineInput) => call<Routine>("update_routine", { id, input }),
  createRoutineItem: (routineId: string, title: string, parentId: string | null = null) =>
    call<Routine>("create_routine_item", { routineId, title, parentId }),
  updateRoutineItem: (id: string, title: string) => call<Routine>("update_routine_item", { id, title }),
  listRoutineChecks: (day: string) => call<string[]>("list_routine_checks", { day }),
  setRoutineCheck: (itemId: string, day: string, checked: boolean) =>
    call<void>("set_routine_check", { itemId, day, checked }),

  activeFocus: () => call<FocusSession | null>("active_focus"),
  startFocus: (input: FocusInput) => call<FocusSession>("start_focus", { input }),
  finishFocus: (id: string) => call<CalEvent>("finish_focus", { id }),
  discardFocus: (id: string) => call<void>("discard_focus", { id }),
  focusTasks: (sessionId: string) => call<FocusTask[]>("focus_tasks", { sessionId }),
  setFocusTaskDone: (sessionId: string, taskId: string, done: boolean) => call<Task>("set_focus_task_done", { sessionId, taskId, done }),

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

  /** Only archived items; what is still used elsewhere stays archived (the error says why). */
  deleteForever: (entity: Entity, id: string) => call<void>("delete_forever", { entity, id }),
  emptyArchive: () => call<number>("empty_archive"),
  archiveKeepSetting: () => call<number | null>("archive_keep_setting"),
  setArchiveKeepSetting: (days: number | null) => call<void>("set_archive_keep_setting", { days }),
  /** One page of the archive, newest first, with how many match and how many of each kind. */
  listArchived: (query: string, kind: Entity | "", limit: number, offset = 0) =>
    call<{ items: ArchivedItem[]; total: number; kinds: { entity: Entity; count: number }[] }>("list_archived", { query, kind, limit, offset }),

  menubarSetting: () => call<boolean>("menubar_setting"),
  setMenubarSetting: (on: boolean) => call<void>("set_menubar_setting", { on }),
  appInfo: () =>
    call<{ dataDir: string; backupDir: string; backupCount: number; lastBackup: string | null; version: string }>("app_info"),

  listConfirmations: () => call<Confirmation[]>("list_confirmations"),
  setConfirmed: (ruleId: string, occurrence: string, done: boolean) => call<void>("set_confirmed", { ruleId, occurrence, done }),
  backupSettings: () => call<{ mirrorDir: string | null; backups: BackupFile[] }>("backup_settings"),
  setBackupMirror: (path: string | null) => call<number>("set_backup_mirror", { path }),
  restoreBackup: (name: string) => call<string>("restore_backup", { name }),

  listSeries: () => call<EventSeries[]>("list_series"),
  setRepeat: (id: string, rule: RepeatRule | null) => call<CalEvent>("set_repeat", { id, rule }),

  /** A quick note: a to-do in the Inbox, with what parseNote() read from it. */
  addInbox: (note: { title: string; deadlineAt: string | null; steps: string[] }) =>
    call<Task>("add_inbox", { text: note.title, deadlineAt: note.deadlineAt, steps: note.steps }),
  reorderSpaces: (ids: string[]) => call<void>("reorder_spaces", { ids }),
  /** Into another group (or none), with that list's new order. */
  moveSpace: (id: string, groupId: string | null, ids: string[]) => call<void>("move_space", { id, groupId, ids }),
  reorderGroups: (ids: string[]) => call<void>("reorder_groups", { ids }),

  listChanges: (entity: "event" | "task", id: string) => call<Change[]>("list_changes", { entity, id }),
  restoreChange: (id: string) => call<void>("restore_change", { id }),
  openCapture: () => call<void>("open_capture"),
  hideCapture: () => call<void>("hide_capture"),

  showFocusMini: () => call<void>("show_focus_mini", { expanded: miniExpanded() }),
  sizeFocusMini: (expanded: boolean) => call<void>("size_focus_mini", { expanded }),
  closeFocusMini: () => call<void>("close_focus_mini"),
  showMainWindow: () => call<void>("show_main_window"),

  // AI apps through MCP (Settings › Connect AI).
  aiSetup: () => call<{ access: string; snippet: string; claudeFound: boolean; claudeConnected: boolean }>("ai_setup"),
  setAiAccess: (access: "off" | "read" | "write") => call<void>("set_ai_access", { access }),
  connectClaudeDesktop: () => call<void>("connect_claude_desktop"),
  /** Moves when another program wrote to the database. */
  dataVersion: () => call<number>("data_version"),

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
  async folder(): Promise<string | null> {
    if (!inTauri) throw "Folders can only be chosen in the desktop app";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },
  async save(defaultPath: string, filter: { name: string; extensions: string[] } = { name: "JSON", extensions: ["json"] }): Promise<string | null> {
    if (!inTauri) throw "Files can only be saved in the desktop app";
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath, filters: [filter] });
  },
};

/** Progress of the suggestion model download, in bytes. */
export async function onModelProgress(fn: (done: number, total: number) => void) {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<[number, number]>("model-download", (e) => fn(e.payload[0], e.payload[1]));
}

/** Called when the background sync changed data, so the screens refresh. */
export async function onDataChanged(fn: () => void) {
  if (!inTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen("data-changed", fn);
}

export type WindowKind = "main" | "focus-mini" | "capture";

/** Which window this page is: the main window, the small focus timer, or the quick note. */
export async function windowKind(): Promise<WindowKind> {
  if (!inTauri) {
    const q = new URLSearchParams(location.search);
    return q.has("mini") ? "focus-mini" : q.has("capture") ? "capture" : "main";
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const label = getCurrentWindow().label;
  return label === "focus-mini" || label === "capture" ? label : "main";
}

/** Runs `fn` each time the quick note window is shown again. */
export async function onCaptureOpen(fn: () => void) {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().listen("capture-open", fn);
}

/** Whether the small focus timer shows its options; remembered between sessions. */
export const miniExpanded = () => localStorage.getItem("milo-mini-expanded") === "1";
export const setMiniExpanded = (v: boolean) => localStorage.setItem("milo-mini-expanded", v ? "1" : "0");

/** Moves the current (small timer) window along with the pointer. */
export async function startWindowDrag() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

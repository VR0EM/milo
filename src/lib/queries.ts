import { useMutation, useQuery, useQueryClient, keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useUi } from "./store";
import { toInput, toTaskInput, type CalEvent, type Entity, type EventInput, type Task, type TaskInput } from "./types";

const report = (e: unknown) => useUi.getState().notify({ text: String(e), error: true });

export const useGroups = () => useQuery({ queryKey: ["groups"], queryFn: api.listGroups });
export const useSpaces = () => useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
export const useActivities = () => useQuery({ queryKey: ["activities"], queryFn: api.listActivities });

export const useEvents = (from: Date, to: Date) =>
  useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString()],
    queryFn: () => api.listEvents(from.toISOString(), to.toISOString()),
    placeholderData: keepPreviousData,
  });

/** Apply a change to every cached event list at once, so the grid reacts immediately. */
function patchEvents(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[]) {
  qc.setQueriesData<CalEvent[]>({ queryKey: ["events"] }, (list) => (list ? fn(list) : list));
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInput) => api.createEvent(input),
    onSuccess: (created) => patchEvents(qc, (list) => [...list, created]),
    onError: report,
    onSettled: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

/**
 * Update by patch. The patch is merged into the cached event first, and the full
 * event is then read back from the cache, so two quick edits (rename, then drag)
 * can never overwrite each other with stale values.
 */
export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; patch: Partial<EventInput> }) => {
      const current = qc
        .getQueriesData<CalEvent[]>({ queryKey: ["events"] })
        .flatMap(([, list]) => list ?? [])
        .find((e) => e.id === id);
      if (!current) throw new Error("Not found");
      return api.updateEvent(id, toInput(current));
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["events"] });
      patchEvents(qc, (list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    onError: report,
    onSettled: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

const plural: Record<Entity, string> = {
  group: "groups", space: "spaces", activity: "activities", event: "events",
  task: "tasks", task_part: "tasks", task_type: "taskTypes", routine: "routines", routine_item: "routines", reminder_rule: "reminders", import_source: "importSources", title_mapping: "titleMappings", semester: "semesters",
};

export function useSetArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entity, id, archived }: { entity: Entity; id: string; archived: boolean }) =>
      api.setArchived(entity, id, archived),
    onMutate: ({ entity, id, archived }) => {
      if (entity === "event" && archived) patchEvents(qc, (list) => list.filter((e) => e.id !== id));
    },
    onError: report,
    onSettled: (_d, _e, { entity }) => qc.invalidateQueries({ queryKey: [plural[entity]] }),
  });
}

export const useTasks = () => useQuery({ queryKey: ["tasks"], queryFn: api.listTasks });
export const useTaskTypes = () => useQuery({ queryKey: ["taskTypes"], queryFn: api.listTaskTypes });

/**
 * Any task change: run it, then put the returned task in the cache.
 * No optimistic step; the database is local, so the answer is there within a frame.
 */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<Task>) => run(),
    // An older list that is still loading must not overwrite this change when it arrives.
    onMutate: () => qc.cancelQueries({ queryKey: ["tasks"] }),
    onSuccess: (task) =>
      qc.setQueryData<Task[]>(["tasks"], (list) =>
        list ? (list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? task : t)) : [...list, task]) : list,
      ),
    onError: report,
    // Then read the list again, so the screen always ends on what the database holds.
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

/**
 * Update task fields by patch. The patch goes into the cache first and the full task is
 * built from the cache, so two quick edits never overwrite each other with stale values.
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  const act = useTaskAction();
  return (id: string, patch: Partial<TaskInput>) => {
    let merged: Task | undefined;
    qc.setQueryData<Task[]>(["tasks"], (list) => list?.map((t) => (t.id === id ? (merged = { ...t, ...patch }) : t)));
    if (merged) {
      const input = toTaskInput(merged);
      act.mutate(() => api.updateTask(id, input));
    }
  };
}

export const useRoutines = () => useQuery({ queryKey: ["routines"], queryFn: api.listRoutines });
export const useRoutineChecks = (day: string) =>
  useQuery({ queryKey: ["routineChecks", day], queryFn: () => api.listRoutineChecks(day) });
export const useReminderRules = () => useQuery({ queryKey: ["reminders"], queryFn: api.listReminderRules });
export const useImportSources = () => useQuery({ queryKey: ["importSources"], queryFn: api.listImportSources });
export const useTitleMappings = () => useQuery({ queryKey: ["titleMappings"], queryFn: api.listTitleMappings });
export const useUnmappedTitles = () => useQuery({ queryKey: ["unmappedTitles"], queryFn: api.listUnmappedTitles });
export const useSemesters = () => useQuery({ queryKey: ["semesters"], queryFn: api.listSemesters });
/** Always fresh: Insights are computed from the calendar at the moment they are shown. */
export const useInsights = (from: string, to: string) =>
  useQuery({ queryKey: ["insights", from, to], queryFn: () => api.getInsights(from, to), staleTime: 0, refetchOnMount: "always" });
export const useActiveFocus = () => useQuery({ queryKey: ["focus"], queryFn: api.activeFocus });

/** Run a change and refresh the lists it touches. */
export function useAction(...keys: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onError: report,
    onSettled: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

/** Archive with a visible way back. Nothing is removed; this only hides the item. */
export function useArchiveWithUndo() {
  const setArchived = useSetArchived();
  return (entity: Entity, id: string, label: string) => {
    setArchived.mutate({ entity, id, archived: true });
    useUi.getState().notify({
      text: `${label} archived`,
      undo: () => setArchived.mutate({ entity, id, archived: false }),
    });
  };
}

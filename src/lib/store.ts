// UI-only state. Anything that must survive a reinstall belongs in SQLite instead.
// Decision: Zustand for view state, TanStack Query for everything that comes from the database.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { startOfWeek } from "./time";
import type { Activity, Group, Space, TaskType } from "./types";

export const MIN_HOUR_HEIGHT = 24;
export const MAX_HOUR_HEIGHT = 160;

export type Dialog =
  | { kind: "space"; item?: Space; groupId?: string | null }
  | { kind: "group"; item?: Group }
  | { kind: "activity"; item?: Activity }
  | { kind: "task_type"; item?: TaskType };

export type View = "today" | "calendar" | "tasks" | "insights" | "reminders" | "import";
export type InsightsPeriod = "week" | "month" | "semester";

interface Notice {
  text: string;
  undo?: () => void;
}

interface UiState {
  view: View;
  viewStart: Date;
  selectedTaskId: string | null;
  showCompleted: boolean;
  selectedEventId: string | null;
  focusTitle: boolean;
  dialog: Dialog | null;
  /** Id of the routine being edited, if the routine editor is open. */
  routineEditId: string | null;
  insightsPeriod: InsightsPeriod;
  insightsAnchor: Date;
  insightsSemesterId: string | null;
  notice: Notice | null;
  // persisted
  hourHeight: number;
  hiddenSpaceIds: string[];
  lastSpaceId: string | null;

  setView: (v: View) => void;
  selectTask: (id: string | null, focusTitle?: boolean) => void;
  setShowCompleted: (v: boolean) => void;
  setViewStart: (d: Date) => void;
  select: (id: string | null, focusTitle?: boolean) => void;
  setHourHeight: (h: number) => void;
  toggleSpace: (id: string) => void;
  setLastSpace: (id: string) => void;
  openDialog: (d: Dialog | null) => void;
  notify: (n: Notice | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      view: "calendar",
      selectedTaskId: null,
      showCompleted: false,
      viewStart: startOfWeek(new Date()),
      selectedEventId: null,
      focusTitle: false,
      dialog: null,
      routineEditId: null,
      insightsPeriod: "week",
      insightsAnchor: new Date(),
      insightsSemesterId: null,
      notice: null,
      hourHeight: 52,
      hiddenSpaceIds: [],
      lastSpaceId: null,

      setView: (view) => set({ view }),
      selectTask: (selectedTaskId, focusTitle = false) => set({ selectedTaskId, focusTitle, selectedEventId: null }),
      setShowCompleted: (showCompleted) => set({ showCompleted }),
      setViewStart: (viewStart) => set({ viewStart }),
      // One thing is selected at a time: an event or a task, never both.
      select: (selectedEventId, focusTitle = false) => set({ selectedEventId, focusTitle, selectedTaskId: null }),
      setHourHeight: (h) => set({ hourHeight: Math.min(MAX_HOUR_HEIGHT, Math.max(MIN_HOUR_HEIGHT, h)) }),
      toggleSpace: (id) =>
        set((s) => ({
          hiddenSpaceIds: s.hiddenSpaceIds.includes(id)
            ? s.hiddenSpaceIds.filter((x) => x !== id)
            : [...s.hiddenSpaceIds, id],
        })),
      setLastSpace: (lastSpaceId) => set({ lastSpaceId }),
      openDialog: (dialog) => set({ dialog }),
      notify: (notice) => set({ notice }),
    }),
    {
      name: "milo-ui",
      partialize: (s) => ({ view: s.view, insightsPeriod: s.insightsPeriod, showCompleted: s.showCompleted, hourHeight: s.hourHeight, hiddenSpaceIds: s.hiddenSpaceIds, lastSpaceId: s.lastSpaceId }),
    },
  ),
);

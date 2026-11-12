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

export type View = "today" | "calendar" | "tasks" | "insights" | "reminders" | "settings";
export type Theme = "system" | "light" | "dark";
export type Accent = "blue" | "teal" | "green" | "plum" | "clay" | "custom";
export type Font = "system" | "rounded" | "humanist" | "serif";
export type TextSize = "small" | "default" | "large";
export const TEXT_SCALE: Record<TextSize, number> = { small: 0.92, default: 1, large: 1.1 };

/** Preferences from the Settings screen. */
export interface Prefs {
  theme: Theme;
  accent: Accent;
  /** Used when accent is "custom". */
  customAccent: string;
  font: Font;
  textSize: TextSize;
  /** Open the small always-on-top timer when a focus session starts. */
  focusMini: boolean;
  /** Ask GitHub for a newer version when Milo starts (at most once a day). */
  autoUpdates: boolean;
  showWeekends: boolean;
  eventMinutes: number;
  dayStartHour: number;
}
export const DEFAULT_PREFS: Prefs = { theme: "system", accent: "blue", customAccent: "#3fa7d6", font: "system", textSize: "default", focusMini: true, autoUpdates: true, showWeekends: true, eventMinutes: 60, dayStartHour: 7 };
export type InsightsPeriod = "week" | "month" | "semester";

interface Notice {
  text: string;
  error?: boolean;
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
  shortcutsOpen: boolean;
  prefs: Prefs;
  collapsedGroups: string[];
  /** Settings sections that are unfolded. */
  settingsOpen: string[];
  /** A section to scroll to once Settings has rendered. */
  settingsFocus: string | null;
  /** Open Settings with this section unfolded and in view. */
  openSettings: (section?: string) => void;
  toggleSettingsSection: (id: string) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  toggleGroup: (id: string) => void;
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
      shortcutsOpen: false,
      prefs: DEFAULT_PREFS,
      collapsedGroups: [],
      settingsOpen: ["appearance"],
      settingsFocus: null,
      openSettings: (section) =>
        set((s) => ({
          view: "settings",
          settingsOpen: section && !s.settingsOpen.includes(section) ? [...s.settingsOpen, section] : s.settingsOpen,
          settingsFocus: section ?? null,
        })),
      toggleSettingsSection: (id) =>
        set((s) => ({
          settingsOpen: s.settingsOpen.includes(id) ? s.settingsOpen.filter((x) => x !== id) : [...s.settingsOpen, id],
        })),
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
      toggleGroup: (id) =>
        set((s) => ({
          collapsedGroups: s.collapsedGroups.includes(id) ? s.collapsedGroups.filter((x) => x !== id) : [...s.collapsedGroups, id],
        })),
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
      // Older saved state has no prefs yet: fill in the defaults.
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<UiState>;
        const merged = { ...current, ...s, prefs: { ...DEFAULT_PREFS, ...(s.prefs ?? {}) } };
        // Import & export and Archive used to be pages of their own; they now live in Settings.
        const old = s.view as string | undefined;
        if (old === "import" || old === "archive") {
          merged.view = "settings";
          merged.settingsOpen = [...new Set([...(merged.settingsOpen ?? []), old])];
        }
        return merged;
      },
      partialize: (s) => ({ prefs: s.prefs, collapsedGroups: s.collapsedGroups, settingsOpen: s.settingsOpen, view: s.view, insightsPeriod: s.insightsPeriod, showCompleted: s.showCompleted, hourHeight: s.hourHeight, hiddenSpaceIds: s.hiddenSpaceIds, lastSpaceId: s.lastSpaceId }),
    },
  ),
);

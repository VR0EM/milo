// UI-only state. Anything that must survive a reinstall belongs in SQLite instead.
// Decision: Zustand for view state, TanStack Query for everything that comes from the database.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addDays, startOfDay, startOfWeek } from "./time";
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

/** How much of the calendar is on screen. */
export type CalMode = "day" | "week" | "month";

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** The first day after the range that `mode` shows from `start`. */
export function rangeEnd(mode: CalMode, start: Date): Date {
  if (mode === "month") return new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return addDays(start, mode === "day" ? 1 : 7);
}

/** Where the calendar starts when it shows `d` in `mode`. */
export function startFor(mode: CalMode, d: Date): Date {
  return mode === "day" ? startOfDay(d) : mode === "week" ? startOfWeek(d) : firstOfMonth(d);
}

interface UiState {
  view: View;
  /** The first day on screen: the day, the first day of the week strip, or the 1st of the month. */
  viewStart: Date;
  calMode: CalMode;
  setCalMode: (mode: CalMode) => void;
  /** Show the day, week or month (by the current mode) that holds `d`. */
  showDate: (d: Date) => void;
  /** One day, week or month forward (1) or back (-1). */
  stepCalendar: (n: number) => void;
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
      calMode: "week",
      setCalMode: (mode) =>
        set((s) => {
          if (mode === s.calMode) return {};
          // Keep today in view when it is on screen; otherwise keep the first day shown.
          const today = new Date();
          const focus = today >= s.viewStart && today < rangeEnd(s.calMode, s.viewStart) ? today : s.viewStart;
          return { calMode: mode, viewStart: startFor(mode, focus) };
        }),
      showDate: (d) => set((s) => ({ viewStart: startFor(s.calMode, d) })),
      stepCalendar: (n) =>
        set((s) => ({
          viewStart:
            s.calMode === "month"
              ? new Date(s.viewStart.getFullYear(), s.viewStart.getMonth() + n, 1)
              : addDays(s.viewStart, s.calMode === "day" ? n : 7 * n),
        })),
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
        // The calendar opens on today, in the day, week or month view that was used last.
        merged.viewStart = startFor(merged.calMode ?? "week", new Date());
        // Import & export and Archive used to be pages of their own; they now live in Settings.
        const old = s.view as string | undefined;
        if (old === "import" || old === "archive") {
          merged.view = "settings";
          merged.settingsOpen = [...new Set([...(merged.settingsOpen ?? []), old])];
        }
        return merged;
      },
      partialize: (s) => ({ prefs: s.prefs, calMode: s.calMode, collapsedGroups: s.collapsedGroups, settingsOpen: s.settingsOpen, view: s.view, insightsPeriod: s.insightsPeriod, showCompleted: s.showCompleted, hourHeight: s.hourHeight, hiddenSpaceIds: s.hiddenSpaceIds, lastSpaceId: s.lastSpaceId }),
    },
  ),
);

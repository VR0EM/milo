import { useEffect } from "react";
import { CalendarView } from "./features/calendar/CalendarView";
import { EntityDialog } from "./features/spaces/EntityDialog";
import { SettingsView } from "./features/settings/SettingsView";
import { ShortcutsDialog, useGlobalShortcuts } from "./features/shortcuts/Shortcuts";
import { WhatsNewDialog } from "./features/whatsnew/WhatsNew";
import { CommandMenu } from "./features/command/CommandMenu";
import { ContextMenuHost } from "./components/ContextMenu";
import { InsightsView } from "./features/insights/InsightsView";
import { RemindersView } from "./features/reminders/RemindersView";
import { TodayView } from "./features/today/TodayView";
import { TasksView } from "./features/tasks/TasksHome";
import { Sidebar } from "./features/spaces/Sidebar";
import { SpaceView } from "./features/spaces/SpaceView";
import { SearchView } from "./features/search/SearchView";
import { FocusView } from "./features/focus/FocusView";
import { SetupGate } from "./features/setup/SetupGuide";
import { RoutineEditor } from "./features/today/RoutineEditor";
import { useUi } from "./lib/store";
import { useAppearance } from "./lib/useAppearance";
import { useOutsideChanges } from "./lib/outsideChanges";
import { checkAutomatically } from "./lib/updates";
import { addDays, setClockPrefs, startOfWeek } from "./lib/time";

export default function App() {
  const view = useUi((s) => s.view);
  // The clock and week start are read by plain helpers; a change redraws the whole app.
  const timeFormat = useUi((s) => s.prefs.timeFormat);
  const weekStart = useUi((s) => s.prefs.weekStart);
  setClockPrefs({ timeFormat, weekStart });
  // The week on screen follows a new first day of the week at once (also at start, as the
  // store was set up before the saved choice was read).
  useEffect(() => {
    useUi.setState((s) => (s.calMode === "week" ? { viewStart: startOfWeek(addDays(s.viewStart, 3)) } : {}));
  }, [weekStart]);
  useGlobalShortcuts();
  useAppearance();
  useOutsideChanges();
  const autoUpdates = useUi((s) => s.prefs.autoUpdates);
  useEffect(() => {
    if (autoUpdates) checkAutomatically();
  }, [autoUpdates]);
  return (
    <div className="app" key={`${timeFormat}-${weekStart}`}>
      <Sidebar />
      {view === "today" ? <TodayView /> : view === "tasks" ? <TasksView /> : view === "insights" ? <InsightsView /> : view === "reminders" ? <RemindersView /> : view === "settings" ? <SettingsView /> : view === "space" ? <SpaceView /> : view === "search" ? <SearchView /> : view === "focus" ? <FocusView /> : <CalendarView />}
      <EntityDialog />
      <RoutineEditor />
      <SetupGate />
      <ShortcutsDialog />
      <WhatsNewDialog />
      <CommandMenu />
      <ContextMenuHost />
      <Notice />
    </div>
  );
}

/** One quiet line at the bottom: what just happened, and a way to undo it. */
function Notice() {
  const notice = useUi((s) => s.notice);
  const notify = useUi((s) => s.notify);

  useEffect(() => {
    // Errors stay until dismissed, so they cannot be missed. Other notices fade after 8 s.
    if (!notice || notice.error) return;
    const t = setTimeout(() => notify(null), 8000);
    return () => clearTimeout(t);
  }, [notice, notify]);

  if (!notice) return null;
  return (
    <div className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>
      <span>{notice.text}</span>
      {notice.undo && (
        <button
          className="link"
          onClick={() => notice.undo && useUi.getState().runUndo(notice.undo)}
        >
          Undo
        </button>
      )}
      <button className="link" onClick={() => notify(null)}>Dismiss</button>
    </div>
  );
}

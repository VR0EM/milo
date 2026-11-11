import { useEffect } from "react";
import { CalendarView } from "./features/calendar/CalendarView";
import { EntityDialog } from "./features/spaces/EntityDialog";
import { SettingsView } from "./features/settings/SettingsView";
import { ArchiveView } from "./features/archive/ArchiveView";
import { ShortcutsDialog, useGlobalShortcuts } from "./features/shortcuts/Shortcuts";
import { InsightsView } from "./features/insights/InsightsView";
import { ImportView } from "./features/import/ImportView";
import { RemindersView } from "./features/reminders/RemindersView";
import { TodayView } from "./features/today/TodayView";
import { TasksView } from "./features/tasks/TasksView";
import { Sidebar } from "./features/spaces/Sidebar";
import { TEXT_SCALE, useUi } from "./lib/store";

export default function App() {
  const view = useUi((s) => s.view);
  useGlobalShortcuts();
  const theme = useUi((s) => s.prefs.theme);
  const accent = useUi((s) => s.prefs.accent);
  const font = useUi((s) => s.prefs.font);
  const textSize = useUi((s) => s.prefs.textSize);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.font = font;
    root.style.setProperty("--text-scale", String(TEXT_SCALE[textSize]));
  }, [theme, accent, font, textSize]);
  return (
    <div className="app">
      <Sidebar />
      {view === "today" ? <TodayView /> : view === "tasks" ? <TasksView /> : view === "insights" ? <InsightsView /> : view === "reminders" ? <RemindersView /> : view === "import" ? <ImportView /> : view === "archive" ? <ArchiveView /> : view === "settings" ? <SettingsView /> : <CalendarView />}
      <EntityDialog />
      <ShortcutsDialog />
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
          onClick={() => {
            notice.undo?.();
            notify(null);
          }}
        >
          Undo
        </button>
      )}
      <button className="link" onClick={() => notify(null)}>Dismiss</button>
    </div>
  );
}

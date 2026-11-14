import { useImportSources, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { CalEvent } from "../../lib/types";

/** While Milo is still empty: three ways to fill it, instead of many "nothing" lines. */
export function GettingStarted({ events }: { events: CalEvent[] }) {
  const sources = useImportSources().data;
  const tasks = useTasks().data;
  const hidden = useUi((s) => s.prefs.startCardHidden);
  if (hidden || !sources || !tasks || sources.length > 0 || tasks.length > 0 || events.length > 0) return null;
  const ui = useUi.getState();
  return (
    <section className="block getting-started">
      <div className="block-head">
        <h2>Let Milo fill up</h2>
        <span className="spacer" />
        <button className="link" onClick={() => ui.setPrefs({ startCardHidden: true })}>Hide</button>
      </div>
      <p className="muted">Milo shows your week once it knows it. Three ways to start, in any order:</p>
      <div className="start-steps">
        <button className="start-step" onClick={() => useUi.setState({ setupOpen: true })}>
          <span className="start-title">Run the welcome guide</span>
          <span className="muted small">Courses, timetable and rhythm, in a few short steps.</span>
        </button>
        <button className="start-step" onClick={() => ui.openSettings("import")}>
          <span className="start-title">Import your timetable</span>
          <span className="muted small">Paste the calendar link from school.</span>
        </button>
        <button className="start-step" onClick={() => ui.setView("tasks")}>
          <span className="start-title">Add a first task</span>
          <span className="muted small">An assignment or something to study.</span>
        </button>
      </div>
    </section>
  );
}

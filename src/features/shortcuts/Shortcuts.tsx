import { useEffect, useRef } from "react";
import { useUi } from "../../lib/store";
import { NAV } from "../spaces/Sidebar";
import { IS_MAC, MOD_LABEL, isTyping } from "./keys";

/** App-wide keys: switching screens and opening this overview. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const n = Number(e.key);
      if (mod && !e.shiftKey && !e.altKey && n >= 1 && n <= NAV.length) {
        e.preventDefault();
        useUi.getState().setView(NAV[n - 1][0]);
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useUi.getState().setView("settings");
        return;
      }
      if (e.key === "?" && !e.repeat && !isTyping(e) && !mod) {
        e.preventDefault();
        useUi.setState({ shortcutsOpen: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const k = (...keys: string[]) => keys.map((key, i) => <span key={i}>{i > 0 && " "}<kbd>{key}</kbd></span>);

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  if (!open) return null;
  const close = () => useUi.setState({ shortcutsOpen: false });

  return (
    <dialog ref={ref} className="dialog wide" onClose={close}>
      <h2>Keyboard shortcuts</h2>
      <table className="keys">
        <tbody>
          <tr><td colSpan={2}><h3>Everywhere</h3></td></tr>
          {NAV.map(([, label], i) => (
            <tr key={label}><td>{k(`${MOD_LABEL}${i + 1}`)}</td><td>{label}</td></tr>
          ))}
          <tr><td>{k(`${MOD_LABEL},`)}</td><td>Settings</td></tr>
          <tr><td>{k("?")}</td><td>This overview</td></tr>
          <tr><td>{k("Esc")}</td><td>Close a dialog, or clear the selection</td></tr>
          <tr><td colSpan={2}><h3>Calendar</h3></td></tr>
          <tr><td>{k("N")}</td><td>New event at the next half hour</td></tr>
          <tr><td>{k("T")}</td><td>Go to this week</td></tr>
          <tr><td>{k("←")} {k("→")}</td><td>Previous or next week</td></tr>
          <tr><td>{k("Delete")}</td><td>Archive the selected event (with Undo)</td></tr>
          <tr><td>Double-click</td><td>New one-hour event</td></tr>
          <tr><td>Drag on empty space</td><td>Draw a new event</td></tr>
          <tr><td>{k(IS_MAC ? "⌘" : "Ctrl")} + scroll, or pinch</td><td>Zoom the hours</td></tr>
          <tr><td>Sideways swipe</td><td>Move through the days</td></tr>
          <tr><td colSpan={2}><h3>Tasks</h3></td></tr>
          <tr><td>{k("N")}</td><td>New task</td></tr>
          <tr><td>{k("Esc")}</td><td>Clear the selection</td></tr>
        </tbody>
      </table>
      <div className="dialog-foot">
        <span className="spacer" />
        <button className="btn primary" onClick={close} autoFocus>Close</button>
      </div>
    </dialog>
  );
}

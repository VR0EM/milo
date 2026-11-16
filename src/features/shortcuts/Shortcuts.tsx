import { useEffect, useRef } from "react";
import { useUi } from "../../lib/store";
import { visibleNav } from "../spaces/Sidebar";
import { IS_MAC, MOD_LABEL, isTyping, CAPTURE_KEY } from "./keys";

/** App-wide keys: switching screens and opening this overview. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const n = Number(e.key);
      const nav = visibleNav(useUi.getState().prefs.hiddenScreens);
      if (mod && !e.shiftKey && !e.altKey && n >= 1 && n <= nav.length) {
        e.preventDefault();
        useUi.getState().setView(nav[n - 1][0]);
        return;
      }
      // Cmd+K opens (or closes) the command menu, also from inside a text field.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        const s = useUi.getState();
        // Not over another dialog: one thing at a time.
        if (!s.commandOpen && document.querySelector("dialog[open]")) return;
        e.preventDefault();
        useUi.setState({ commandOpen: !s.commandOpen });
        return;
      }
      // Cmd+Z: undo the last change Milo made (moving, archiving, …). In a text field it
      // undoes typing, as always.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && !isTyping(e)) {
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        useUi.getState().undoLast();
        return;
      }
      // Cmd+F: the search page, over everything of any date.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        useUi.getState().openSearch();
        setTimeout(() => document.querySelector<HTMLInputElement>("#search-input")?.select(), 30);
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
    if (!open || !ref.current) return;
    ref.current.showModal();
    // showModal focuses the Close button at the bottom, which scrolls the list to its end.
    ref.current.focus();
    ref.current.scrollTop = 0;
  }, [open]);
  if (!open) return null;
  const close = () => useUi.setState({ shortcutsOpen: false });

  return (
    <dialog ref={ref} className="dialog wide" tabIndex={-1} onClose={close}>
      <h2>Keyboard shortcuts</h2>
      <table className="keys">
        <tbody>
          <tr><td colSpan={2}><h3>Everywhere</h3></td></tr>
          {visibleNav(useUi.getState().prefs.hiddenScreens).map(([, label], i) => (
            <tr key={label}><td>{k(`${MOD_LABEL}${i + 1}`)}</td><td>{label}</td></tr>
          ))}
          <tr><td>{k(`${MOD_LABEL},`)}</td><td>Settings</td></tr>
          <tr><td>{k(CAPTURE_KEY)}</td><td>Write something down, from any app (lands in the Inbox)</td></tr>
          <tr><td>{k(`${MOD_LABEL}K`)}</td><td>Commands: go anywhere, find a task, event or space, or type a date</td></tr>
          <tr><td>{k(`${MOD_LABEL}F`)}</td><td>Search all events and to-dos, of any date</td></tr>
          <tr><td>{k(`${MOD_LABEL}Z`)}</td><td>Undo the last change (also the ones before it)</td></tr>
          <tr><td>{k("?")}</td><td>This overview</td></tr>
          <tr><td>{k("Esc")}</td><td>Close a dialog, or clear the selection</td></tr>
          <tr><td colSpan={2}><h3>Calendar</h3></td></tr>
          <tr><td>{k("N")}</td><td>New event at the next half hour</td></tr>
          <tr><td>{k("D")} {k("W")} {k("M")}</td><td>Day, week or month view</td></tr>
          <tr><td>{k("2")} … {k("9")}</td><td>That many days side by side (up to 14 with the menu next to Day)</td></tr>
          <tr><td>{k("T")}</td><td>Go to today</td></tr>
          <tr><td>{k("G")}</td><td>Go to a date: type it, like "19 nov" or "fri"</td></tr>
          <tr><td>{k("←")} {k("→")}</td><td>Back or forward by what is on screen</td></tr>
          <tr><td>{k("Delete")}</td><td>Archive the selected event (with Undo)</td></tr>
          <tr><td>{k(`${MOD_LABEL}C`)} {k(`${MOD_LABEL}X`)} {k(`${MOD_LABEL}V`)}</td><td>Copy or cut the selected event; paste puts it where you clicked last, or at the same time</td></tr>
          <tr><td>Double-click</td><td>New event (in the All day row or the month: an all-day event)</td></tr>
          <tr><td>Drag on empty space</td><td>Draw a new event</td></tr>
          <tr><td>Drag in the month</td><td>Move an event to another day</td></tr>
          <tr><td>{k(IS_MAC ? "⌘" : "Ctrl")} + scroll, or pinch</td><td>Zoom the hours</td></tr>
          <tr><td>Sideways swipe</td><td>Move through the days</td></tr>
          <tr><td colSpan={2}><h3>Tasks</h3></td></tr>
          <tr><td>{k("N")}</td><td>New task</td></tr>
          <tr><td>{k("Esc")}</td><td>Clear the selection</td></tr>
        </tbody>
      </table>
      <div className="dialog-foot">
        <span className="spacer" />
        <button className="btn primary" onClick={close}>Close</button>
      </div>
    </dialog>
  );
}

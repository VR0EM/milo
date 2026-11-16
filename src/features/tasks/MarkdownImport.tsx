// "Import a checklist": paste a list from Obsidian or Notes, or open a .md file, see what it
// becomes, and add it to a course or list in one go (with Undo).

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, files } from "../../lib/api";
import { parseMarkdown } from "../../lib/markdownImport";
import { useUi } from "../../lib/store";
import type { Space } from "../../lib/types";

export function MarkdownImport({ space, onClose }: { space: Space; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const course = space.kind === "project";
  const parsed = parseMarkdown(text);
  const done = parsed.todos.filter((t) => t.done).length;
  const steps = parsed.todos.reduce((n, t) => n + t.steps.length, 0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const refresh = () => ["tasks", "sections"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const open = async () => {
    setError(null);
    try {
      const path = await files.open("Checklist", ["md", "markdown", "txt"]);
      if (path) setText(await api.readTextFile(path));
    } catch (e) {
      setError(String(e));
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const todos = parsed.todos.map((t) => ({ ...t, section: course ? t.section : null }));
      const made = await api.importTodos(space.id, todos);
      refresh();
      const undo = async () => {
        for (const id of made.taskIds) await api.setArchived("task", id, true);
        for (const id of made.newSectionIds) await api.setArchived("section", id, true);
        refresh();
      };
      useUi.getState().notify({ text: `${made.taskIds.length} to-dos added to ${space.name}`, undo });
      ref.current?.close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = [
    course && parsed.sections.length ? `${parsed.sections.length} ${parsed.sections.length === 1 ? "part" : "parts"}` : "",
    `${parsed.todos.length} ${parsed.todos.length === 1 ? "to-do" : "to-dos"}${done ? ` (${done} done)` : ""}`,
    steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <dialog ref={ref} className="dialog wide md-import" onClose={onClose} aria-labelledby="md-title">
      <form onSubmit={(e) => { e.preventDefault(); if (parsed.todos.length) run(); }}>
        <h2 id="md-title">Import a checklist into {space.name}</h2>
        <label className="field">
          <span>From Obsidian or Notes</span>
          <textarea
            autoFocus
            rows={8}
            value={text}
            placeholder={course ? "## 01 Titration\n- [ ] Read chapter 2\n- [x] Lab report\n    - [ ] Discussion" : "- [ ] Groceries\n    - [ ] Milk\n- [ ] Call the bank"}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {files.available && <button type="button" className="btn small md-open" onClick={open}>Open a .md file…</button>}

        {parsed.todos.length > 0 && (
          <div className="md-preview">
            <p className="small"><strong>{summary}</strong>{parsed.skipped ? <span className="muted"> · {parsed.skipped} other lines left out</span> : null}</p>
            <ul>
              {parsed.todos.slice(0, 8).map((t, i) => (
                <li key={i} className={t.done ? "done" : undefined}>
                  {course && t.section && <span className="muted small">{t.section} › </span>}
                  {t.title}
                  {t.steps.length > 0 && <span className="muted small"> · {t.steps.length} {t.steps.length === 1 ? "step" : "steps"}</span>}
                </li>
              ))}
              {parsed.todos.length > 8 && <li className="muted small">and {parsed.todos.length - 8} more</li>}
            </ul>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <div className="dialog-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!parsed.todos.length || busy}>
            {parsed.todos.length ? `Add ${parsed.todos.length} to-dos` : "Add"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

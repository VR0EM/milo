// Dragging a task from the list beside the calendar onto the hours: the drop makes a block
// of time for that task. Pointer events instead of HTML drag and drop, which the Windows
// webview hands to its own file-drop handling.

import { create } from "zustand";
import type { Task } from "../../lib/types";

type DropTarget = (x: number, y: number, task: Task) => boolean;

interface TaskDragState {
  task: Task | null;
  x: number;
  y: number;
}

export const useTaskDrag = create<TaskDragState>(() => ({ task: null, x: 0, y: 0 }));

const targets = new Set<DropTarget>();

/** A place that accepts a dropped task. Returns a function that removes it again. */
export function addDropTarget(t: DropTarget) {
  targets.add(t);
  return () => {
    targets.delete(t);
  };
}

/** Starts watching a press on a task; it becomes a drag once the pointer has moved a little. */
export function pressTask(e: React.PointerEvent, task: Task) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  const onMove = (m: PointerEvent) => {
    if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
    dragging = true;
    document.body.classList.add("task-dragging");
    useTaskDrag.setState({ task, x: m.clientX, y: m.clientY });
  };
  const onUp = (u: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.classList.remove("task-dragging");
    useTaskDrag.setState({ task: null });
    if (!dragging || u.type === "pointercancel") return;
    for (const t of targets) if (t(u.clientX, u.clientY, task)) break;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

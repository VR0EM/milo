import { useUi } from "../lib/store";

export const PANEL_MIN = 260;
export const PANEL_MAX = 560;
export const PANEL_DEFAULT = 300;

/**
 * The panel on the right (event, task, focus). Its left edge can be dragged to make it wider or
 * narrower; a double-click on the edge puts it back. The width is the same for all of them and
 * is remembered.
 */
export function SidePanel({ label, children }: { label: string; children: React.ReactNode }) {
  const width = useUi((s) => s.panelWidth);
  return (
    <aside className="panel" aria-label={label} style={{ width }}>
      <PanelEdge />
      <div className="panel-scroll">{children}</div>
    </aside>
  );
}

function PanelEdge() {
  const press = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = useUi.getState().panelWidth;
    // Never so wide that the calendar or list next to it gets cramped.
    const max = Math.min(PANEL_MAX, window.innerWidth - 640);
    document.body.classList.add("resizing-panel");
    const onMove = (m: PointerEvent) => useUi.setState({ panelWidth: Math.round(Math.min(Math.max(PANEL_MIN, w0 + x0 - m.clientX), Math.max(PANEL_MIN, max))) });
    const onUp = () => {
      document.body.classList.remove("resizing-panel");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div
      className="panel-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width: drag, or double-click to reset"
      title="Drag to make wider or narrower; double-click to reset"
      onPointerDown={press}
      onDoubleClick={() => useUi.setState({ panelWidth: PANEL_DEFAULT })}
    />
  );
}

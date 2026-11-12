import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/Icon";
import { api, miniExpanded, setMiniExpanded, startWindowDrag } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useSpaces } from "../../lib/queries";
import { fmtClock } from "../../lib/time";
import { useAppearance } from "../../lib/useAppearance";
import { useNow } from "../../lib/useNow";

/**
 * The small always-on-top focus timer. Compact it shows only the time; a click opens the
 * options (what you work on, Open Milo, Save) and a click on the time closes them again.
 * Dragging anywhere moves the window. It closes itself when the session ends anywhere.
 */
export function MiniTimer() {
  useAppearance();
  const now = useNow(1000);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(miniExpanded);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const { data: session, isFetched } = useQuery({ queryKey: ["focus"], queryFn: api.activeFocus, refetchInterval: 2000 });
  const space = (useSpaces().data ?? []).find((s) => s.id === session?.spaceId);

  useEffect(() => {
    document.documentElement.classList.add("mini-window");
  }, []);
  useEffect(() => {
    if (isFetched && !session) api.closeFocusMini();
  }, [isFetched, session]);

  if (!session) return null;
  const planned = session.plannedMinutes * 60_000;
  const elapsed = now.getTime() - new Date(session.startedAt).getTime();
  const over = elapsed >= planned;
  const clock = over ? `+${fmtClock(elapsed - planned)}` : fmtClock(planned - elapsed);

  const toggle = async () => {
    const next = !expanded;
    setMiniExpanded(next);
    await api.sizeFocusMini(next).catch(() => {});
    setExpanded(next);
  };

  // A press that does not move is a click (toggle); one that moves drags the window.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.dragging || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 3) return;
    p.dragging = true;
    startWindowDrag().catch(() => {});
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || p.dragging) return;
    // Open from anywhere; once open, only the time closes it again.
    if (!expanded || (e.target as HTMLElement).closest(".mini-clock")) toggle();
  };

  const finish = async () => {
    await api.finishFocus(session.id);
    qc.invalidateQueries();
  };

  return (
    <div
      className={`mini ${expanded ? "expanded" : "compact"}`}
      style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={expanded ? "Click the time to make it small · drag to move" : "Click for options · drag to move"}
    >
      <div className="mini-text">
        <div className={`mini-clock tabular${over ? " over" : ""}`} role="timer" aria-label={over ? "Over the planned time" : "Time left"}>
          {clock}
        </div>
        {expanded && (
          <div className="mini-what">
            <span className="swatch big-sq" />
            <span className="ellipsis">{session.title || space?.name || "Focus"}</span>
          </div>
        )}
      </div>
      {expanded && (
        <div className="mini-actions">
          <button className="icon-btn" title="Open Milo" aria-label="Open Milo" onClick={() => api.showMainWindow()}>
            <Icon name="today" size={15} />
          </button>
          <button className="btn primary small" onClick={finish} title="Stop and save to the calendar">Save</button>
        </div>
      )}
      <div className="mini-progress-bar"><span style={{ width: `${Math.min(1, elapsed / planned) * 100}%` }} /></div>
    </div>
  );
}

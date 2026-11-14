import { useEffect, useRef, useState } from "react";
import { Icon, SpaceMark, type IconName } from "../../components/Icon";
import { colorVar } from "../../lib/colors";
import { useAction, useActiveFocus, useGroups, useInbox, useSpaces } from "../../lib/queries";
import { api } from "../../lib/api";
import { useUi, type View } from "../../lib/store";
import { fmtClock } from "../../lib/time";
import type { Space } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { installUpdate, useUpdates } from "../../lib/updates";
import { MOD_ARIA, MOD_LABEL } from "../shortcuts/keys";

export const NAV: [View, string, IconName][] = [
  ["today", "Today", "today"],
  ["calendar", "Calendar", "calendar"],
  ["tasks", "Tasks", "tasks"],
  ["insights", "Insights", "insights"],
  ["reminders", "Reminders", "reminders"],
];

/** A quiet reminder that a focus session is running, visible from every screen. */
function FocusIndicator() {
  const session = useActiveFocus().data;
  const now = useNow(1000);
  if (!session) return null;
  const left = session.plannedMinutes * 60_000 - (now.getTime() - new Date(session.startedAt).getTime());
  return (
    <button className="focus-indicator" onClick={() => useUi.getState().setView("today")}>
      <Icon name="focus" />
      <span>Focus</span>
      <span className="tabular">{left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`}</span>
    </button>
  );
}

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <rect width="18" height="18" rx="5" fill="currentColor" />
      <rect x="4" y="4.5" width="10" height="2.2" rx="1.1" fill="var(--sunken)" />
      <rect x="4" y="7.9" width="7" height="2.2" rx="1.1" fill="var(--sunken)" opacity="0.8" />
      <rect x="4" y="11.3" width="4.6" height="2.2" rx="1.1" fill="var(--sunken)" opacity="0.6" />
    </svg>
  );
}

function NavButton({ view: v, label, icon, shortcut }: { view: View; label: string; icon: IconName; shortcut: string }) {
  const view = useUi((s) => s.view);
  return (
    <button
      className={view === v ? "current" : ""}
      aria-current={view === v ? "page" : undefined}
      aria-keyshortcuts={`${MOD_ARIA}+${shortcut}`}
      title={`${label} (${MOD_LABEL}${shortcut})`}
      onClick={() => useUi.getState().setView(v)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {v === "today" && <InboxCount />}
    </button>
  );
}

/** How many quick notes wait in the Inbox on Today. */
function InboxCount() {
  const n = useInbox().data?.length ?? 0;
  return n ? <span className="count" aria-label={`${n} notes in the inbox`}>{n}</span> : null;
}

/** "+" next to Spaces: a new space or a new group. */
function AddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (kind: "space" | "group") => {
    setOpen(false);
    useUi.getState().openDialog(kind === "space" ? { kind: "space", groupId: null } : { kind: "group" });
  };
  return (
    <div className="add-menu" ref={ref}>
      <button className="icon-btn" title="Add a space or group" aria-label="Add a space or group" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => pick("space")}>New space</button>
          <button role="menuitem" onClick={() => pick("group")}>New group</button>
        </div>
      )}
    </div>
  );
}

/** A quiet line above Settings when a new version is ready; nothing installs without a click. */
function UpdateNotice() {
  const { available, status, progress } = useUpdates();
  if (!available) return null;
  return (
    <div className="update-notice" role="status">
      <span>Milo {available.version} is ready</span>
      {status === "installing" ? (
        <span className="muted small">{progress === null ? "Installing…" : `Downloading ${Math.round(progress * 100)}%`}</span>
      ) : (
        <button className="link" onClick={() => installUpdate()}>Install and restart</button>
      )}
    </div>
  );
}

/** The screens in the sidebar, without the ones hidden in Settings. Cmd/Ctrl+1… follow this. */
export const visibleNav = (hidden: View[]) => NAV.filter(([v]) => v === "today" || !hidden.includes(v));

export function Sidebar() {
  const hiddenScreens = useUi((s) => s.prefs.hiddenScreens);
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const collapsed = useUi((s) => s.collapsedGroups);
  const view = useUi((s) => s.view);
  const spaceViewId = useUi((s) => s.spaceViewId);
  const { toggleSpace, toggleGroup, openDialog } = useUi.getState();

  const groupIds = new Set(groups.map((g) => g.id));
  const loose = spaces.filter((s) => !s.groupId || !groupIds.has(s.groupId));

  // ---- dragging a space up or down within its list sets the order -------------------------
  const reorder = useAction("spaces");
  const [drag, setDrag] = useState<{ id: string; ids: string[]; over: number } | null>(null);
  const justDragged = useRef(false);
  const pressRow = (e: React.PointerEvent, s: Space, list: Space[]) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".space-toggle, .link")) return;
    const y0 = e.clientY;
    const ids = list.map((x) => x.id);
    let moving = false;
    let over = ids.indexOf(s.id);
    const onMove = (m: PointerEvent) => {
      if (!moving && Math.abs(m.clientY - y0) < 5) return;
      moving = true;
      justDragged.current = true;
      over = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const r = document.querySelector(`[data-space-row="${ids[i]}"]`)?.getBoundingClientRect();
        if (r && m.clientY < r.top + r.height / 2) {
          over = i;
          break;
        }
      }
      setDrag({ id: s.id, ids, over });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      setTimeout(() => (justDragged.current = false), 0);
      if (!moving) return;
      const from = ids.indexOf(s.id);
      const next = ids.filter((x) => x !== s.id);
      next.splice(over > from ? over - 1 : over, 0, s.id);
      if (next.join() !== ids.join()) reorder.mutate(() => api.reorderSpaces(next));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // The coloured square shows or hides the space in the calendar; the name opens its overview.
  const row = (s: Space, list: Space[]) => {
    const shown = !hidden.includes(s.id);
    const current = view === "space" && spaceViewId === s.id;
    const i = list.indexOf(s);
    const dropHere = drag && drag.ids.includes(s.id) && drag.over === i && drag.id !== s.id;
    const dropAfter = drag && drag.ids.includes(s.id) && drag.over === list.length && i === list.length - 1;
    return (
      <li
        key={s.id}
        data-space-row={s.id}
        onPointerDown={(e) => pressRow(e, s, list)}
        className={[
          "side-row space-row-side",
          current ? "current" : "",
          shown ? "" : "hidden-space",
          drag?.id === s.id ? "dragging" : "",
          dropHere ? "drop-before" : "",
          dropAfter ? "drop-after" : "",
        ].join(" ")}
      >
        <label className="space-toggle" title={shown ? "Hide in the calendar" : "Show in the calendar"} style={{ ["--c" as string]: colorVar(s.color) }}>
          <input type="checkbox" aria-label={`Show ${s.name} in the calendar`} checked={shown} onChange={() => toggleSpace(s.id)} />
          <SpaceMark icon={s.icon} filled={false} />
        </label>
        <button className="space-open" aria-current={current ? "page" : undefined} title="Open, or drag to reorder" onClick={() => !justDragged.current && useUi.getState().openSpace(s.id)}>
          <span className="side-name">{s.name}</span>
        </button>
        <button className="link" onClick={() => openDialog({ kind: "space", item: s })}>Edit</button>
      </li>
    );
  };

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <BrandMark />
        <span>Milo</span>
      </div>

      <ul className="nav">
        {visibleNav(hiddenScreens).map(([v, label, icon], i) => (
          <li key={v}>
            <NavButton view={v} label={label} icon={icon} shortcut={String(i + 1)} />
          </li>
        ))}
      </ul>
      <FocusIndicator />

      <section className="side-spaces" aria-label="Spaces">
        <div className="side-head">
          <h2>Spaces</h2>
          <AddMenu />
        </div>
        <ul>{loose.map((s) => row(s, loose))}</ul>
        {groups.map((g) => {
          const members = spaces.filter((s) => s.groupId === g.id);
          const open = !collapsed.includes(g.id);
          return (
            <div key={g.id} className="side-group">
              <div className="side-row group-row">
                <button className="group-toggle" aria-expanded={open} onClick={() => toggleGroup(g.id)}>
                  <span className={`chev${open ? " open" : ""}`}><Icon name="chevron" size={12} /></span>
                  <span className="side-name">{g.name}</span>
                  {!open && <span className="count">{members.length}</span>}
                </button>
                <button className="link" onClick={() => openDialog({ kind: "group", item: g })}>Edit</button>
              </div>
              {open && (
                <ul className="group-members">
                  {members.map((s) => row(s, members))}
                  {members.length === 0 && (
                    <li className="side-row">
                      <button className="link side-add" onClick={() => openDialog({ kind: "space", groupId: g.id })}>
                        <Icon name="plus" size={12} /> Add a space
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <UpdateNotice />
      <div className="side-foot">
        <NavButton view="settings" label="Settings" icon="settings" shortcut="," />
      </div>
    </nav>
  );
}

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { colorVar } from "../../lib/colors";
import { useActiveFocus, useGroups, useSpaces } from "../../lib/queries";
import { useUi, type View } from "../../lib/store";
import { fmtClock } from "../../lib/time";
import type { Space } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { MOD_ARIA, MOD_LABEL } from "../shortcuts/keys";

export const NAV: [View, string, IconName][] = [
  ["today", "Today", "today"],
  ["calendar", "Calendar", "calendar"],
  ["tasks", "Tasks", "tasks"],
  ["insights", "Insights", "insights"],
  ["reminders", "Reminders", "reminders"],
  ["import", "Import & export", "import"],
  ["archive", "Archive", "archive"],
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

function BrandMark() {
  return (
    <svg className="brand-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
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
    </button>
  );
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

export function Sidebar() {
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const collapsed = useUi((s) => s.collapsedGroups);
  const { toggleSpace, toggleGroup, openDialog } = useUi.getState();

  const groupIds = new Set(groups.map((g) => g.id));
  const loose = spaces.filter((s) => !s.groupId || !groupIds.has(s.groupId));

  const row = (s: Space) => (
    <li key={s.id} className="side-row">
      <label className="space-toggle">
        <input type="checkbox" aria-label={`Show ${s.name}`} checked={!hidden.includes(s.id)} onChange={() => toggleSpace(s.id)} />
        <span className="swatch" style={{ ["--c" as string]: colorVar(s.color) }} />
        <span className="side-name">{s.name}</span>
      </label>
      <button className="link" onClick={() => openDialog({ kind: "space", item: s })}>Edit</button>
    </li>
  );

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <BrandMark />
        <span>Milo</span>
      </div>

      <ul className="nav">
        {NAV.map(([v, label, icon], i) => (
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
        <ul>{loose.map(row)}</ul>
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
              {open && <ul className="group-members">{members.map(row)}</ul>}
            </div>
          );
        })}
      </section>

      <div className="side-foot">
        <NavButton view="settings" label="Settings" icon="settings" shortcut="," />
      </div>
    </nav>
  );
}

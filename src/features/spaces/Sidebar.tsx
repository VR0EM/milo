import { useEffect, useRef, useState } from "react";
import { Icon, SpaceMark, type IconName } from "../../components/Icon";
import { colorVar } from "../../lib/colors";
import { useAction, useActiveFocus, useArchiveWithUndo, useGroups, useInbox, useSpaces } from "../../lib/queries";
import { api } from "../../lib/api";
import { useUi, type View } from "../../lib/store";
import { fmtClock } from "../../lib/time";
import type { Group, Space } from "../../lib/types";
import { openContextMenu, type MenuItem } from "../../components/ContextMenu";
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

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    // Milo's logo (src-tauri/icons/app-icon.svg): three columns of blocks, like a week planned.
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <rect width="256" height="256" rx="54" fill="#1E293B" />
      <rect x="43" y="43" width="48" height="170" rx="10" fill="#38BDF8" />
      <rect x="104" y="43" width="48" height="105" rx="10" fill="#A78BFA" />
      <rect x="104" y="161" width="48" height="52" rx="10" fill="#F472B6" />
      <rect x="165" y="43" width="48" height="52" rx="10" fill="#FB923C" />
      <rect x="165" y="108" width="48" height="105" rx="10" fill="#4ADE80" />
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
  const defaultSpaceId = useUi((s) => s.prefs.defaultSpaceId);
  const view = useUi((s) => s.view);
  const spaceViewId = useUi((s) => s.spaceViewId);
  const { toggleSpace, toggleGroup, openDialog } = useUi.getState();
  const archive = useArchiveWithUndo();

  // Right-click: the things to do with a space or group, and making new ones, in one place.
  const newItems = (groupId: string | null, groupName?: string): MenuItem[] => [
    { label: groupName ? `New space in ${groupName}` : "New space", run: () => openDialog({ kind: "space", groupId }) },
    { label: "New group", run: () => openDialog({ kind: "group" }) },
  ];
  const spaceMenu = (e: React.MouseEvent, s: Space) => {
    const group = groups.find((g) => g.id === s.groupId);
    const shown = !hidden.includes(s.id);
    const isDefault = useUi.getState().prefs.defaultSpaceId === s.id;
    openContextMenu(e, [
      { label: "Open", run: () => useUi.getState().openSpace(s.id) },
      {
        label: isDefault ? "Stop using as default" : "Use for new events and tasks",
        run: () => useUi.getState().setPrefs({ defaultSpaceId: isDefault ? null : s.id }),
      },
      { label: "Edit…", run: () => openDialog({ kind: "space", item: s }) },
      { label: shown ? "Hide in the calendar" : "Show in the calendar", run: () => toggleSpace(s.id) },
      "separator",
      ...newItems(group?.id ?? null, group?.name),
      "separator",
      // At least one space is needed, as in the Edit dialog.
      { label: "Archive", danger: true, disabled: spaces.length <= 1, run: () => archive("space", s.id, s.name) },
    ]);
  };
  const groupMenu = (e: React.MouseEvent, g: Group, open: boolean) =>
    openContextMenu(e, [
      { label: open ? "Fold" : "Unfold", run: () => toggleGroup(g.id) },
      { label: "Edit…", run: () => openDialog({ kind: "group", item: g }) },
      "separator",
      ...newItems(g.id, g.name),
      "separator",
      { label: "Archive", danger: true, run: () => archive("group", g.id, g.name) },
    ]);

  const groupIds = new Set(groups.map((g) => g.id));
  const loose = spaces.filter((s) => !s.groupId || !groupIds.has(s.groupId));

  // ---- dragging a space up or down within its list sets the order -------------------------
  const reorder = useAction("spaces", "groups");
  // Where a dragged space would land: a list (a group's id, or null for the spaces without a
  // group) and a place in it.
  type Target = { list: string | null; index: number };
  const [drag, setDrag] = useState<{ id: string; target: Target | null } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{ id: string; over: number } | null>(null);
  const justDragged = useRef(false);
  const listOf = (list: string | null) => (list ? spaces.filter((x) => x.groupId === list) : loose).map((x) => x.id);
  const listKey = (s: Space) => (s.groupId && groupIds.has(s.groupId) ? s.groupId : null);

  /** The place under the pointer, across all lists: before a space, or at the end of a list. */
  const targetAt = (y: number): Target => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-space-row], [data-group-head]")) {
      const r = el.getBoundingClientRect();
      if (y >= r.top + r.height / 2) continue;
      if (el.dataset.spaceRow) {
        const list = el.dataset.list || null;
        return { list, index: listOf(list).indexOf(el.dataset.spaceRow) };
      }
      // Above a group's header: the end of the list just before it.
      const prev = el.dataset.prevList || null;
      return { list: prev, index: listOf(prev).length };
    }
    const last = groups.length ? groups[groups.length - 1].id : null;
    return { list: last, index: listOf(last).length };
  };

  // Drag a space up or down: within its list, into another group, or out of every group.
  const pressRow = (e: React.PointerEvent, s: Space) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".space-toggle, .link")) return;
    const y0 = e.clientY;
    let moving = false;
    let target: Target | null = null;
    const onMove = (m: PointerEvent) => {
      if (!moving && Math.abs(m.clientY - y0) < 5) return;
      moving = true;
      justDragged.current = true;
      target = targetAt(m.clientY);
      setDrag({ id: s.id, target });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      setTimeout(() => (justDragged.current = false), 0);
      if (!moving || !target) return;
      const t: Target = target;
      const from = listKey(s);
      const before = listOf(t.list);
      const ids = before.filter((x) => x !== s.id);
      let at = t.index;
      if (t.list === from && at > before.indexOf(s.id)) at--;
      ids.splice(at, 0, s.id);
      if (t.list !== from) reorder.mutate(() => api.moveSpace(s.id, t.list, ids));
      else if (ids.join() !== before.join()) reorder.mutate(() => api.reorderSpaces(ids));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Drag a group by its header to put it before or after the other groups.
  const pressGroup = (e: React.PointerEvent, g: Group) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".link")) return;
    const y0 = e.clientY;
    const ids = groups.map((x) => x.id);
    let moving = false;
    let over = ids.indexOf(g.id);
    const onMove = (m: PointerEvent) => {
      if (!moving && Math.abs(m.clientY - y0) < 5) return;
      moving = true;
      justDragged.current = true;
      over = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const r = document.querySelector(`[data-group-block="${ids[i]}"]`)?.getBoundingClientRect();
        if (r && m.clientY < r.top + Math.min(r.height, 60) / 2) { over = i; break; }
      }
      setGroupDrag({ id: g.id, over });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGroupDrag(null);
      setTimeout(() => (justDragged.current = false), 0);
      if (!moving) return;
      const from = ids.indexOf(g.id);
      const next = ids.filter((x) => x !== g.id);
      next.splice(over > from ? over - 1 : over, 0, g.id);
      if (next.join() !== ids.join()) reorder.mutate(() => api.reorderGroups(next));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // The coloured square shows or hides the space in the calendar; the name opens its overview.
  const row = (s: Space, list: Space[]) => {
    const key = listKey(s);
    const shown = !hidden.includes(s.id);
    const isDefault = defaultSpaceId === s.id;
    const current = view === "space" && spaceViewId === s.id;
    const i = list.indexOf(s);
    const t = drag?.target;
    const dropHere = !!t && t.list === key && t.index === i && drag!.id !== s.id;
    const dropAfter = !!t && t.list === key && t.index === list.length && i === list.length - 1 && drag!.id !== s.id;
    return (
      <li
        key={s.id}
        data-space-row={s.id}
        data-list={key ?? ""}
        onPointerDown={(e) => pressRow(e, s)}
        onContextMenu={(e) => spaceMenu(e, s)}
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
        <button className="space-open" aria-current={current ? "page" : undefined} title="Open, or drag to move" onClick={() => !justDragged.current && useUi.getState().openSpace(s.id)}>
          <span className="side-name">{s.name}</span>
          {isDefault && <span className="side-default" title="New events and tasks go here (right-click to change)">default</span>}
        </button>
        <button className="link" onClick={() => openDialog({ kind: "space", item: s })}>Edit</button>
      </li>
    );
  };

  return (
    // Right-click anywhere else in the sidebar: make a new space or group.
    <nav className="sidebar" aria-label="Main" onContextMenu={(e) => openContextMenu(e, newItems(null))}>
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
        {groups.map((g, gi) => {
          const members = spaces.filter((s) => s.groupId === g.id);
          const open = !collapsed.includes(g.id);
          // A space dropped on a folded or empty group goes into it: the header lights up.
          const into = drag?.target?.list === g.id && (!open || members.length === 0);
          const gd = groupDrag;
          return (
            <div
              key={g.id}
              data-group-block={g.id}
              className={[
                "side-group",
                gd?.id === g.id ? "dragging" : "",
                gd && gd.over === gi && gd.id !== g.id ? "drop-before" : "",
                gd && gd.over === groups.length && gi === groups.length - 1 ? "drop-after" : "",
              ].join(" ")}
            >
              <div
                className={`side-row group-row${into ? " drop-into" : ""}`}
                data-group-head={g.id}
                data-prev-list={gi === 0 ? "" : groups[gi - 1].id}
                onPointerDown={(e) => pressGroup(e, g)}
                onContextMenu={(e) => groupMenu(e, g, open)}
              >
                <button className="group-toggle" aria-expanded={open} title="Fold, or drag to move" onClick={() => !justDragged.current && toggleGroup(g.id)}>
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

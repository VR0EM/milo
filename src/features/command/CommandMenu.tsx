import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAction, useCreateEvent, useEvents, useSpaces, useTasks } from "../../lib/queries";
import { INBOX_ID } from "../../lib/types";
import { pickDefaultSpace } from "../../lib/spaces";
import { preferredSpace, useUi, type View } from "../../lib/store";
import {
  addDays,
  atMinutes,
  fmtDateField,
  fmtMoment,
  fromDateInput,
  minutesIntoDay,
  parseDate,
  startOfDay,
} from "../../lib/time";
import { Icon, type IconName } from "../../components/Icon";
import { NAV, visibleNav } from "../spaces/Sidebar";
import { MOD_LABEL } from "../shortcuts/keys";

interface Item {
  id: string;
  group: string;
  label: string;
  /** Extra words it can be found by. */
  words?: string;
  /** A second, quieter line: when, or which space. */
  note?: string;
  /** The key that does the same outside this menu. */
  keys?: string;
  icon?: IconName;
  run: () => void;
}

const MAX_FOUND = 5;

/** Every word typed appears somewhere in the label or its extra words (not in the date beside it). */
function matches(item: Item, words: string[]) {
  const hay = `${item.label} ${item.words ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Cmd+K: one place to go anywhere and do the common things by typing, with each command's own
 * shortcut next to it, so the shortcuts are learned along the way. Typing a date ("19 nov",
 * "fri") offers to open the calendar there; typing part of a task, event or space finds it.
 */
export function CommandMenu() {
  const open = useUi((s) => s.commandOpen);
  if (!open) return null;
  return <Menu />;
}

function Menu() {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hiddenScreens = useUi((s) => s.prefs.hiddenScreens);
  const lastSpaceId = useUi(preferredSpace);
  const eventMinutes = useUi((s) => s.prefs.eventMinutes);
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const tasks = useTasks().data ?? [];
  // Events from a month back to four months ahead: enough to find what is meant.
  const [range] = useState(() => {
    const today = startOfDay(new Date());
    return [addDays(today, -30), addDays(today, 120)] as const;
  });
  const events = useEvents(range[0], range[1]).data ?? [];
  const createEvent = useCreateEvent();
  const act = useAction("tasks");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => useUi.setState({ commandOpen: false });
  const ui = useUi.getState();
  const go = (view: View) => ui.setView(view);
  const defaultSpaceId = pickDefaultSpace(spaces, lastSpaceId)?.id ?? null;

  const items = useMemo((): Item[] => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list: Item[] = [];

    // A typed date comes first: that is almost certainly what was meant.
    const date = parseDate(query);
    if (date) {
      list.push({
        id: `date-${date}`,
        group: "Go to",
        label: `Calendar on ${fmtDateField(fromDateInput(date))}`,
        icon: "calendar",
        run: () => {
          go("calendar");
          useUi.getState().showDate(fromDateInput(date));
        },
      });
    }

    const commands: Item[] = [
      ...visibleNav(hiddenScreens).map(([view, label, icon], i): Item => ({
        id: `view-${view}`, group: "Go to", label, icon, keys: `${MOD_LABEL}${i + 1}`, run: () => go(view),
      })),
      // Screens left out of the sidebar can still be reached here.
      ...NAV.filter(([v]) => v !== "today" && hiddenScreens.includes(v)).map(([view, label, icon]): Item => ({
        id: `view-${view}`, group: "Go to", label, icon, run: () => go(view),
      })),
      { id: "view-settings", group: "Go to", label: "Settings", icon: "settings", keys: `${MOD_LABEL},`, run: () => go("settings") },
      {
        id: "cal-today", group: "Calendar", label: "Go to today", words: "now", icon: "calendar", keys: "T",
        run: () => { go("calendar"); useUi.getState().showDate(new Date()); },
      },
      ...([["1", "Day view", "D"], ["3", "3 days", "3"], ["7", "7 days from today", "7"]] as const).map(
        ([n, label, keys]): Item => ({
          id: `cal-days-${n}`, group: "Calendar", label, words: "show calendar day days", icon: "calendar", keys,
          run: () => { go("calendar"); useUi.getState().setDayCount(Number(n)); },
        }),
      ),
      ...([["week", "Week view", "W"], ["month", "Month view", "M"]] as const).map(
        ([mode, label, keys]): Item => ({
          id: `cal-${mode}`, group: "Calendar", label, words: "show calendar", icon: "calendar", keys,
          run: () => { go("calendar"); useUi.getState().setCalMode(mode); },
        }),
      ),
      {
        id: "new-event", group: "Make", label: "New event", words: "add create appointment", icon: "plus", keys: "N",
        run: () => {
          if (!defaultSpaceId) return;
          const now = new Date();
          const start = atMinutes(startOfDay(now), Math.ceil(minutesIntoDay(now) / 30) * 30);
          go("calendar");
          useUi.getState().showDate(start);
          createEvent.mutate(
            {
              spaceId: defaultSpaceId, activityId: null, title: "", allDay: false, notes: "", status: "planned",
              startAt: start.toISOString(), endAt: new Date(start.getTime() + eventMinutes * 60_000).toISOString(),
            },
            { onSuccess: (created) => useUi.getState().select(created.id, true) },
          );
        },
      },
      {
        id: "new-task", group: "Make", label: "New to-do", words: "add create assignment task todo", icon: "tasks", keys: "N",
        run: () => {
          go("tasks");
          act.mutate(
            () => api.createTask({ spaceId: INBOX_ID, typeId: null, title: "", notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: null }),
            { onSuccess: (t) => useUi.getState().selectTask((t as { id: string }).id, true) },
          );
        },
      },
      {
        id: "note", group: "Make", label: "Write something down", words: "note inbox capture", icon: "pen",
        run: () => {
          go("today");
          // The field on Today's to-dos, once Today is on screen.
          setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Write something down for today"]')?.focus(), 50);
        },
      },
      {
        id: "pick-today", group: "Make", label: "Choose what to do today", words: "today plan pick todo", icon: "today",
        run: () => {
          go("today");
          useUi.setState({ pickTodayOpen: true });
        },
      },
      { id: "go-inbox", group: "Make", label: "Sort the Inbox", words: "inbox notes sort", icon: "tasks", run: () => useUi.getState().openTasks("inbox") },
      { id: "help-keys", group: "Help", label: "Keyboard shortcuts", icon: "book", keys: "?", run: () => useUi.setState({ shortcutsOpen: true }) },
      { id: "help-new", group: "Help", label: "What's new", words: "changes update version", icon: "star", run: () => useUi.setState({ whatsNewOpen: true }) },
      { id: "help-guide", group: "Help", label: "Welcome guide", words: "setup start", icon: "home", run: () => useUi.setState({ setupOpen: true }) },
    ];
    list.push(...(words.length ? commands.filter((c) => matches(c, words)) : commands));

    if (words.length) {
      const found = <T,>(xs: T[], make: (x: T) => Item) => xs.map(make).filter((i) => matches(i, words)).slice(0, MAX_FOUND);
      list.push(
        ...found(spaces, (s) => ({ id: `space-${s.id}`, group: "Spaces", label: s.name, icon: "home" as IconName, run: () => useUi.getState().openSpace(s.id) })),
        ...found(
          [...tasks].sort((a, b) => Number(!!a.completedAt) - Number(!!b.completedAt)),
          (t) => ({
            id: `task-${t.id}`,
            group: "Tasks",
            label: t.title || "Untitled",
            note: [t.completedAt ? "done" : "", t.deadlineAt ? `due ${fmtMoment(new Date(t.deadlineAt))}` : ""].filter(Boolean).join(" · "),
            icon: "tasks" as IconName,
            run: () => { go("tasks"); useUi.getState().selectTask(t.id); },
          }),
        ),
        ...found(
          // The coming ones first, then the most recent past ones.
          [...events].sort((a, b) => {
            const now = Date.now();
            const fa = new Date(a.endAt).getTime() >= now;
            const fb = new Date(b.endAt).getTime() >= now;
            return fa !== fb ? (fa ? -1 : 1) : fa ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt);
          }),
          (e) => ({
            id: `event-${e.id}`,
            group: "Events",
            label: e.title || "Untitled",
            note: e.allDay ? fmtDateField(new Date(e.startAt)) : fmtMoment(new Date(e.startAt)),
            icon: "calendar" as IconName,
            run: () => { go("calendar"); useUi.getState().showDate(new Date(e.startAt)); useUi.getState().select(e.id); },
          }),
        ),
      );
    }
    return list;
  }, [query, hiddenScreens, spaces, tasks, events, defaultSpaceId, eventMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    ref.current?.close();
    item.run();
  };

  let lastGroup = "";
  return (
    <dialog ref={ref} className="dialog command-menu" onClose={close} aria-label="Commands">
      <div className="command-search">
        <Icon name="search" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
          aria-label="Type a command, a date, or what you are looking for"
          placeholder="Type a command, a date, or a task…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(items[active]);
            }
          }}
        />
      </div>
      <ul className="command-list" id="command-list" role="listbox" ref={listRef}>
        {items.length === 0 && <li className="command-empty muted">Nothing found. Try a shorter word, or a date like "19 nov".</li>}
        {items.map((item, i) => {
          const head = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <li key={item.id} role="presentation">
              {head && <div className="command-group" role="presentation">{head}</div>}
              <div
                id={`cmd-${item.id}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                className={`command-item${i === active ? " active" : ""}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => run(item)}
              >
                {item.icon && <Icon name={item.icon} size={15} />}
                <span className="command-label">{item.label}</span>
                {item.note && <span className="command-note">{item.note}</span>}
                {item.keys && <kbd className="command-keys">{item.keys}</kbd>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="command-foot muted">
        <span><kbd>↑</kbd> <kbd>↓</kbd> choose</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAction, useCreateEvent, useSearch, useSpaces } from "../../lib/queries";
import { eventWhen, openEvent, openTask, taskWhen } from "../search/found";
import { INBOX_ID } from "../../lib/types";
import { pickDefaultSpace } from "../../lib/spaces";
import { preferredSpace, useUi, type View } from "../../lib/store";
import {
  atMinutes,
  fmtDateField,
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
  // Every event and to-do of any date, found in Rust (search.rs).
  const found = useSearch(query).data;
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
      // The way out when her own CSS hid or broke a screen.
      ...(useUi.getState().prefs.customCssOn && useUi.getState().prefs.customCss.trim()
        ? [{ id: "custom-css-off", group: "Go to", label: "Turn off custom CSS", words: "style theme reset", icon: "settings", run: () => useUi.getState().setPrefs({ customCssOn: false }) } as Item]
        : []),
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
      list.push(
        ...spaces
          .map((s): Item => ({ id: `space-${s.id}`, group: "Spaces", label: s.name, icon: "home", run: () => useUi.getState().openSpace(s.id) }))
          .filter((i) => matches(i, words))
          .slice(0, MAX_FOUND),
      );
      const events = found?.events ?? [];
      const eventItem = (h: (typeof events)[number]): Item => ({
        id: `event-${h.title}-${h.spaceId}`,
        group: h.next ? "Coming" : "Earlier",
        label: h.title || "Untitled",
        note: [h.location, eventWhen(h)].filter(Boolean).join(" · "),
        icon: "calendar",
        run: () => openEvent((h.next ?? h.last)!),
      });
      list.push(...events.filter((h) => h.next).slice(0, MAX_FOUND).map(eventItem));
      list.push(...events.filter((h) => !h.next).slice(0, MAX_FOUND).map(eventItem));
      list.push(
        ...(found?.tasks ?? []).slice(0, MAX_FOUND).map((t): Item => ({
          id: `task-${t.id}`,
          group: "To-dos",
          label: t.title || "Untitled",
          note: taskWhen(t),
          icon: "tasks",
          run: () => openTask(t.id),
        })),
      );
      const total = events.length + (found?.tasks.length ?? 0);
      if (total > 0) {
        list.push({
          id: "search-all",
          group: "Search",
          label: `Show all results for “${query.trim()}”`,
          note: `${total}`,
          icon: "search",
          keys: `${MOD_LABEL}F`,
          run: () => useUi.getState().openSearch(query.trim()),
        });
      }
    }
    return list;
  }, [query, hiddenScreens, spaces, found, defaultSpaceId, eventMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

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
          placeholder="Type a command, a date, or what you are looking for…"
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

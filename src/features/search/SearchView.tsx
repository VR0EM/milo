// Search: every event (also long past) and every to-do (also done), in one list with simple
// filters. Opened with Cmd/Ctrl+F, or "Show all results" in the command menu.

import { useMemo, useState } from "react";
import { colorVar } from "../../lib/colors";
import { useAllSpaces, useSearch } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { EventHit, Space, TaskHit } from "../../lib/types";
import { Icon } from "../../components/Icon";
import { eventWhen, openEvent, openTask, taskWhen } from "./found";

type What = "all" | "events" | "todos";
type When = "any" | "coming" | "earlier";
const WHAT: [What, string][] = [["all", "All"], ["events", "Events"], ["todos", "To-dos"]];
const WHEN: [When, string][] = [["any", "Any time"], ["coming", "Coming"], ["earlier", "Earlier"]];

export function SearchView() {
  const query = useUi((s) => s.searchQuery);
  const [text, setText] = useState(query);
  const [what, setWhat] = useState<What>("all");
  const [when, setWhen] = useState<When>("any");
  const [spaceId, setSpaceId] = useState("");
  const spaces = useAllSpaces().data ?? [];
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const results = useSearch(text).data;
  const now = new Date().toISOString();

  const events = (results?.events ?? []).filter(
    (h) =>
      what !== "todos" &&
      (!spaceId || h.spaceId === spaceId) &&
      (when === "any" || (when === "coming" ? !!h.next : !!h.last)),
  );
  const tasks = (results?.tasks ?? []).filter(
    (t) =>
      what !== "events" &&
      (!spaceId || t.spaceId === spaceId) &&
      (when === "any" ||
        (when === "coming" ? !t.completedAt && (!t.deadlineAt || t.deadlineAt >= now) : !!t.completedAt || (!!t.deadlineAt && t.deadlineAt < now))),
  );
  const nothing = !!text.trim() && results && !events.length && !tasks.length;

  return (
    <main className="page full search-page">
      <header className="toolbar">
        <h1>Search</h1>
      </header>
      <div className="page-scroll">
        <div className="search-bar">
          <Icon name="search" />
          <input
            id="search-input"
            type="search"
            autoFocus
            value={text}
            placeholder="Events and to-dos, of any date"
            aria-label="Search events and to-dos"
            onChange={(e) => {
              setText(e.target.value);
              useUi.setState({ searchQuery: e.target.value });
            }}
          />
        </div>
        <div className="filter-bar" role="group" aria-label="Filters">
          <div className="segmented" role="radiogroup" aria-label="What">
            {WHAT.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={what === k} className={what === k ? "on" : ""} onClick={() => setWhat(k)}>{label}</button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="When">
            {WHEN.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={when === k} className={when === k ? "on" : ""} onClick={() => setWhen(k)}>{label}</button>
            ))}
          </div>
          <select aria-label="Space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className={spaceId ? "set" : ""}>
            <option value="">All spaces</option>
            {spaces.filter((s) => !s.deletedAt).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {nothing && <p className="muted">Nothing found for “{text.trim()}”.</p>}

        {events.length > 0 && (
          <section className="block search-results" aria-label="Events">
            <h2>Events <span className="muted small">{events.length}</span></h2>
            <ul>{events.map((h) => <EventRow key={`${h.title}|${h.spaceId}`} hit={h} space={spaceById.get(h.spaceId)} />)}</ul>
          </section>
        )}
        {tasks.length > 0 && (
          <section className="block search-results" aria-label="To-dos">
            <h2>To-dos <span className="muted small">{tasks.length}</span></h2>
            <ul>{tasks.map((t) => <TaskRow key={t.id} hit={t} space={spaceById.get(t.spaceId)} />)}</ul>
          </section>
        )}
      </div>
    </main>
  );
}

function EventRow({ hit, space }: { hit: EventHit; space?: Space }) {
  const target = hit.next ?? hit.last;
  return (
    <li>
      <button className="search-row" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }} onClick={() => target && openEvent(target)}>
        <i className="chip-dot" />
        <span className="search-title">{hit.title || "Untitled"}</span>
        {hit.location && <span className="small place">{hit.location}</span>}
        <span className="spacer" />
        <span className="muted small">{space?.name}</span>
        <span className="muted small tabular search-when">{eventWhen(hit)}</span>
      </button>
    </li>
  );
}

function TaskRow({ hit, space }: { hit: TaskHit; space?: Space }) {
  return (
    <li>
      <button className={`search-row${hit.completedAt ? " done" : ""}`} style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }} onClick={() => openTask(hit.id)}>
        <Icon name="tasks" size={14} />
        <span className="search-title">{hit.title || "Untitled"}</span>
        <span className="spacer" />
        <span className="muted small">{space?.kind === "inbox" ? "Inbox" : space?.name}</span>
        <span className="muted small tabular search-when">{taskWhen(hit)}</span>
      </button>
    </li>
  );
}

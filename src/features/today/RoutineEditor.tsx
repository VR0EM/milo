import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { DayToggles } from "../../components/DayToggles";
import { TimeField } from "../../components/TimeField";
import { useAction, useArchiveWithUndo } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { Routine, RoutineInput, RoutineItem } from "../../lib/types";

/** Edits one routine. Every field saves as soon as it changes, like the detail panels. */
export function RoutineEditor({ routines }: { routines: Routine[] }) {
  const id = useUi((s) => s.routineEditId);
  const routine = routines.find((r) => r.id === id);
  return routine ? <Editor key={routine.id} routine={routine} /> : null;
}

function Editor({ routine }: { routine: Routine }) {
  const ref = useRef<HTMLDialogElement>(null);
  const act = useAction("routines");
  const archive = useArchiveWithUndo();
  const [name, setName] = useState(routine.name);
  const [newItem, setNewItem] = useState("");
  const close = () => useUi.setState({ routineEditId: null });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const save = (patch: Partial<RoutineInput>) =>
    act.mutate(() =>
      api.updateRoutine(routine.id, {
        name: routine.name,
        startTime: routine.startTime,
        endTime: routine.endTime,
        weekdays: routine.weekdays,
        ...patch,
      }),
    );

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    act.mutate(() => api.createRoutineItem(routine.id, text));
  };

  return (
    <dialog ref={ref} className="dialog wide" onClose={close}>
      <form onSubmit={(e) => e.preventDefault()}>
        <h2>Edit routine</h2>

        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (name.trim() ? name !== routine.name && save({ name }) : setName(routine.name))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>From</span>
            <TimeField value={routine.startTime} onCommit={(t) => save({ startTime: t })} />
          </label>
          <label className="field">
            <span>Until{routine.endTime < routine.startTime ? " (next day)" : ""}</span>
            <TimeField value={routine.endTime} onCommit={(t) => save({ endTime: t })} />
          </label>
        </div>

        <fieldset className="field">
          <legend>Days</legend>
          <DayToggles value={routine.weekdays} onChange={(weekdays) => save({ weekdays })} />
        </fieldset>

        <fieldset className="field parts">
          <legend>Steps</legend>
          <ul>
            {routine.items.map((item) => <ItemRow key={item.id} item={item} />)}
          </ul>
          <div className="part-add">
            <input
              placeholder="Add a step, e.g. Take medication"
              aria-label="New step"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
            />
            <button type="button" className="btn" onClick={addItem} disabled={!newItem.trim()}>Add</button>
          </div>
        </fieldset>

        <div className="dialog-foot">
          <button
            type="button"
            className="btn quiet"
            onClick={() => {
              archive("routine", routine.id, routine.name);
              close();
            }}
          >
            Archive
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={close}>Done</button>
        </div>
      </form>
    </dialog>
  );
}

function ItemRow({ item }: { item: RoutineItem }) {
  const act = useAction("routines");
  const archive = useArchiveWithUndo();
  const [title, setTitle] = useState(item.title);
  const commit = () => {
    const text = title.trim();
    if (!text) setTitle(item.title);
    else if (text !== item.title) act.mutate(() => api.updateRoutineItem(item.id, text));
  };
  return (
    <li className="part-row">
      <input
        className="part-title"
        aria-label="Step"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" className="link" onClick={() => archive("routine_item", item.id, item.title)}>Archive</button>
    </li>
  );
}

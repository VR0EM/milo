import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { PALETTE, colorVar, isCustomColor } from "../../lib/colors";
import { useArchiveWithUndo, useGroups, useSpaces } from "../../lib/queries";
import { useUi, type Dialog } from "../../lib/store";
import type { ActivityCategory, SpaceRole } from "../../lib/types";

const TITLES = { space: "space", group: "group", activity: "activity", task_type: "task type" } as const;

export function EntityDialog() {
  const dialog = useUi((s) => s.dialog);
  return dialog ? <Form key={dialog.kind + (dialog.item?.id ?? "new")} dialog={dialog} /> : null;
}

function Form({ dialog }: { dialog: Dialog }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const close = () => useUi.getState().openDialog(null);
  const archive = useArchiveWithUndo();
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const activeSpaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);

  const item = dialog.item;
  const [name, setName] = useState(item?.name ?? "");
  const [color, setColor] = useState(dialog.kind === "space" ? (dialog.item?.color ?? "green") : "gray");
  const [groupId, setGroupId] = useState<string>(
    dialog.kind === "space" ? (dialog.item?.groupId ?? dialog.groupId ?? "") : "",
  );
  const [role, setRole] = useState<SpaceRole>(dialog.kind === "space" ? (dialog.item?.role ?? "normal") : "normal");
  const [category, setCategory] = useState<ActivityCategory>(
    dialog.kind === "activity" ? (dialog.item?.category ?? "other") : "other",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (dialog.kind === "space") {
        const input = { name, color, role, groupId: groupId || null };
        await (item ? api.updateSpace(item.id, input) : api.createSpace(input));
        qc.invalidateQueries({ queryKey: ["spaces"] });
      } else if (dialog.kind === "group") {
        await (item ? api.updateGroup(item.id, { name }) : api.createGroup({ name }));
        qc.invalidateQueries({ queryKey: ["groups"] });
      } else if (dialog.kind === "task_type") {
        await (item ? api.updateTaskType(item.id, name) : api.createTaskType(name));
        qc.invalidateQueries({ queryKey: ["taskTypes"] });
      } else {
        const input = { name, category };
        await (item ? api.updateActivity(item.id, input) : api.createActivity(input));
        qc.invalidateQueries({ queryKey: ["activities"] });
      }
      close();
    } catch (err) {
      setError(String(err));
    }
  }

  const lastSpace = dialog.kind === "space" && activeSpaces.length <= 1;

  return (
    <dialog ref={ref} className="dialog" onClose={close}>
      <form onSubmit={submit}>
        <h2>{item ? `Edit ${TITLES[dialog.kind]}` : `New ${TITLES[dialog.kind]}`}</h2>

        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {dialog.kind === "space" && (
          <>
            <fieldset className="field">
              <legend>Colour</legend>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <label key={c} title={c}>
                    <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} />
                    <span className="swatch big" style={{ ["--c" as string]: colorVar(c) }} />
                  </label>
                ))}
                <label title="Your own colour" className="custom-swatch">
                  <input
                    type="color"
                    aria-label="Your own colour"
                    value={isCustomColor(color) ? color : "#3fa7d6"}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <span
                    className={`swatch big${isCustomColor(color) ? " picked" : " rainbow"}`}
                    style={isCustomColor(color) ? { ["--c" as string]: color } : undefined}
                  />
                </label>
              </div>
            </fieldset>
            <label className="field">
              <span>Group</span>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={role === "sleep"} onChange={(e) => setRole(e.target.checked ? "sleep" : "normal")} />
              <span>Counts as sleep in Insights</span>
            </label>
          </>
        )}

        {dialog.kind === "activity" && (
          <label className="field">
            <span>Counts as</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)}>
              <option value="class">Class time</option>
              <option value="self_study">Self-study</option>
              <option value="other">Not productive</option>
            </select>
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="dialog-foot">
          {item && (
            <button
              type="button"
              className="btn quiet"
              disabled={lastSpace}
              title={lastSpace ? "At least one space is needed" : undefined}
              onClick={() => {
                archive(dialog.kind, item.id, item.name);
                close();
              }}
            >
              Archive
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </dialog>
  );
}

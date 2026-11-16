import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { colorVar, isCustomColor } from "../../lib/colors";
import { useArchiveWithUndo, useGroups, useSpaces } from "../../lib/queries";
import { useUi, type Dialog } from "../../lib/store";
import type { ActivityCategory, SpaceKind, SpaceRole } from "../../lib/types";
import { Icon, SPACE_ICONS } from "../../components/Icon";

const TITLES = { space: "space", group: "group", activity: "activity", task_type: "task type" } as const;

type Kind = Exclude<SpaceKind, "inbox">;
const KINDS: [Kind, string, string][] = [
  ["project", "Project", "A course: parts, types, progress"],
  ["list", "List", "To-dos with steps, to tick off"],
  ["none", "Time only", "No to-dos: sleep, travel, shifts"],
];

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
  const palette = useUi((s) => s.prefs.spaceColors);
  const [name, setName] = useState(item?.name ?? "");
  const [color, setColor] = useState(dialog.kind === "space" ? (dialog.item?.color ?? "green") : "gray");
  const [groupId, setGroupId] = useState<string>(
    dialog.kind === "space" ? (dialog.item?.groupId ?? dialog.groupId ?? "") : "",
  );
  const [icon, setIcon] = useState<string | null>(dialog.kind === "space" ? (dialog.item?.icon ?? null) : null);
  const [role, setRole] = useState<SpaceRole>(dialog.kind === "space" ? (dialog.item?.role ?? "normal") : "normal");
  const [kind, setKind] = useState<Kind>(
    dialog.kind === "space" ? ((dialog.item?.kind as Kind | undefined) ?? dialog.spaceKind ?? (dialog.groupId ? "project" : "list")) : "list",
  );
  const [forSpace, setForSpace] = useState<string>(dialog.kind === "task_type" ? (dialog.item?.spaceId ?? dialog.spaceId ?? "") : "");
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
        const input = { name, color, role, groupId: groupId || null, icon, kind: dialog.item?.kind === "inbox" ? undefined : kind };
        await (item ? api.updateSpace(item.id, input) : api.createSpace(input));
        qc.invalidateQueries({ queryKey: ["spaces"] });
      } else if (dialog.kind === "group") {
        await (item ? api.updateGroup(item.id, { name }) : api.createGroup({ name }));
        qc.invalidateQueries({ queryKey: ["groups"] });
      } else if (dialog.kind === "task_type") {
        await (item ? api.updateTaskType(item.id, name, forSpace || null) : api.createTaskType(name, forSpace || null));
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
    <dialog ref={ref} className={`dialog${dialog.kind === "space" ? " wide" : ""}`} onClose={close}>
      <form onSubmit={submit}>
        <h2>{item ? `Edit ${TITLES[dialog.kind]}` : `New ${TITLES[dialog.kind]}`}</h2>

        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {dialog.kind === "space" && dialog.item?.kind !== "inbox" && (
          <fieldset className="field">
            <legend>What is this space for?</legend>
            <div className="kind-picker" role="radiogroup" aria-label="What is this space for?">
              {KINDS.map(([k, label, hint]) => (
                <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                  <span className="kind-name">{label}</span>
                  <span className="muted small">{hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {dialog.kind === "task_type" && (
          <label className="field">
            <span>For</span>
            <select value={forSpace} onChange={(e) => setForSpace(e.target.value)}>
              <option value="">All courses</option>
              {activeSpaces.filter((s) => s.kind === "project" || s.id === forSpace).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        {dialog.kind === "space" && (
          <>
            <fieldset className="field">
              <legend>Colour</legend>
              <div className="swatches">
                {/* Her palette (Settings › Appearance), and the space's own colour if it left it. */}
                {(palette.includes(color) || isCustomColor(color) ? palette : [color, ...palette]).map((c) => (
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
            <fieldset className="field">
              <legend>Icon</legend>
              <div className="icon-picker" role="radiogroup" aria-label="Icon" style={{ ["--c" as string]: colorVar(color) }}>
                <button type="button" role="radio" aria-checked={!icon} aria-label="No icon" title="No icon" className={!icon ? "on" : ""} onClick={() => setIcon(null)}>
                  <span className="swatch big-sq" />
                </button>
                {SPACE_ICONS.map((i) => (
                  <button type="button" key={i} role="radio" aria-checked={icon === i} aria-label={i} title={i} className={icon === i ? "on" : ""} onClick={() => setIcon(i)}>
                    <Icon name={i} size={16} />
                  </button>
                ))}
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

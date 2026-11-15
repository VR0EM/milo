import { useState } from "react";
import { pickDefaultSpace } from "../../lib/spaces";
import { api } from "../../lib/api";
import { useAction, useInbox, useSpaces } from "../../lib/queries";
import { preferredSpace, useUi } from "../../lib/store";
import { daysFromToday, fmtTime } from "../../lib/time";
import type { InboxItem, Task } from "../../lib/types";
import { HelpTip } from "../../components/HelpTip";
import { CAPTURE_KEY } from "../shortcuts/keys";

const when = (iso: string) => {
  const d = new Date(iso);
  const n = daysFromToday(d);
  return n === 0 ? fmtTime(d) : n === -1 ? "yesterday" : `${-n} days ago`;
};

/** Quick notes waiting to be sorted: make one a task, or mark it done. */
export function InboxBlock() {
  const items = useInbox().data ?? [];
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const lastSpaceId = useUi(preferredSpace);
  const act = useAction("inbox", "tasks");
  const [text, setText] = useState("");

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    act.mutate(() => api.addInbox(t));
  };
  const done = (item: InboxItem) =>
    act.mutate(() => api.setInboxDone(item.id, true), {
      onSuccess: () =>
        useUi.getState().notify({ text: "Note done", undo: () => act.mutate(() => api.setInboxDone(item.id, false)) }),
    });
  const toTask = (item: InboxItem) => {
    const spaceId = pickDefaultSpace(spaces, lastSpaceId)?.id;
    if (!spaceId) return;
    act.mutate(
      () => api.inboxToTask(item.id, spaceId),
      {
        onSuccess: (task) => {
          const ui = useUi.getState();
          ui.setView("tasks");
          ui.selectTask((task as Task).id);
        },
      },
    );
  };

  return (
    <section className="block inbox">
      <div className="block-head">
        <h2>
          Inbox
          <HelpTip label="About the inbox">
            Press {CAPTURE_KEY} anywhere, also when Milo is hidden, to write something down without choosing a space or a
            date. It lands here. Later, make it a task or mark it done.
          </HelpTip>
        </h2>
        {items.length > 0 && <span className="muted small">{items.length}</span>}
      </div>
      {items.length > 0 && (
        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id} className="inbox-row">
              <span className="inbox-text">{item.text}</span>
              <span className="muted small tabular">{when(item.createdAt)}</span>
              <button className="btn small" onClick={() => toTask(item)}>Make task</button>
              <button className="link inbox-done" onClick={() => done(item)}>Done</button>
            </li>
          ))}
        </ul>
      )}
      <form className="inbox-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write something down" aria-label="New note" />
      </form>
    </section>
  );
}

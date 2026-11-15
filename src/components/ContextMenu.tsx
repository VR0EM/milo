import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

export type MenuItem =
  | { label: string; run: () => void; danger?: boolean; disabled?: boolean }
  | "separator";

interface MenuState {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  close: () => void;
}

const useMenu = create<MenuState>((set) => ({
  at: null,
  items: [],
  close: () => set({ at: null, items: [] }),
}));

/**
 * Right-click menu: call from an onContextMenu handler. Shows Milo's own small menu at the
 * pointer instead of the browser's one.
 */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.setState({ at: { x: e.clientX, y: e.clientY }, items });
}

/** Mounted once in App. */
export function ContextMenuHost() {
  const at = useMenu((s) => s.at);
  const items = useMenu((s) => s.items);
  const close = useMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Keep the menu inside the window: open up or to the left when there is no room.
  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, at.x + r.width > window.innerWidth - 4 ? at.x - r.width : at.x),
      top: Math.max(4, at.y + r.height > window.innerHeight - 4 ? at.y - r.height : at.y),
    });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [at, close]);

  if (!at) return null;
  return (
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Room kept free between the explanation and the window's edge. */
const EDGE = 8;

/**
 * A small "?" that shows a short explanation on click. Keeps screens free of paragraphs
 * while the explanation stays one click away. Closes on Esc, a click elsewhere or a scroll.
 *
 * The explanation floats above the page and always stays inside the window. Placed inside its
 * panel it would stick out at a right edge and make the whole panel scroll sideways.
 */
export function HelpTip({ children, label = "What is this?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  // Under the "?", moved left where the window ends, and above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const b = btnRef.current?.getBoundingClientRect();
    const p = popRef.current;
    if (!b || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const left = Math.max(EDGE, Math.min(b.left - 8, window.innerWidth - w - EDGE));
    const below = b.bottom + 6;
    const top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, b.top - 6 - h) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => btnRef.current?.contains(t as Node) || popRef.current?.contains(t as Node);
    const away = (e: MouseEvent) => !inside(e.target) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only this explanation closes, not the dialog or panel around it.
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    // A scroll would leave it floating away from its "?".
    const scroll = (e: Event) => !inside(e.target) && setOpen(false);
    const resize = () => setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  return (
    <span className="help">
      <button
        ref={btnRef}
        type="button"
        className={`help-btn${open ? " on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          // Inside a <label> a click would also go to its field.
          e.preventDefault();
          setOpen(!open);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            ref={popRef}
            className="help-pop"
            id={id}
            role="note"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
          >
            {children}
          </span>,
          // Into the open dialog when there is one (a dialog sits above the page), else onto the page.
          btnRef.current?.closest("dialog") ?? document.body,
        )}
    </span>
  );
}

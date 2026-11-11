import { useEffect, useId, useRef, useState } from "react";

/**
 * A small "?" that shows a short explanation on click. Keeps screens free of paragraphs
 * while the explanation stays one click away. Closes on Esc or a click elsewhere.
 */
export function HelpTip({ children, label = "What is this?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

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

  return (
    <span className="help" ref={ref}>
      <button
        type="button"
        className={`help-btn${open ? " on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      {open && (
        <span className="help-pop" id={id} role="note">
          {children}
        </span>
      )}
    </span>
  );
}

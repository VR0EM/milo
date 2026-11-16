import { useEffect, useRef, useState } from "react";
import { parseNote } from "../../lib/quickNote";
import { api, onCaptureOpen } from "../../lib/api";
import { useAppearance } from "../../lib/useAppearance";

/**
 * The small window behind the global shortcut: type, press Enter, and it is in the Inbox on
 * Today. Nothing to choose here; sorting happens later. Esc or clicking elsewhere hides it and
 * keeps what was typed.
 */
export function CaptureWindow() {
  useAppearance();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("capture-window");
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    focus();
    onCaptureOpen(focus);
    const onBlur = () => api.hideCapture().catch(() => {});
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await api.addInbox(parseNote(t));
      setText("");
      setError(null);
      await api.hideCapture();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <form className="capture" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input
        ref={input}
        aria-label="Write something down"
        placeholder="Write it down. Enter saves it to the Inbox, Esc closes."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") api.hideCapture().catch(() => {});
        }}
      />
      {error && <span className="capture-error">{error}</span>}
    </form>
  );
}

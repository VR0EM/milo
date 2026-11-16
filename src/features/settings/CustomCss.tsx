// Settings › Appearance › Custom CSS: her own styles on top of Milo's, for anything the
// choices above do not cover. Applied while typing pauses; a switch turns it off at once,
// and ⌘K "Turn off custom CSS" works even when the CSS hid this screen.

import { useEffect, useState } from "react";
import { useUi } from "../../lib/store";
import { HelpTip } from "../../components/HelpTip";

const EXAMPLE = `/* For example: */
.sidebar { background: #f4efe6; }
.block { border-width: 2px; }
:root { --accent-l: #c0587e; }`;

export function CustomCss() {
  const saved = useUi((s) => s.prefs.customCss);
  const on = useUi((s) => s.prefs.customCssOn);
  const setPrefs = useUi((s) => s.setPrefs);
  const [text, setText] = useState(saved);

  // A change from elsewhere (another window, a reset) shows here too, instead of being typed over.
  useEffect(() => setText(saved), [saved]);
  // Saved (and so applied) when typing pauses.
  useEffect(() => {
    if (text === saved) return;
    const t = setTimeout(() => setPrefs({ customCss: text }), 400);
    return () => clearTimeout(t);
  }, [text, saved, setPrefs]);

  return (
    <div className="custom-css">
      <div className="setting">
        <div className="setting-text">
          <span className="setting-title">Use my CSS</span>
          <HelpTip label="About custom CSS">
            CSS you write here is added after Milo's own, so it wins. Colours are variables such as --bg, --surface,
            --text, --muted, --line and --accent-l (light) / --accent-d (dark). If something goes wrong, switch it off
            here, or press Ctrl K (⌘K on a Mac) and choose "Turn off custom CSS".
          </HelpTip>
        </div>
        <div className="setting-control">
          <label className="switch-control">
            <input type="checkbox" role="switch" checked={on} onChange={(e) => setPrefs({ customCssOn: e.target.checked })} />
            <span>{on ? "On" : "Off"}</span>
          </label>
        </div>
      </div>
      <textarea
        className="custom-css-text"
        aria-label="Custom CSS"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={8}
        placeholder={EXAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved && setPrefs({ customCss: text })}
      />
    </div>
  );
}

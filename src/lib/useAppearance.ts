import { useEffect } from "react";
import { TEXT_SCALE, useUi } from "./store";

/** Applies theme, accent, typeface and text size from Settings to the page. */
export function useAppearance() {
  const theme = useUi((s) => s.prefs.theme);
  const accent = useUi((s) => s.prefs.accent);
  const customAccent = useUi((s) => s.prefs.customAccent);
  const font = useUi((s) => s.prefs.font);
  const textSize = useUi((s) => s.prefs.textSize);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    root.dataset.accent = accent;
    if (accent === "custom") {
      // One colour from the user; the dark-mode tone is the same colour, lightened.
      root.style.setProperty("--accent-l", customAccent);
      root.style.setProperty("--accent-d", `color-mix(in oklab, ${customAccent} 72%, white)`);
    } else {
      root.style.removeProperty("--accent-l");
      root.style.removeProperty("--accent-d");
    }
    root.dataset.font = font;
    root.style.setProperty("--text-scale", String(TEXT_SCALE[textSize]));
  }, [theme, accent, customAccent, font, textSize]);
}

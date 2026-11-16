import { useEffect, useState } from "react";
import { TEXT_SCALE, useUi } from "./store";

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** Light or dark as shown now: the chosen one, or the computer's while it is "Match the computer". */
function useMode(theme: string): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(darkQuery?.matches ?? false);
  useEffect(() => {
    if (!darkQuery) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    darkQuery.addEventListener("change", on);
    return () => darkQuery.removeEventListener("change", on);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : (theme as "light" | "dark");
}

/** Applies theme, colours, shape, typeface, text size and her own CSS from Settings to the page. */
export function useAppearance() {
  const prefs = useUi((s) => s.prefs);
  const { theme, accent, customAccent, font, textSize, palette, corners, density, highContrast, sidebarWidth, customCss, customCssOn } = prefs;
  const strength = prefs.eventStrength;
  const clock = prefs.timeFormat;
  const mode = useMode(theme);
  useEffect(() => {
    document.documentElement.dataset.events = strength;
    document.documentElement.dataset.clock = clock;
  }, [strength, clock]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    root.dataset.mode = mode;
    root.dataset.palette = palette;
    root.dataset.corners = corners;
    root.dataset.density = density;
    root.dataset.sidebar = sidebarWidth;
    if (highContrast) root.dataset.contrast = "high";
    else root.removeAttribute("data-contrast");
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
  }, [theme, mode, palette, corners, density, sidebarWidth, highContrast, accent, customAccent, font, textSize]);
  // Her own CSS comes last, so it wins over Milo's.
  useEffect(() => {
    let el = document.getElementById("milo-custom-css") as HTMLStyleElement | null;
    if (!customCssOn || !customCss.trim()) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = "milo-custom-css";
      document.head.appendChild(el);
    }
    el.textContent = customCss;
  }, [customCss, customCssOn]);
}

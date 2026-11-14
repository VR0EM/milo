/** Cmd on macOS, Ctrl elsewhere. */
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";
export const MOD_ARIA = IS_MAC ? "Meta" : "Control";
/** The key that opens the quick note window from anywhere (set in src-tauri/src/lib.rs). */
export const CAPTURE_KEY = IS_MAC ? "⌘⇧Space" : "Ctrl+Shift+Space";

/** True when the key press belongs to a text field or dialog, not to the app. */
export function isTyping(e: KeyboardEvent) {
  return e.target instanceof Element && !!e.target.closest("input, textarea, select, dialog, [contenteditable]");
}

/**
 * True for key presses a single-key shortcut must ignore: typing in a field, modifier
 * combinations, and the automatic repeats of a key that is held down (one press = one action).
 */
export function ignoreForShortcut(e: KeyboardEvent) {
  return e.repeat || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey;
}

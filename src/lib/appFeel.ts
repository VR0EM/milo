// Milo is a web page inside a desktop window. This takes away what gives that away: the
// browser's own right-click menu (Reload, Inspect), reloading, printing and saving the page,
// going "back" with the mouse's side buttons, dragging a ghost picture of something, and the
// middle-click scroll circle. Text fields keep their usual menu (cut, copy, paste).
//
// While developing, Alt+right-click still opens the browser menu and Cmd/Ctrl+R still reloads.

const DEV = import.meta.env.DEV;
const MAC = navigator.platform.toUpperCase().includes("MAC");

/** A field where text is typed or selected: there the usual menu and dragging stay. */
function editable(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest("input, textarea, [contenteditable=''], [contenteditable='true'], .path");
}

/** Browser keys with no meaning in Milo: reload, print, save, view source, find next, caret mode. */
function browserKey(e: KeyboardEvent): boolean {
  const mod = MAC ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === "F5" || (mod && k === "r")) return !DEV;
  if (e.key === "F3" || e.key === "F7") return true;
  if (mod && ["p", "s", "u", "o", "g", "j", "h"].includes(k)) return true;
  // Alt+Left/Right is "back"/"forward" in a browser.
  if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !editable(e.target)) return true;
  return false;
}

/** Shows a scroll area's bar only while it scrolls, as on a phone or a Mac with a trackpad. */
function scrollbarsWhileScrolling() {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      if (!el) return;
      el.classList.add("is-scrolling");
      window.clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => el.classList.remove("is-scrolling"), 900));
    },
    true,
  );
}

export function feelLikeAnApp() {
  window.addEventListener("contextmenu", (e) => {
    // Milo's own menus (spaces, parts) have already stopped this event.
    if (editable(e.target) || (DEV && e.altKey)) return;
    e.preventDefault();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (browserKey(e)) e.preventDefault();
    },
    true,
  );
  // The side buttons of a mouse: "back" and "forward" in a browser.
  for (const type of ["mouseup", "mousedown", "auxclick"] as const) {
    window.addEventListener(type, (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
      // Middle click: the scroll circle on Windows.
      if (type === "mousedown" && e.button === 1 && !editable(e.target)) e.preventDefault();
    });
  }
  // A ghost image of a button or icon when the mouse slips while pressed.
  window.addEventListener("dragstart", (e) => {
    if (!editable(e.target)) e.preventDefault();
  });
  scrollbarsWhileScrolling();
}

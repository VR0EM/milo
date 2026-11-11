// Spaces store a palette key, not a hex value. The stylesheet maps each key to a
// muted tone for light and dark mode, so colours stay calm and consistent.
export const PALETTE = [
  "gray", "brown", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "red",
] as const;

/** A custom colour is stored as "#rrggbb"; anything else is a palette key. */
export const isCustomColor = (key: string) => /^#[0-9a-f]{6}$/i.test(key);

export const colorVar = (key: string) =>
  isCustomColor(key) ? key : `var(--c-${(PALETTE as readonly string[]).includes(key) ? key : "gray"})`;

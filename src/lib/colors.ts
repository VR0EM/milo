// Spaces store a palette key, not a hex value. The stylesheet maps each key to a
// muted tone for light and dark mode, so colours stay calm and consistent.
export const PALETTE = [
  "gray", "brown", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "red",
] as const;

export const colorVar = (key: string) =>
  `var(--c-${(PALETTE as readonly string[]).includes(key) ? key : "gray"})`;

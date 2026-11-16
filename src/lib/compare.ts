/** "+1 h 20", "−35 min" or "same": the change since the period before, short and without colour. */
export function delta(now: number, then: number | undefined, fmt: (n: number) => string): string {
  if (then === undefined) return "";
  const d = now - then;
  if (Math.abs(d) < 1) return "same";
  return `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;
}

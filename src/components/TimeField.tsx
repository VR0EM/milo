import { useEffect, useState } from "react";
import { fmtHm, parseTime } from "../lib/time";

/**
 * A plain time field that shows the clock chosen in Settings (24-hour or am/pm) and reads
 * either. The native time input follows the system locale, which could disagree with Milo.
 * `value` and what `onCommit` gets are always 24-hour "HH:MM".
 */
export function TimeField({ value, onCommit }: { value: string; onCommit: (hhmm: string) => void }) {
  const [text, setText] = useState(fmtHm(value));
  useEffect(() => setText(fmtHm(value)), [value]);
  const commit = () => {
    const parsed = parseTime(text);
    if (parsed && parsed !== value) onCommit(parsed);
    else setText(fmtHm(value));
  };
  return (
    <input
      inputMode="numeric"
      placeholder="hh:mm"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

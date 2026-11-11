import { useEffect, useState } from "react";
import { parseTime } from "../lib/time";

/**
 * A plain 24-hour time field. The native time input follows the system locale
 * (AM/PM on some machines), which would disagree with the calendar grid.
 */
export function TimeField({ value, onCommit }: { value: string; onCommit: (hhmm: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const parsed = parseTime(text);
    if (parsed && parsed !== value) onCommit(parsed);
    else setText(value);
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

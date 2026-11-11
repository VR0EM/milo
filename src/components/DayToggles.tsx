const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Seven toggles for a weekday string where '1' is Monday and '7' is Sunday. */
export function DayToggles({ value, onChange }: { value: string; onChange: (weekdays: string) => void }) {
  const toggle = (n: string) => {
    const set = new Set(value);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    onChange([...set].sort().join(""));
  };
  return (
    <div className="day-toggles">
      {DAYS.map((label, i) => {
        const n = String(i + 1);
        return (
          <label key={n}>
            <input type="checkbox" checked={value.includes(n)} onChange={() => toggle(n)} />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

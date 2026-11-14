/**
 * A date field that says "No date" while it is empty. The browser's own empty date field shows
 * today's date in grey, which reads as if a date were already set.
 */
export function DateInput({ placeholder = "No date", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const empty = !props.value;
  return (
    <span className={`date-input${empty ? " empty" : ""}`}>
      <input type="date" {...props} />
      {empty && <span className="date-placeholder" aria-hidden>{placeholder}</span>}
    </span>
  );
}

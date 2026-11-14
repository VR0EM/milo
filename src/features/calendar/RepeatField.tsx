import { useState } from "react";
import { api } from "../../lib/api";
import { DayToggles } from "../../components/DayToggles";
import { HelpTip } from "../../components/HelpTip";
import { useAction, useSeries } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { toDateInput } from "../../lib/time";
import type { CalEvent, RepeatFreq, RepeatRule } from "../../lib/types";

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const UNIT: Record<RepeatFreq, [string, string]> = { daily: ["day", "days"], weekly: ["week", "weeks"], monthly: ["month", "months"] };

/** The event's weekday as '1' (Monday) to '7' (Sunday). */
const isoDay = (d: Date) => String(((d.getDay() + 6) % 7) + 1);

type Preset = "none" | "daily" | "weekly" | "weekdays" | "biweekly" | "monthly" | "custom";

function presetOf(rule: RepeatRule | null, own: string): Preset {
  if (!rule) return "none";
  const days = rule.weekdays || own;
  if (rule.freq === "daily" && rule.interval === 1) return "daily";
  if (rule.freq === "monthly" && rule.interval === 1) return "monthly";
  if (rule.freq === "weekly" && days === own && rule.interval === 1) return "weekly";
  if (rule.freq === "weekly" && days === own && rule.interval === 2) return "biweekly";
  if (rule.freq === "weekly" && days === "12345" && rule.interval === 1) return "weekdays";
  return "custom";
}

/** Plain words for a rule: "Every 2 weeks on Mon, Thu until 20 Dec". */
export function describeRule(rule: RepeatRule, start: Date) {
  const [one, many] = UNIT[rule.freq];
  let text = rule.interval === 1 ? `Every ${one}` : `Every ${rule.interval} ${many}`;
  if (rule.freq === "weekly") {
    const days = (rule.weekdays || isoDay(start)).split("").map((n) => WEEKDAY[Number(n) - 1].slice(0, 3));
    text += ` on ${days.join(", ")}`;
  }
  if (rule.freq === "monthly") text += ` on day ${start.getDate()}`;
  if (rule.untilDate) {
    text += ` until ${new Date(`${rule.untilDate}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return text;
}

/**
 * Repeat for an event made in Milo. A change applies to this event and the ones after it;
 * events that already happened stay as they were.
 */
export function RepeatField({ event }: { event: CalEvent }) {
  const series = (useSeries().data ?? []).find((s) => s.id === event.seriesId) ?? null;
  const act = useAction("events", "series");
  const start = new Date(event.startAt);
  const own = isoDay(start);
  const rule = series?.rule ?? null;
  const preset = presetOf(rule, own);
  const [custom, setCustom] = useState(preset === "custom");

  const apply = (next: RepeatRule | null) =>
    act.mutate(() => api.setRepeat(event.id, next), {
      onSuccess: () =>
        useUi.getState().notify({ text: next ? `${describeRule(next, start)}, from this event on` : "Stopped repeating after this event" }),
    });

  const choose = (p: Preset) => {
    const until = rule?.untilDate ?? null;
    setCustom(p === "custom");
    if (p === "none") return rule && apply(null);
    if (p === "custom") return;
    const next: RepeatRule =
      p === "daily" ? { freq: "daily", interval: 1, weekdays: "", untilDate: until }
      : p === "weekly" ? { freq: "weekly", interval: 1, weekdays: "", untilDate: until }
      : p === "biweekly" ? { freq: "weekly", interval: 2, weekdays: "", untilDate: until }
      : p === "weekdays" ? { freq: "weekly", interval: 1, weekdays: "12345", untilDate: until }
      : { freq: "monthly", interval: 1, weekdays: "", untilDate: until };
    apply(next);
  };

  const base: RepeatRule = rule ?? { freq: "weekly", interval: 1, weekdays: own, untilDate: null };
  const [every, setEvery] = useState(String(base.interval));

  return (
    <div className="repeat-field">
      <label className="field">
        <span>
          Repeat
          <HelpTip label="About repeating">
            A change here applies to this event and the ones after it. Events that already happened stay as they were.
            Changing one occurrence's title or time changes only that one; use "Copy to later events" to pass it on.
          </HelpTip>
        </span>
        <select value={custom ? "custom" : preset} onChange={(e) => choose(e.target.value as Preset)}>
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week on {WEEKDAY[Number(own) - 1]}</option>
          <option value="biweekly">Every 2 weeks on {WEEKDAY[Number(own) - 1]}</option>
          <option value="weekdays">Every weekday (Mon to Fri)</option>
          <option value="monthly">Every month on day {start.getDate()}</option>
          <option value="custom">Custom…</option>
        </select>
      </label>

      {custom && (
        <div className="repeat-custom">
          <div className="inline">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={99}
              aria-label="Every how many"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              onBlur={() => {
                const n = Math.min(99, Math.max(1, Number(every) || 1));
                setEvery(String(n));
                if (n !== base.interval || !rule) apply({ ...base, interval: n });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <select aria-label="Unit" value={base.freq} onChange={(e) => apply({ ...base, freq: e.target.value as RepeatFreq })}>
              {(["daily", "weekly", "monthly"] as const).map((f) => (
                <option key={f} value={f}>{base.interval === 1 ? UNIT[f][0] : UNIT[f][1]}</option>
              ))}
            </select>
          </div>
          {base.freq === "weekly" && (
            <DayToggles
              value={base.weekdays || own}
              onChange={(weekdays) => weekdays && apply({ ...base, weekdays })}
            />
          )}
        </div>
      )}

      {rule && (
        <>
          <label className="field">
            <span>Ends</span>
            <div className="inline">
              <select
                aria-label="Ends"
                value={rule.untilDate ? "on" : "never"}
                onChange={(e) => {
                  if (e.target.value === "never") apply({ ...rule, untilDate: null });
                  else {
                    const d = new Date(start);
                    d.setMonth(d.getMonth() + 3);
                    apply({ ...rule, untilDate: toDateInput(d) });
                  }
                }}
              >
                <option value="never">Never</option>
                <option value="on">On a date</option>
              </select>
              {rule.untilDate && (
                <input
                  type="date"
                  aria-label="Last day"
                  value={rule.untilDate}
                  min={toDateInput(start)}
                  onChange={(e) => e.target.value && apply({ ...rule, untilDate: e.target.value })}
                />
              )}
            </div>
          </label>
          {(custom || rule.untilDate) && <p className="muted small">{describeRule(rule, start)}.</p>}
          <button type="button" className="link repeat-copy" onClick={() => apply(rule)}>
            Copy this event's title, time and notes to later events
          </button>
        </>
      )}
    </div>
  );
}

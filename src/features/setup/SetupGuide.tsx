import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pickDefaultSpace } from "../../lib/spaces";
import { api } from "../../lib/api";
import { PALETTE, colorVar } from "../../lib/colors";
import { useGroups, useImportSources, useReminderRules, useRoutines, useSpaces, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { parseTime } from "../../lib/time";
import type { ImportSource, ReminderRule } from "../../lib/types";
import { HelpTip } from "../../components/HelpTip";
import { Icon, SpaceMark, type IconName } from "../../components/Icon";
import { TimeField } from "../../components/TimeField";
import { ACCENTS } from "../settings/SettingsView";
import { BrandMark } from "../spaces/Sidebar";
import { CAPTURE_KEY } from "../shortcuts/keys";

type Step = "welcome" | "look" | "courses" | "timetable" | "deadlines" | "rhythm" | "ready";
const STEPS: Step[] = ["welcome", "look", "courses", "timetable", "deadlines", "rhythm", "ready"];
/** The steps that ask something; the progress bar counts only these. */
const ASKING = STEPS.slice(1, -1);

const addMinutes = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * Opens by itself the first time Milo starts with nothing in it. Every step can be skipped
 * and everything it sets can be changed later in Settings. Opened again from Settings or Today.
 */
export function SetupGate() {
  const open = useUi((s) => s.setupOpen);
  const done = useUi((s) => s.prefs.setupDone);
  const spaces = useSpaces().data;
  const tasks = useTasks().data;
  const sources = useImportSources().data;

  useEffect(() => {
    if (done || !spaces || !tasks || !sources) return;
    const fresh = tasks.length === 0 && sources.length === 0 && spaces.every((s) => s.id.startsWith("seed-"));
    // A Milo already in use never sees the guide by surprise.
    if (fresh) useUi.setState({ setupOpen: true });
    else useUi.getState().setPrefs({ setupDone: true });
  }, [done, spaces, tasks, sources]);

  return open ? <SetupGuide /> : null;
}

function SetupGuide() {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const asking = ASKING.indexOf(step);
  const finish = () => {
    useUi.getState().setPrefs({ setupDone: true });
    useUi.setState({ setupOpen: false });
  };
  useEffect(() => {
    ref.current?.showModal();
    // showModal focuses the first control ("Skip setup"); the main button is the one to press.
    ref.current?.querySelector<HTMLButtonElement>(".setup-foot .btn.primary")?.focus();
  }, []);
  const next = () => setI((n) => Math.min(STEPS.length - 1, n + 1));

  return (
    <dialog ref={ref} className="setup" aria-label="Set up Milo" onCancel={(e) => { e.preventDefault(); finish(); }}>
      <div className="setup-top">
        {asking >= 0 && (
          <div className="setup-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={ASKING.length} aria-valuenow={asking + 1}>
            {ASKING.map((s, n) => <span key={s} className={n <= asking ? "on" : ""} />)}
          </div>
        )}
        <span className="spacer" />
        {step !== "ready" && <button className="link setup-skip" onClick={finish}>Skip setup</button>}
      </div>

      <div className="setup-step" key={step}>
        {step === "welcome" && <Welcome />}
        {step === "look" && <Look />}
        {step === "courses" && <Courses onDone={next} />}
        {step === "timetable" && <CalendarLink kind="events" />}
        {step === "deadlines" && <CalendarLink kind="tasks" />}
        {step === "rhythm" && <Rhythm />}
        {step === "ready" && <Ready />}
      </div>

      {/* Each step gets its own buttons (keyed by step). With one shared button, WebKit turned
          the Continue of "Make it yours" into the courses form's submit button during the same
          click, which submitted the empty form and skipped the courses step. */}
      <div className="setup-foot" key={`foot-${step}`}>
        {i > 0 && step !== "ready" && <button type="button" className="btn setup-back" onClick={() => setI(i - 1)}>Back</button>}
        <span className="spacer" />
        {step === "courses" ? (
          <button type="submit" className="btn primary" form="setup-courses">Continue</button>
        ) : step === "ready" ? (
          <button type="button" className="btn primary" autoFocus onClick={() => { finish(); useUi.getState().setView("today"); }}>Open Today</button>
        ) : (
          <button type="button" className="btn primary" autoFocus onClick={next}>{step === "welcome" ? "Get started" : "Continue"}</button>
        )}
      </div>
    </dialog>
  );
}

function Head({ title, line, help }: { title: string; line: string; help?: React.ReactNode }) {
  return (
    <header className="setup-head">
      <h2>
        {title}
        {help && <HelpTip label={`About ${title.toLowerCase()}`}>{help}</HelpTip>}
      </h2>
      <p>{line}</p>
    </header>
  );
}

/** A labelled row: the name on the left, the control on the right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setup-field">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Point({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <li className="setup-point">
      <span className="setup-point-icon"><Icon name={icon} size={16} /></span>
      <div>
        <div className="setup-point-title">{title}</div>
        <div className="setup-point-text">{children}</div>
      </div>
    </li>
  );
}

function Welcome() {
  return (
    <>
      <div className="setup-brand"><BrandMark size={36} /></div>
      <Head title="Welcome to Milo" line="Your week in one calm place. A few short steps set it up; each can be skipped." />
      <ul className="setup-points">
        <Point icon="calendar" title="Calendar">Timetable, deadlines and your own plans together.</Point>
        <Point icon="focus" title="Focus">A timer that leaves its time in the calendar.</Point>
        <Point icon="lock" title="On this computer">No account and nothing in the cloud.</Point>
      </ul>
    </>
  );
}

function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: [T, string][]; label: string; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function Look() {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  return (
    <>
      <Head title="Make it yours" line="Changes show right away, and stay changeable in Settings." />
      <div className="setup-fields">
        <Field label="Theme">
          <Segmented value={prefs.theme} label="Theme" options={[["system", "Auto"], ["light", "Light"], ["dark", "Dark"]]} onChange={(theme) => setPrefs({ theme })} />
        </Field>
        <Field label="Accent">
          <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map(([a, label]) => (
              <button key={a} role="radio" aria-checked={prefs.accent === a} aria-label={label} title={label} data-accent-swatch={a} className={prefs.accent === a ? "on" : ""} onClick={() => setPrefs({ accent: a })} />
            ))}
          </div>
        </Field>
        <Field label="Text size">
          <Segmented value={prefs.textSize} label="Text size" options={[["small", "Small"], ["default", "Default"], ["large", "Large"]]} onChange={(textSize) => setPrefs({ textSize })} />
        </Field>
        <Field label="Event colours">
          <Segmented value={prefs.eventStrength} label="Event colours" options={[["soft", "Soft"], ["normal", "Normal"], ["strong", "Strong"]]} onChange={(eventStrength) => setPrefs({ eventStrength })} />
        </Field>
      </div>
    </>
  );
}

/** One course per line; each becomes a space in the School group, with its own colour. */
function Courses({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const groups = (useGroups().data ?? []).filter((g) => !g.deletedAt);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const school = groups.find((g) => g.name.toLowerCase() === "school");
  const existing = spaces.filter((s) => school && s.groupId === school.id);

  // Each name once, whatever its capitals, and none that exists already; colours in palette
  // order, skipping grey and the ones in use. Shown as they will be made, while typing.
  const known = new Set(spaces.map((s) => s.name.trim().toLowerCase()));
  const names: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (known.has(line.toLowerCase())) continue;
    known.add(line.toLowerCase());
    names.push(line);
  }
  const used = new Set(spaces.map((s) => s.color));
  const free = PALETTE.filter((c) => c !== "gray" && !used.has(c));
  const colours = free.length ? free : PALETTE.filter((c) => c !== "gray");
  const planned = names.map((name, n) => ({ name, color: colours[n % colours.length] }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planned.length) return onDone();
    setBusy(true);
    try {
      const groupId = school?.id ?? (await api.createGroup({ name: "School" })).id;
      for (const c of planned) await api.createSpace({ name: c.name, groupId, color: c.color, role: "normal", icon: "book" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["spaces"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="setup-courses" onSubmit={save}>
      <Head
        title="Your courses"
        line="One course per line. Each gets its own space and colour."
      />
      <textarea
        className="setup-textarea"
        rows={5}
        placeholder={"Analysis 2\nPhysics\nChemistry"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        autoFocus
        aria-label="Courses, one per line"
      />
      {(existing.length > 0 || planned.length > 0) && (
        <ul className="setup-chips" aria-label="Courses">
          {existing.map((s) => (
            <li key={s.id} className="setup-chip" style={{ ["--c" as string]: colorVar(s.color) }}>
              <SpaceMark icon={s.icon} size={12} />
              {s.name}
            </li>
          ))}
          {planned.map((c) => (
            <li key={c.name} className="setup-chip new" style={{ ["--c" as string]: colorVar(c.color) }}>
              <SpaceMark icon="book" size={12} />
              {c.name}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** A calendar link: the timetable (as events) or the deadlines of the learning platform (as tasks). */
function CalendarLink({ kind }: { kind: "events" | "tasks" }) {
  const qc = useQueryClient();
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  // Every linked calendar, with how it comes in: a deadlines link imported as events would
  // otherwise be missing from the deadlines step.
  const sources = useImportSources().data ?? [];
  const [url, setUrl] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const space = spaceId || pickDefaultSpace(spaces)?.id || "";
  const timetable = kind === "events";

  const add = async () => {
    if (!url.trim()) return;
    setState({ busy: true });
    try {
      await api.addCalendarLink({ name: timetable ? "Timetable" : "Deadlines", location: url.trim(), spaceId: space, enabled: true, importAs: kind });
      setUrl("");
      setState({});
      qc.invalidateQueries();
    } catch (err) {
      setState({ error: String(err) });
    }
  };

  return (
    <>
      <Head
        title={timetable ? "Your timetable" : "Your deadlines"}
        line={timetable ? "Paste the calendar link of your school timetable." : "Paste the calendar link of your learning platform."}
        help={
          timetable
            ? "Timetable sites often have “Export”, “iCal”, “Subscribe” or “Calendar link”. Copy that address; it often ends in .ics. Milo then keeps the timetable up to date by itself."
            : "Canvas, Moodle, Toledo or Smartschool usually have it under Calendar › Export. Each hand-in becomes a task with its deadline, which you can tick off."
        }
      />
      <div className="setup-link">
        <input type="url" placeholder="https://…" aria-label="Calendar link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add} disabled={!url.trim() || state.busy}>{state.busy ? "Adding…" : "Add"}</button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {sources.length > 0 && (
        <ul className="setup-linked" aria-label="Linked calendars">
          {sources.map((s: ImportSource) => (
            <li key={s.id}>
              <Icon name="check" size={14} />
              <span>{s.name}</span>
              <span className="muted">{[hostOf(s.location), s.importAs === "tasks" ? "as tasks" : "as events"].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="setup-fields">
        <Field label={timetable ? "Unmatched items go to" : "Tasks go to"}>
          <select value={space} onChange={(e) => setSpaceId(e.target.value)} aria-label="Space">
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
    </>
  );
}

/** When the day starts and ends: the morning and evening routines, and where the calendar opens. */
function Rhythm() {
  const qc = useQueryClient();
  const routines = useRoutines().data ?? [];
  const rules = useReminderRules().data ?? [];
  const setPrefs = useUi((s) => s.setPrefs);
  const morning = routines.find((r) => r.id === "seed-routine-morning");
  const evening = routines.find((r) => r.id === "seed-routine-evening");
  const medication = rules.find((r) => r.id === "seed-reminder-medication");
  const water = rules.find((r) => r.id === "seed-reminder-water");

  const save = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      useUi.getState().notify({ text: String(err), error: true });
    } finally {
      qc.invalidateQueries();
    }
  };
  const setWake = (t: string) => {
    setPrefs({ dayStartHour: Math.min(12, Number(t.slice(0, 2))) });
    if (morning) save(() => api.updateRoutine(morning.id, { name: morning.name, startTime: t, endTime: addMinutes(t, 120), weekdays: morning.weekdays }));
  };
  const setBed = (t: string) => {
    if (evening) save(() => api.updateRoutine(evening.id, { name: evening.name, startTime: addMinutes(t, -90), endTime: t, weekdays: evening.weekdays }));
  };
  const rule = (r: ReminderRule | undefined, patch: Partial<ReminderRule>) => {
    if (!r) return;
    const { id, ...input } = { ...r, ...patch };
    save(() => api.updateReminderRule(id, input));
  };

  return (
    <>
      <Head
        title="Your rhythm"
        line="Sets your morning and evening routines on Today."
        help="The morning routine starts when you get up, the evening routine ends when you go to bed, and the calendar opens at your wake-up hour."
      />
      <div className="setup-fields">
        <Field label="Up at">
          <TimeField value={morning?.startTime ?? "07:00"} onCommit={setWake} />
        </Field>
        <Field label="In bed at">
          <TimeField value={evening?.endTime ?? "23:30"} onCommit={setBed} />
        </Field>
        {medication && (
          <Field label="Medication reminder">
            <div className="setup-inline">
              {medication.enabled && (
                <TimeField value={(medication.times ?? "08:00").split(",")[0]} onCommit={(t) => parseTime(t) && rule(medication, { times: t })} />
              )}
              <label className="switch-control">
                <input type="checkbox" role="switch" aria-label="Medication reminder" checked={medication.enabled} onChange={(e) => rule(medication, { enabled: e.target.checked })} />
              </label>
            </div>
          </Field>
        )}
        {water && (
          <Field label={`Water, every ${water.intervalMinutes ?? 90} min`}>
            <label className="switch-control">
              <input type="checkbox" role="switch" aria-label="Water reminder" checked={water.enabled} onChange={(e) => rule(water, { enabled: e.target.checked })} />
            </label>
          </Field>
        )}
      </div>
    </>
  );
}

function Ready() {
  return (
    <>
      <Head title="You're all set" line="Today shows what runs now, what comes next, and a suggestion for free time." />
      <ul className="setup-points">
        <Point icon="calendar" title="Plan time for a task">Drag it from the list beside the calendar onto the hours.</Point>
        <Point icon="pen" title="Write something down">
          Press <kbd>{CAPTURE_KEY}</kbd> anywhere, also when Milo is hidden.
        </Point>
        <Point icon="settings" title="Change anything later">
          Everything from this guide is in Settings. Press <kbd>?</kbd> for all shortcuts.
        </Point>
      </ul>
    </>
  );
}

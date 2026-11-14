import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { PALETTE, colorVar } from "../../lib/colors";
import { useGroups, useImportSources, useReminderRules, useRoutines, useSpaces, useTasks } from "../../lib/queries";
import { useUi, type Theme } from "../../lib/store";
import { fmtHm, parseTime } from "../../lib/time";
import { TimeField } from "../../components/TimeField";
import { ACCENTS } from "../settings/SettingsView";
import { CAPTURE_KEY } from "../shortcuts/keys";

const STEPS = ["Welcome", "Look", "Courses", "Timetable", "Deadlines", "Rhythm", "Ready"] as const;
const THEMES: [Theme, string][] = [["system", "Match the computer"], ["light", "Light"], ["dark", "Dark"]];

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
  const [step, setStep] = useState(0);
  const finish = () => {
    useUi.getState().setPrefs({ setupDone: true });
    useUi.setState({ setupOpen: false });
  };
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const name = STEPS[step];
  return (
    <dialog ref={ref} className="dialog setup" aria-label="Welcome to Milo" onCancel={(e) => { e.preventDefault(); finish(); }}>
      <div className="setup-top">
        <span className="muted small">{step > 0 && step < STEPS.length - 1 ? `Step ${step} of ${STEPS.length - 2}` : ""}</span>
        <span className="spacer" />
        {step < STEPS.length - 1 && <button className="link" onClick={finish}>Skip the guide</button>}
      </div>

      {name === "Welcome" && <Welcome />}
      {name === "Look" && <Look />}
      {name === "Courses" && <Courses onDone={() => setStep(step + 1)} />}
      {name === "Timetable" && <Link kind="events" />}
      {name === "Deadlines" && <Link kind="tasks" />}
      {name === "Rhythm" && <Rhythm />}
      {name === "Ready" && <Ready />}

      <div className="setup-foot">
        <div className="setup-dots" aria-hidden>
          {STEPS.map((s, i) => <span key={s} className={i === step ? "on" : i < step ? "done" : ""} />)}
        </div>
        <span className="spacer" />
        {step > 0 && step < STEPS.length - 1 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {name === "Courses" ? (
          <button className="btn primary" form="setup-courses" type="submit">Next</button>
        ) : step < STEPS.length - 1 ? (
          <button className="btn primary" onClick={() => setStep(step + 1)} autoFocus>{step === 0 ? "Start" : "Next"}</button>
        ) : (
          <button className="btn primary" onClick={() => { finish(); useUi.getState().setView("today"); }} autoFocus>Open Today</button>
        )}
      </div>
    </dialog>
  );
}

function Welcome() {
  return (
    <div className="setup-body">
      <h2>Welcome to Milo</h2>
      <p>Milo keeps your week in one calm place: the calendar, your tasks, focus time and reminders.</p>
      <p className="muted">
        A few short steps set it up for you. Every step can be skipped, and everything can be changed later in Settings.
        All of it stays on this computer.
      </p>
    </div>
  );
}

function Look() {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  return (
    <div className="setup-body">
      <h2>How Milo looks</h2>
      <p className="muted">You see the change right away.</p>
      <div className="setup-field">
        <span>Theme</span>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map(([t, label]) => (
            <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ theme: t })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="setup-field">
        <span>Accent colour</span>
        <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map(([a, label]) => (
            <button key={a} role="radio" aria-checked={prefs.accent === a} aria-label={label} title={label} data-accent-swatch={a} className={prefs.accent === a ? "on" : ""} onClick={() => setPrefs({ accent: a })} />
          ))}
        </div>
      </div>
      <div className="setup-field">
        <span>Text size</span>
        <div className="segmented" role="radiogroup" aria-label="Text size">
          {(["small", "default", "large"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={prefs.textSize === t} className={prefs.textSize === t ? "on" : ""} onClick={() => setPrefs({ textSize: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="setup-field">
        <span>Event colours</span>
        <div className="segmented" role="radiogroup" aria-label="Event colours">
          {(["soft", "normal", "strong"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={prefs.eventStrength === t} className={prefs.eventStrength === t ? "on" : ""} onClick={() => setPrefs({ eventStrength: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
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
  const inSchool = spaces.filter((s) => school && s.groupId === school.id);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const known = new Set(spaces.map((s) => s.name.trim().toLowerCase()));
    // Each name once, whatever its capitals, and none that exists already.
    const names: string[] = [];
    for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (known.has(line.toLowerCase())) continue;
      known.add(line.toLowerCase());
      names.push(line);
    }
    if (!names.length) return onDone();
    setBusy(true);
    try {
      const groupId = school?.id ?? (await api.createGroup({ name: "School" })).id;
      // Colours in palette order, skipping grey and the ones already used, then round again.
      const used = new Set(spaces.map((s) => s.color));
      const free = PALETTE.filter((c) => c !== "gray" && !used.has(c));
      const colours = free.length ? free : PALETTE.filter((c) => c !== "gray");
      for (const [i, name] of names.entries()) {
        await api.createSpace({ name, groupId, color: colours[i % colours.length], role: "normal", icon: "book" });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ["spaces"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="setup-courses" className="setup-body" onSubmit={save}>
      <h2>Your courses</h2>
      <p className="muted">
        Type the courses of this semester, one per line. Each gets its own space with a colour, grouped under School.
        Later you can give them an icon and change anything.
      </p>
      <textarea
        className="setup-textarea"
        rows={6}
        placeholder={"Analysis 2\nPhysics\nChemistry"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        autoFocus
      />
      {inSchool.length > 0 && (
        <p className="muted small">
          Already there:{" "}
          {inSchool.map((s, i) => (
            <span key={s.id} style={{ ["--c" as string]: colorVar(s.color) }}>
              {i > 0 && ", "}
              {s.name}
            </span>
          ))}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/** A calendar link: the timetable (as events) or the deadlines of the learning platform (as tasks). */
function Link({ kind }: { kind: "events" | "tasks" }) {
  const qc = useQueryClient();
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const sources = (useImportSources().data ?? []).filter((s) => s.importAs === kind);
  const [url, setUrl] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});
  const space = spaceId || (spaces.find((s) => s.id === "seed-space-personal") ?? spaces[0])?.id || "";

  const add = async () => {
    if (!url.trim()) return;
    setState({ busy: true });
    try {
      const r = await api.addCalendarLink({
        name: kind === "events" ? "Timetable" : "Deadlines", location: url.trim(), spaceId: space, enabled: true, importAs: kind,
      });
      setUrl("");
      setState({ ok: `Added: ${r.added} ${kind === "events" ? "events" : "tasks"}.` });
      qc.invalidateQueries();
    } catch (err) {
      setState({ error: String(err) });
    }
  };

  return (
    <div className="setup-body">
      <h2>{kind === "events" ? "Your timetable" : "Your deadlines"}</h2>
      <p className="muted">
        {kind === "events"
          ? "Most school timetable sites can share a calendar link. Look for “Export”, “iCal”, “Subscribe” or “Calendar link” and copy the address (it often ends in .ics). Milo then keeps the timetable up to date by itself."
          : "Learning platforms such as Canvas, Moodle, Toledo or Smartschool have a calendar link with hand-in dates, often under Calendar › Export. Each item becomes a task with that deadline, which you can tick off."}
      </p>
      {sources.length > 0 && <p className="small">Already linked: {sources.map((s) => s.name).join(", ")}.</p>}
      <div className="setup-link">
        <input type="url" placeholder="https://…" aria-label="Calendar link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add} disabled={!url.trim() || state.busy}>{state.busy ? "Adding…" : "Add"}</button>
      </div>
      <label className="setup-field">
        <span>{kind === "events" ? "Space for items no course matches" : "Space for the tasks"}</span>
        <select value={space} onChange={(e) => setSpaceId(e.target.value)}>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {state.ok && <p className="small">{state.ok}</p>}
      {state.error && <p className="error">{state.error}</p>}
      <p className="muted small">No link? Skip this step; it can be added later in Settings › Import &amp; export.</p>
    </div>
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
  const rule = (r: typeof medication, patch: Partial<NonNullable<typeof medication>>) => {
    if (!r) return;
    const { id, ...input } = { ...r, ...patch };
    save(() => api.updateReminderRule(id, input));
  };

  return (
    <div className="setup-body">
      <h2>Your rhythm</h2>
      <p className="muted">
        The morning and evening routines on Today follow these times, and the calendar opens at your wake-up hour.
      </p>
      <div className="setup-row">
        <label className="setup-field">
          <span>Usually up at</span>
          <TimeField value={morning?.startTime ?? "07:00"} onCommit={setWake} />
        </label>
        <label className="setup-field">
          <span>Usually in bed at</span>
          <TimeField value={evening?.endTime ?? "23:30"} onCommit={setBed} />
        </label>
      </div>
      {medication && (
        <div className="setup-check">
          <label className="check">
            <input type="checkbox" checked={medication.enabled} onChange={(e) => rule(medication, { enabled: e.target.checked })} />
            <span>Remind me to take medication, and let me tick it off</span>
          </label>
          {medication.enabled && (
            <label className="setup-field inline">
              <span>at</span>
              <TimeField
                value={(medication.times ?? "08:00").split(",")[0]}
                onCommit={(t) => parseTime(t) && rule(medication, { times: t })}
              />
            </label>
          )}
        </div>
      )}
      {water && (
        <label className="check">
          <input type="checkbox" checked={water.enabled} onChange={(e) => rule(water, { enabled: e.target.checked })} />
          <span>
            Remind me to drink water every {water.intervalMinutes ?? 90} minutes
            {water.startTime && water.endTime ? `, ${fmtHm(water.startTime)}–${fmtHm(water.endTime)}` : ""}
          </span>
        </label>
      )}
      <p className="muted small">Reminders can be changed or added under Reminders.</p>
    </div>
  );
}

function Ready() {
  return (
    <div className="setup-body">
      <h2>Milo is ready</h2>
      <p>Today shows your day: what runs now, what comes next, and one suggestion for free time.</p>
      <ul className="setup-tips">
        <li>Drag a task onto the calendar to set time aside for it.</li>
        <li>Press {CAPTURE_KEY} anywhere, also when Milo is hidden, to write something down.</li>
        <li>Press ? for all keyboard shortcuts. This guide is in Settings › Data &amp; app.</li>
      </ul>
    </div>
  );
}

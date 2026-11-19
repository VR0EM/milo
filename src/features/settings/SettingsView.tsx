import { fmtHour } from "../../lib/time";
import { PALETTE, colorVar } from "../../lib/colors";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, autostart, files, inDesktop, onModelProgress } from "../../lib/api";
import type { BackupFile } from "../../lib/types";
import { checkForUpdate, installUpdate, useUpdates } from "../../lib/updates";
import { useActivities, useSmartModel, useSpaces, useTaskTypes } from "../../lib/queries";
import { TODAY_BLOCKS, useUi, type Accent, type Corners, type Density, type Font, type Palette, type SidebarWidth, type TextSize, type Theme } from "../../lib/store";
import { CustomCss } from "./CustomCss";
import { NAV } from "../spaces/Sidebar";
import { IS_MAC } from "../shortcuts/keys";
import { Icon } from "../../components/Icon";
import { HelpTip } from "../../components/HelpTip";
import { ImportSettings } from "../import/ImportView";
import { ArchiveSettings } from "../archive/ArchiveView";
import { AiSettings } from "./AiSettings";

export const ACCENTS: [Accent, string][] = [["blue", "Blue"], ["teal", "Teal"], ["green", "Green"], ["plum", "Violet"], ["clay", "Coral"]];
// Rounded uses the Mac's rounded system font; Windows has none, so there it looked exactly
// like Standard and is left out.
const FONTS: [Font, string, string][] = [
  ["system", "Standard", "The computer's own typeface"],
  ["rounded", "Rounded", "Softer, rounded letter ends"],
  ["humanist", "Humanist", "Open, slightly warmer shapes"],
  ["serif", "Serif", "Like a printed book"],
].filter(([f]) => IS_MAC || f !== "rounded") as [Font, string, string][];
const SIZES: [TextSize, string][] = [["small", "Small"], ["default", "Default"], ["large", "Large"]];
const THEMES: [Theme, string][] = [["system", "Match the computer"], ["light", "Light"], ["dark", "Dark"]];
const PALETTES: [Palette, string, string][] = [
  ["neutral", "Neutral", "Plain greys"],
  ["paper", "Paper", "Warm, like paper"],
  ["slate", "Slate", "Cool blue-grey"],
  ["sage", "Sage", "A hint of green"],
  ["ink", "Ink", "Crisp white, or black at night"],
];
const CATEGORY: Record<string, string> = { class: "Class", self_study: "Self-study", other: "Not productive" };

/** One labelled setting: the name (with an optional "?" explanation) on the left, the control on the right. */
function Row({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {info && <HelpTip label={`About ${title.toLowerCase()}`}>{info}</HelpTip>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

const SECTIONS = ["appearance", "today", "calendar", "import", "ai", "archive", "data"];

/** A row of buttons for one choice. */
function Choice<T extends string>({ value, label, options, onChange }: { value: T; label: string; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Today's blocks: a tick to show each, and arrows to move it up or down. */
/** Today's blocks: tick to show, drag the grip to reorder (or focus it and use the arrow keys). */
function TodayBlocks() {
  const order = useUi((s) => s.prefs.todayOrder);
  const hidden = useUi((s) => s.prefs.todayHidden);
  const setPrefs = useUi((s) => s.setPrefs);
  const label = new Map(TODAY_BLOCKS);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  const moveTo = (from: number, to: number) => {
    if (to === from || to === from + 1) return;
    const next = [...order];
    const [b] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, b);
    setPrefs({ todayOrder: next });
  };

  const press = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rows = [...(listRef.current?.children ?? [])] as HTMLElement[];
    const slot = (y: number) => {
      const i = rows.findIndex((r) => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
      return i < 0 ? rows.length : i;
    };
    let over = from;
    setDrag({ from, over });
    const onMove = (m: PointerEvent) => {
      over = slot(m.clientY);
      setDrag({ from, over });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      moveTo(from, over);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <ul className="order-list" ref={listRef}>
      {order.map((b, i) => (
        <li
          key={b}
          className={[
            drag?.from === i ? "dragging" : "",
            drag && drag.over === i && drag.over !== drag.from && drag.over !== drag.from + 1 ? "drop-before" : "",
            drag && drag.over === order.length && i === order.length - 1 ? "drop-after" : "",
          ].join(" ")}
        >
          <button
            type="button"
            className="grip"
            aria-label={`Move ${label.get(b)}: drag, or use the arrow keys`}
            title="Drag to move"
            onPointerDown={(e) => press(e, i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); moveTo(i, i - 1); }
              if (e.key === "ArrowDown" && i < order.length - 1) { e.preventDefault(); moveTo(i, i + 2); }
            }}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
              {[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.3" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.3" />])}
            </svg>
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={!hidden.includes(b)}
              onChange={(e) => setPrefs({ todayHidden: e.target.checked ? hidden.filter((x) => x !== b) : [...hidden, b] })}
            />
            <span>{label.get(b)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Her palette for spaces: drag to reorder, × to remove, + to add her own. */
function SpaceColors() {
  const colors = useUi((s) => s.prefs.spaceColors);
  const setPrefs = useUi((s) => s.setPrefs);
  const [adding, setAdding] = useState("#3fa7d6");
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const moveTo = (from: number, to: number) => {
    if (to === from) return;
    const next = [...colors];
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    setPrefs({ spaceColors: next });
  };
  // The swatch under the pointer, by distance to each swatch's centre (the list wraps).
  const slotAt = (x: number, y: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("li.color-item") ?? [])];
    let best = 0, dist = Infinity;
    items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  };
  const press = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let over = from;
    setDrag({ from, over });
    const onMove = (m: PointerEvent) => { over = slotAt(m.clientX, m.clientY); setDrag({ from, over }); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      moveTo(from, over);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="color-editor">
      <ul className="color-list" ref={listRef}>
        {colors.map((c, i) => (
          <li key={c} className={`color-item${drag?.from === i ? " dragging" : ""}${drag && drag.over === i && drag.from !== i ? " drop" : ""}`}>
            <button
              type="button"
              className="color-swatch"
              style={{ ["--c" as string]: colorVar(c) }}
              aria-label={`${c}: drag to move, or use the arrow keys`}
              title="Drag to move"
              onPointerDown={(e) => press(e, i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); moveTo(i, i - 1); }
                if (e.key === "ArrowRight" && i < colors.length - 1) { e.preventDefault(); moveTo(i, i + 1); }
              }}
            />
            {colors.length > 1 && (
              <button type="button" className="color-remove" aria-label={`Remove ${c}`} title="Remove" onClick={() => setPrefs({ spaceColors: colors.filter((x) => x !== c) })}>
                ×
              </button>
            )}
          </li>
        ))}
        <li className="color-add">
          <label title="Choose a colour to add">
            <input type="color" aria-label="A colour to add" value={adding} onChange={(e) => setAdding(e.target.value)} />
            <span className="color-swatch" style={{ ["--c" as string]: adding }} />
          </label>
          <button
            type="button"
            className="btn small"
            disabled={colors.includes(adding.toLowerCase())}
            onClick={() => setPrefs({ spaceColors: [...colors, adding.toLowerCase()] })}
          >
            + Add
          </button>
        </li>
      </ul>
      {colors.join() !== PALETTE.join() && (
        <button type="button" className="link" onClick={() => setPrefs({ spaceColors: [...PALETTE] })}>Back to Milo's colours</button>
      )}
    </div>
  );
}

/** A settings block that folds open and shut. Which ones are open is remembered. */
function Section({ id, title, info, children }: { id: string; title: string; info?: React.ReactNode; children: React.ReactNode }) {
  const open = useUi((s) => s.settingsOpen.includes(id));
  const focus = useUi((s) => s.settingsFocus);
  const ref = useRef<HTMLElement>(null);
  const toggle = () => useUi.getState().toggleSettingsSection(id);
  useEffect(() => {
    if (focus !== id) return;
    ref.current?.scrollIntoView({ block: "start" });
    useUi.setState({ settingsFocus: null });
  }, [focus, id]);
  return (
    <section ref={ref} className={`block fold${open ? " open" : ""}`} id={`settings-${id}`}>
      {/* The whole row is clickable; the button inside is what keyboards and screen readers use. */}
      <div className="fold-head" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, .help")) toggle(); }}>
        <h2>
          <button className="fold-toggle" aria-expanded={open} aria-controls={`settings-${id}-body`} onClick={toggle}>
            <Icon name="chevron" size={14} />
            {title}
          </button>
        </h2>
        {info && <HelpTip label={`About ${title.toLowerCase()}`}>{info}</HelpTip>}
      </div>
      {open && <div className="fold-body" id={`settings-${id}-body`}>{children}</div>}
    </section>
  );
}

export function SettingsView() {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  const allOpen = useUi((s) => SECTIONS.every((id) => s.settingsOpen.includes(id)));

  return (
    <main className="page full">
      <header className="toolbar">
        <h1>Settings</h1>
        <span className="spacer" />
        <button className="btn small" onClick={() => useUi.setState({ settingsOpen: allOpen ? [] : SECTIONS })}>
          {allOpen ? "Close all" : "Open all"}
        </button>
      </header>
      <div className="page-scroll settings">
        <Section id="appearance" title="Appearance">
          <Row title="Theme">
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {THEMES.map(([t, label]) => (
                <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ theme: t })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Colours">
            <div className="palette-picker" role="radiogroup" aria-label="Colours">
              {PALETTES.map(([p, label, hint]) => (
                <button key={p} role="radio" aria-checked={prefs.palette === p} title={hint} className={prefs.palette === p ? "on" : ""} onClick={() => setPrefs({ palette: p })}>
                  <span className="palette-sample" data-palette-sample={p} aria-hidden="true"><i className="ps-side" /><i className="ps-card" /></span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row title="Material" info="Glass lets the window float on a soft background made from your colours, with see-through panes. Solid is plain and flat.">
            <Choice<"solid" | "glass"> value={prefs.glass ? "glass" : "solid"} label="Material" options={[["solid", "Solid"], ["glass", "Glass"]]} onChange={(m) => setPrefs({ glass: m === "glass" })} />
          </Row>
          <Row title="Accent colour">
            <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map(([a, label]) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={prefs.accent === a}
                  aria-label={label}
                  title={label}
                  data-accent-swatch={a}
                  className={prefs.accent === a ? "on" : ""}
                  onClick={() => setPrefs({ accent: a })}
                />
              ))}
              <label className={`accent-custom${prefs.accent === "custom" ? " on" : ""}`} title="Your own colour" style={{ ["--sw" as string]: prefs.customAccent }}>
                <input
                  type="color"
                  aria-label="Your own accent colour"
                  value={prefs.customAccent}
                  onChange={(e) => setPrefs({ accent: "custom", customAccent: e.target.value })}
                  onClick={() => setPrefs({ accent: "custom" })}
                />
              </label>
            </div>
          </Row>
          <Row title="Space colours" info="The colours offered when you make or edit a space. Drag one to move it, × removes it (spaces that use it keep it), + adds your own.">
            <SpaceColors />
          </Row>
          <Row title="Typeface">
            <div className="font-picker" role="radiogroup" aria-label="Typeface">
              {FONTS.map(([f, label, hint]) => {
                // Rounded chosen earlier on Windows looks like Standard, so it shows as Standard.
                const on = prefs.font === f || (f === "system" && prefs.font === "rounded" && !IS_MAC);
                return (
                <button
                  key={f}
                  role="radio"
                  aria-checked={on}
                  title={hint}
                  className={on ? "on" : ""}
                  data-font-sample={f}
                  onClick={() => setPrefs({ font: f })}
                >
                  <span className="font-sample">Aa</span>
                  <span>{label}</span>
                </button>
                );
              })}
            </div>
          </Row>
          <Row title="Text size">
            <div className="segmented" role="radiogroup" aria-label="Text size">
              {SIZES.map(([t, label]) => (
                <button key={t} role="radio" aria-checked={prefs.textSize === t} className={prefs.textSize === t ? "on" : ""} onClick={() => setPrefs({ textSize: t })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Corners">
            <Choice<Corners> value={prefs.corners} label="Corners" options={[["round", "Round"], ["soft", "Soft"], ["square", "Square"]]} onChange={(corners) => setPrefs({ corners })} />
          </Row>
          <Row title="Spacing" info="How much room rows and blocks get: Compact shows more at once, Roomy is calmer to read.">
            <Choice<Density> value={prefs.density} label="Spacing" options={[["compact", "Compact"], ["comfortable", "Default"], ["roomy", "Roomy"]]} onChange={(density) => setPrefs({ density })} />
          </Row>
          <Row title="Contrast" info="Higher makes grey text and lines darker in light mode and lighter in dark mode, in every colour theme.">
            <Choice value={prefs.highContrast ? "high" : "normal"} label="Contrast" options={[["normal", "Normal"], ["high", "Higher"]]} onChange={(v) => setPrefs({ highContrast: v === "high" })} />
          </Row>
          <Row title="Sidebar width">
            <Choice<SidebarWidth> value={prefs.sidebarWidth} label="Sidebar width" options={[["narrow", "Narrow"], ["default", "Default"], ["wide", "Wide"]]} onChange={(sidebarWidth) => setPrefs({ sidebarWidth })} />
          </Row>
          <Row title="Event colours">
            <Choice value={prefs.eventStrength} label="Event colours" options={[["soft", "Soft"], ["normal", "Normal"], ["strong", "Strong"]]} onChange={(eventStrength) => setPrefs({ eventStrength })} />
          </Row>
          <Row title="Clock">
            <Choice value={prefs.timeFormat} label="Clock" options={[["24h", "14:30"], ["12h", "2:30 pm"]]} onChange={(timeFormat) => setPrefs({ timeFormat })} />
          </Row>
          <Row title="Week starts on">
            <Choice value={String(prefs.weekStart)} label="Week starts on" options={[["1", "Monday"], ["0", "Sunday"]]} onChange={(v) => setPrefs({ weekStart: v === "0" ? 0 : 1 })} />
          </Row>
          <Row title="Open Milo on">
            <select value={prefs.startView} onChange={(e) => setPrefs({ startView: e.target.value as typeof prefs.startView })}>
              <option value="last">Where I left off</option>
              <option value="today">Today</option>
              <option value="calendar">Calendar</option>
            </select>
          </Row>
          <Row title="In the sidebar" info="Screens you do not use can leave the sidebar. They stay reachable with the keyboard and nothing in them is lost.">
            <div className="check-list">
              {NAV.filter(([v]) => v !== "today").map(([v, label]) => (
                <label key={v} className="check">
                  <input
                    type="checkbox"
                    checked={!prefs.hiddenScreens.includes(v)}
                    onChange={(e) =>
                      setPrefs({ hiddenScreens: e.target.checked ? prefs.hiddenScreens.filter((x) => x !== v) : [...prefs.hiddenScreens, v] })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </Row>
          <h3 className="fold-sub">Custom CSS</h3>
          <CustomCss />
        </Section>

        <Section id="today" title="Today" info="Which blocks Today shows, and in what order. Blocks with nothing to show stay out of the way by themselves.">
          <TodayBlocks />
          <Row title="To-dos left from yesterday">
            <select value={prefs.yesterdayMode} onChange={(e) => setPrefs({ yesterdayMode: e.target.value as typeof prefs.yesterdayMode })}>
              <option value="ask">Ask me each morning</option>
              <option value="keep">Keep them on Today</option>
              <option value="drop">Take them off Today</option>
            </select>
          </Row>
        </Section>

        <Section id="calendar" title="Calendar &amp; lists">
          <Row title="Show weekends" info="Off hides Saturday and Sunday in the calendar. Events on those days are kept.">
            <label className="switch-control">
              <input type="checkbox" role="switch" checked={prefs.showWeekends} onChange={(e) => setPrefs({ showWeekends: e.target.checked })} />
              <span>{prefs.showWeekends ? "On" : "Off"}</span>
            </label>
          </Row>
          <Row title="New events last">
            <select value={prefs.eventMinutes} onChange={(e) => setPrefs({ eventMinutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
            </select>
          </Row>
          <Row title="Open the calendar at">
            <select value={prefs.dayStartHour} onChange={(e) => setPrefs({ dayStartHour: Number(e.target.value) })}>
              {Array.from({ length: 13 }, (_, h) => h).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
            </select>
          </Row>
          <MenuBarNext />
          <SmartSuggestions />
          <Lists />
        </Section>

        <Section id="import" title="Import &amp; export">
          <ImportSettings />
        </Section>
        <Section id="ai" title="Connect AI">
          <AiSettings />
        </Section>
        <Section id="archive" title="Archive" info="Everything you archive stays here and can be brought back, until you delete it for good. A calendar link takes its events with it. Spaces and groups something still belongs to, and single events from a calendar link, always stay. Deleting happens after the daily backup, so a mistake can still be undone with Restore a backup.">
          <ArchiveSettings />
        </Section>
        <Section id="data" title="Data &amp; app">
          <Data />
          <h3 className="fold-sub">App</h3>
          <Updates />
          <Startup />
          <Row title="Welcome guide" info="The short guide from the first start: look, courses, timetable, deadlines and rhythm. Running it again adds; it removes nothing.">
            <button className="btn" onClick={() => useUi.setState({ setupOpen: true })}>Open the guide</button>
          </Row>
          <Row title="Keyboard shortcuts">
            <button className="btn" onClick={() => useUi.setState({ shortcutsOpen: true })}>Show shortcuts</button>
          </Row>
        </Section>
      </div>
    </main>
  );
}

function ListBox({ title, info, add, children }: { title: string; info?: string; add: () => void; children: React.ReactNode }) {
  return (
    <div className="list-box">
      <div className="list-box-head">
        <h3>{title}{info && <HelpTip label={`About ${title.toLowerCase()}`}>{info}</HelpTip>}</h3>
        <button className="btn small" onClick={add}><Icon name="plus" size={12} />Add</button>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ListItem({ name, meta, onEdit }: { name: string; meta?: string; onEdit: () => void }) {
  return (
    <li className="list-item">
      <span className="list-name">{name}</span>
      {meta && <span className="list-meta">{meta}</span>}
      <button className="link" onClick={onEdit}>Edit</button>
    </li>
  );
}

function Lists() {
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);
  const types = (useTaskTypes().data ?? []).filter((t) => !t.deletedAt);
  const spaceName = new Map((useSpaces().data ?? []).map((s) => [s.id, s.name]));
  const open = useUi((s) => s.openDialog);

  return (
    <>
      <h3 className="fold-sub">Lists</h3>
      <ListBox title="Activities" info="What kind of time an event was: class, self-study, lab, exam and so on. Each one counts as class, self-study or not productive, which is what Insights adds up." add={() => open({ kind: "activity" })}>
        {activities.map((a) => <ListItem key={a.id} name={a.name} meta={CATEGORY[a.category]} onEdit={() => open({ kind: "activity", item: a })} />)}
      </ListBox>
      <ListBox title="Task types" info="Kinds of to-dos in a course, such as Assignment or Theory. A type can be for every course or for one; a course page counts its to-dos per type." add={() => open({ kind: "task_type" })}>
        {types.map((t) => (
          <ListItem key={t.id} name={t.name} meta={t.spaceId ? spaceName.get(t.spaceId) ?? "One course" : "All courses"} onEdit={() => open({ kind: "task_type", item: t })} />
        ))}
      </ListBox>
    </>
  );
}

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/** The optional model behind the Inbox's "Move to" choices (see src-tauri/src/suggest.rs). */
function SmartSuggestions() {
  const qc = useQueryClient();
  const status = useSmartModel().data;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["smartModel"] });
    qc.invalidateQueries({ queryKey: ["suggest"] });
  };

  const download = async () => {
    setError(null);
    setProgress(0);
    const stop = await onModelProgress((done) => setProgress(done));
    try {
      await api.downloadSmartModel();
    } catch (e) {
      setError(String(e));
    } finally {
      stop();
      setProgress(null);
      refresh();
    }
  };

  const busy = progress !== null || !!status?.downloading;
  return (
    <Row
      title="Smarter suggestions"
      info={
        <>
          For notes in the Inbox, Milo suggests a course or list, learned from what you filed before. This download adds
          knowledge of words you have not used yet, so that "optics" goes with Physics. It is fetched once from Hugging Face
          and then works on this computer only; nothing you write is sent anywhere.
        </>
      }
    >
      <div className="model-row">
        {status?.installed ? (
          <>
            <span className="muted">On · {mb(status.bytes)} on this computer</span>
            <button className="btn small" onClick={async () => { await api.removeSmartModel().catch((e) => setError(String(e))); refresh(); }}>Remove</button>
          </>
        ) : busy ? (
          <span className="muted tabular" role="status">
            Downloading… {progress !== null && status ? `${mb(progress)} of ${mb(status.bytes)}` : ""}
          </span>
        ) : (
          <>
            <span className="muted">Words only</span>
            <button className="btn small" disabled={!inDesktop || !status} title={inDesktop ? undefined : "Only in the desktop app"} onClick={download}>
              Download{status ? ` (${mb(status.bytes)})` : ""}
            </button>
          </>
        )}
        {error && <span className="error small">{error}</span>}
      </div>
    </Row>
  );
}

/** The next event next to the tray icon (macOS menu bar; the tooltip on Windows). */
function MenuBarNext() {
  const qc = useQueryClient();
  const { data: on } = useQuery({ queryKey: ["menubarSetting"], queryFn: api.menubarSetting });
  return (
    <Row
      title={IS_MAC ? "Next event in the menu bar" : "Next event at the Milo icon"}
      info={
        <>
          Next to Milo's icon {IS_MAC ? "in the menu bar" : "by the clock (hover over it)"}: the next event and how long until it
          starts, like "Chemistry lab in 25 min", or how long is left while it runs. It shows from three hours before, and
          switches to the next event a quarter of an hour before that one starts. Sleep, all-day events and events marked as
          not happening are left out. A running focus session shows its own time there instead.
        </>
      }
    >
      <label className="switch-control">
        <input
          type="checkbox"
          role="switch"
          checked={on ?? true}
          disabled={on === undefined}
          onChange={async (e) => {
            await api.setMenubarSetting(e.target.checked);
            qc.invalidateQueries({ queryKey: ["menubarSetting"] });
          }}
        />
        <span>{on === false ? "Off" : "On"}</span>
      </label>
    </Row>
  );
}

function Updates() {
  const { available, status, progress, error } = useUpdates();
  const auto = useUi((s) => s.prefs.autoUpdates);
  const busy = status === "checking" || status === "installing";
  const line =
    status === "checking" ? "Checking…"
    : status === "installing" ? (progress === null ? "Installing…" : `Downloading ${Math.round(progress * 100)}%`)
    : available ? `Milo ${available.version} is ready to install`
    : status === "up-to-date" ? "Milo is up to date"
    : status === "error" ? `Could not check: ${error}`
    : "";
  return (
    <>
      <Row title="Version">
        <div className="inline">
          {/* Built into this copy of Milo, so it is always there (asking the app for it sometimes failed on Windows). */}
          <span className="muted">Milo {__APP_VERSION__}</span>
          <button className="link" onClick={() => useUi.setState({ whatsNewOpen: true })}>What's new</button>
        </div>
      </Row>
      <Row title="New version">
        <div className="inline">
          {line && <span className={`small ${status === "error" ? "late" : "muted"}`}>{line}</span>}
          {available && status !== "installing" ? (
            <button className="btn primary small" onClick={() => installUpdate()}>Install and restart</button>
          ) : (
            <button className="btn small" disabled={!files.available || busy} onClick={() => checkForUpdate()}>Check now</button>
          )}
        </div>
      </Row>
      <Row
        title="Check when Milo starts"
        info="At most once a day, Milo asks GitHub which version is the newest. Nothing about you or your data is sent. Off means Milo only checks when you press Check now."
      >
        <label className="switch-control">
          <input type="checkbox" role="switch" checked={auto} onChange={(e) => useUi.getState().setPrefs({ autoUpdates: e.target.checked })} />
          <span>{auto ? "On" : "Off"}</span>
        </label>
      </Row>
    </>
  );
}

function Startup() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    autostart.isEnabled().then(setOn, () => {});
  }, []);
  return (
    <>
      <Row
        title="Start Milo when the computer starts"
      >
        <label className="switch-control">
          <input
            type="checkbox"
            role="switch"
            disabled={!autostart.available}
            checked={on}
            onChange={async (e) => {
              const next = e.target.checked;
              try {
                await autostart.set(next);
                setOn(next);
              } catch (err) {
                useUi.getState().notify({ text: String(err), error: true });
              }
            }}
          />
          <span>{on ? "On" : "Off"}</span>
        </label>
      </Row>
    </>
  );
}

function Data() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: 0 });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backupSettings, staleTime: 0 }).data;
  const [restoring, setRestoring] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backups"] });
  const notify = (text: string, error = false) => useUi.getState().notify({ text, error });

  const chooseMirror = async () => {
    try {
      const path = await files.folder();
      if (!path) return;
      const copied = await api.setBackupMirror(path);
      notify(copied ? `Copied ${copied} backup${copied === 1 ? "" : "s"} to the second folder` : "The second folder is up to date");
    } catch (e) {
      notify(String(e), true);
    } finally {
      refresh();
    }
  };

  return (
    <>
      <Row title="Stored on this computer">
        <code className="path" title={data?.dataDir}>{data?.dataDir ?? "…"}</code>
      </Row>
      <Row title="Daily backups">
        <span className="muted">
          {backups ? (backups.backups.length ? `${backups.backups.length} kept · newest ${backups.backups[0].date}` : "None yet") : "…"}
        </span>
      </Row>
      <Row
        title="Second backup folder"
        info="Copies of the daily backups also go to a folder you choose, such as a USB stick or a folder that your own cloud app syncs. If the laptop breaks, the copies are still there."
      >
        <div className="inline">
          {backups?.mirrorDir ? <code className="path" title={backups.mirrorDir}>{backups.mirrorDir}</code> : <span className="muted">Not set</span>}
          <button className="btn small" disabled={!files.available} onClick={chooseMirror}>{backups?.mirrorDir ? "Change…" : "Choose folder…"}</button>
          {backups?.mirrorDir && (
            <button className="link" onClick={() => api.setBackupMirror(null).then(refresh, (e) => notify(String(e), true))}>Stop</button>
          )}
        </div>
      </Row>
      <Row
        title="Restore a backup"
        info="Puts Milo back to how it was on an earlier day. What you have now is saved as a backup first, so nothing is lost."
      >
        <button className="btn small" disabled={!files.available || !backups?.backups.length} onClick={() => setRestoring(true)}>Choose a backup…</button>
      </Row>
      <Row title="Export everything">
        <button className="btn small" onClick={() => useUi.getState().openSettings("import")}>Go to Import &amp; export</button>
      </Row>
      {restoring && backups && <RestoreDialog backups={backups.backups} onClose={() => { setRestoring(false); refresh(); }} />}
    </>
  );
}

function RestoreDialog({ backups, onClose }: { backups: BackupFile[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [pick, setPick] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const restore = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const safety = await api.restoreBackup(pick.name);
      await qc.invalidateQueries();
      useUi.getState().notify({ text: `Restored the backup of ${pick.date}. Your data from just before is kept as ${safety}.` });
      onClose();
    } catch (e) {
      useUi.getState().notify({ text: String(e), error: true });
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose}>
      <h2>Restore a backup</h2>
      {!pick ? (
        <>
          <p className="muted small">Pick the day to go back to.</p>
          <ul className="rows restore-list">
            {backups.map((b) => (
              <li key={b.name} className="row">
                <span className="row-title">{b.date}</span>
                <span className="muted small">{Math.max(1, Math.round(b.bytes / 1024))} KB</span>
                <button className="btn small" onClick={() => setPick(b)}>Choose</button>
              </li>
            ))}
          </ul>
          <div className="dialog-foot">
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p>
            Milo will look exactly like it did in the backup of <strong>{pick.date}</strong>. Changes made since then
            are saved as a separate backup first, so you can come back to them.
          </p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setPick(null)} disabled={busy}>Back</button>
            <span className="spacer" />
            <button className="btn primary" onClick={restore} disabled={busy}>{busy ? "Restoring…" : `Restore ${pick.date}`}</button>
          </div>
        </>
      )}
    </dialog>
  );
}

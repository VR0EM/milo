import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useArchiveWithUndo, useInsights, useSemesters, useSpaces, useAction } from "../../lib/queries";
import { useUi, type InsightsPeriod } from "../../lib/store";
import { addDays, startOfWeek, toDateInput } from "../../lib/time";
import type { Insights, Semester, Space } from "../../lib/types";
import { ColumnChart, DataTable, Legend, fmtMinutes, type Column, type Series } from "./Charts";

const STUDY: Series[] = [
  { name: "Class", color: "var(--series-class)" },
  { name: "Self-study", color: "var(--series-study)" },
];
const SLEEP: Series[] = [{ name: "Sleep", color: "var(--series-sleep)" }];

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", o);
const dayMonth = fmt({ day: "numeric", month: "short" });
const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const monthYear = fmt({ month: "long", year: "numeric" });
const weekdayDay = fmt({ weekday: "short", day: "numeric" });
const longDay = fmt({ weekday: "long", day: "numeric", month: "long" });
const parse = (iso: string) => new Date(`${iso}T00:00`);

interface Period {
  from: Date;
  to: Date; // exclusive
  label: string;
}

function periodFor(kind: InsightsPeriod, anchor: Date, semester: Semester | null): Period | null {
  if (kind === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), label: `${dayMonth.format(from)} – ${dayMonthYear.format(addDays(from, 6))}` };
  }
  if (kind === "month") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { from, to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1), label: monthYear.format(from) };
  }
  if (!semester) return null;
  const from = parse(semester.startDate);
  const last = parse(semester.endDate);
  return { from, to: addDays(last, 1), label: `${semester.name} · ${dayMonthYear.format(from)} – ${dayMonthYear.format(last)}` };
}

export function InsightsView() {
  const kind = useUi((s) => s.insightsPeriod);
  const anchor = useUi((s) => s.insightsAnchor);
  const semesterId = useUi((s) => s.insightsSemesterId);
  const semesters = useSemesters().data ?? [];
  const today = toDateInput(new Date());
  const semester =
    semesters.find((s) => s.id === semesterId) ??
    semesters.find((s) => s.startDate <= today && s.endDate >= today) ??
    semesters[0] ??
    null;
  const period = periodFor(kind, anchor, semester);

  const move = (dir: number) => {
    useUi.setState({
      insightsAnchor: kind === "week" ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1),
    });
  };

  return (
    <main className="page full">
      <header className="toolbar">
        <h1>Insights</h1>
        <div className="toolbar-actions">
          <div className="segmented" role="tablist" aria-label="Period">
            {(["week", "month", "semester"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => useUi.setState({ insightsPeriod: k })}>
                {k[0].toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="page-scroll insights-scroll">
        <div className="inline">
          {kind === "semester" ? (
            semesters.length > 0 && (
              <select
                aria-label="Semester"
                value={semester?.id ?? ""}
                onChange={(e) => useUi.setState({ insightsSemesterId: e.target.value })}
              >
                {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )
          ) : (
            <>
              <button className="btn" aria-label={`Previous ${kind}`} onClick={() => move(-1)}>‹</button>
              <button className="btn" aria-label={`Next ${kind}`} onClick={() => move(1)}>›</button>
              <button className="btn" onClick={() => useUi.setState({ insightsAnchor: new Date() })}>
                {kind === "week" ? "This week" : "This month"}
              </button>
            </>
          )}
          {period && <span className="period-label">{period.label}</span>}
        </div>

        {period ? (
          <Report
            period={period}
            previous={kind === "semester" ? null : periodFor(kind, kind === "week" ? addDays(anchor, -7) : new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1), null)}
            kind={kind}
          />
        ) : (
          <p className="muted">Add a semester below to see Insights for it.</p>
        )}
        {kind === "semester" && <Semesters semesters={semesters} />}
      </div>
    </main>
  );
}

function Report({ period, previous, kind }: { period: Period; previous: Period | null; kind: InsightsPeriod }) {
  const { data } = useInsights(toDateInput(period.from), toDateInput(period.to));
  const before = useInsights(toDateInput((previous ?? period).from), toDateInput((previous ?? period).to)).data;
  const spaces = useSpaces().data ?? [];
  if (!data) return null;
  return <ReportBody data={data} before={previous ? before ?? null : null} kind={kind} spaces={spaces} />;
}

function Block({ title, legend, table, children, className = "" }: {
  title: string; legend?: Series[]; table?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`block ${className}`}>
      <div className="block-head">
        <h2>{title}</h2>
        {legend && !asTable && <Legend series={legend} />}
        <span className="spacer" />
        {table && <button className="link" onClick={() => setAsTable(!asTable)}>{asTable ? "Show chart" : "Show table"}</button>}
      </div>
      {asTable ? table : children}
    </section>
  );
}

/** "2 h 24 more than last week". Plain words, no colours: information, not a score. */
function compare(now: number, then: number | undefined, kind: InsightsPeriod, fmt: (n: number) => string) {
  if (then === undefined || kind === "semester") return "\u00a0";
  const last = kind === "week" ? "last week" : "last month";
  const diff = now - then;
  if (Math.abs(diff) < 1) return `Same as ${last}`;
  return `${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${last}`;
}

function ReportBody({ data, before, kind, spaces }: { data: Insights; before: Insights | null; kind: InsightsPeriod; spaces: Space[] }) {
  const productive = data.totals.class + data.totals.selfStudy;
  const prevProductive = before ? before.totals.class + before.totals.selfStudy : undefined;
  const perDay = data.elapsedDays > 0 ? productive / data.elapsedDays : 0;
  const prevPerDay = before && before.elapsedDays > 0 ? (before.totals.class + before.totals.selfStudy) / before.elapsedDays : undefined;
  const session = data.productiveSessions ? productive / data.productiveSessions : 0;
  const prevSession = before?.productiveSessions ? (before.totals.class + before.totals.selfStudy) / before.productiveSessions : undefined;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  const columns = useMemo<Column[]>(() => {
    const n = data.buckets.length;
    const every = n <= 7 ? 1 : data.bucket === "day" ? 7 : n > 12 ? 2 : 1;
    return data.buckets.map((b, i) => {
      const d = parse(b.start);
      const title = data.bucket === "day" ? longDay.format(d) : `Week of ${dayMonth.format(d)}`;
      const label = i % every ? "" : data.bucket === "day" ? (n <= 7 ? weekdayDay.format(d) : String(d.getDate())) : dayMonth.format(d);
      return { key: b.start, label, title, values: [b.class, b.selfStudy] };
    });
  }, [data]);

  const nights = useMemo<Column[]>(() => {
    const byDate = new Map(data.nights.map((n) => [n.date, n.minutes]));
    if (data.bucket === "week") {
      return data.buckets.map((b, i) => {
        const start = parse(b.start);
        const list = Array.from({ length: 7 }, (_, k) => byDate.get(toDateInput(addDays(start, k)))).filter((x): x is number => x !== undefined);
        const avg = list.length ? list.reduce((a, c) => a + c, 0) / list.length : 0;
        return { key: b.start, label: data.buckets.length > 12 && i % 2 ? "" : dayMonth.format(start), title: `Week of ${dayMonth.format(start)}, average per night`, values: [avg] };
      });
    }
    return data.buckets.map((b, i) => ({ key: b.start, label: columns[i]?.label ?? "", title: `Night to ${longDay.format(parse(b.start))}`, values: [byDate.get(b.start) ?? 0] }));
  }, [data, columns]);

  const perSpace = data.spaces
    .map((s) => ({ ...s, total: s.class + s.selfStudy + s.other + s.sleep }))
    .filter((s) => s.total > 0);
  const maxSpace = Math.max(1, ...perSpace.map((s) => s.total));
  const split = Math.max(1, data.totals.class, data.totals.selfStudy);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Productive time</div>
          <div className="stat-value">{fmtMinutes(productive)}</div>
          <div className="stat-note">{compare(productive, prevProductive, kind, fmtMinutes)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Average per day</div>
          <div className="stat-value">{fmtMinutes(perDay)}</div>
          <div className="stat-note">{compare(perDay, prevPerDay, kind, fmtMinutes)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Tasks done</div>
          <div className="stat-value">{data.tasksDone}</div>
          <div className="stat-note">{compare(data.tasksDone, before?.tasksDone, kind, (n) => String(Math.round(n)))}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Average session</div>
          <div className="stat-value">{session ? fmtMinutes(session) : "–"}</div>
          <div className="stat-note">{session ? compare(session, prevSession, kind, fmtMinutes) : "\u00a0"}</div>
        </div>
      </div>

      <Block
        title={data.bucket === "day" ? "Productive time per day" : "Productive time per week"}
        legend={STUDY}
        table={<DataTable columns={columns} series={STUDY} />}
      >
        <ColumnChart columns={columns} series={STUDY} label="Productive time, class and self-study" totals={columns.length <= 14} />
      </Block>

      <div className="insight-pair">
        <Block
          title="Time per space"
          table={
            <table className="data-table">
              <thead><tr><th>Space</th><th>Total</th></tr></thead>
              <tbody>{perSpace.map((s) => <tr key={s.spaceId}><td>{spaceById.get(s.spaceId)?.name ?? "Unknown"}</td><td>{fmtMinutes(s.total)}</td></tr>)}</tbody>
            </table>
          }
        >
          {perSpace.length === 0 && <p className="muted">Nothing logged in this {kind} yet.</p>}
          <ul className="hbars">
            {perSpace.map((s) => {
              const space = spaceById.get(s.spaceId);
              return (
                <li key={s.spaceId} style={{ ["--s" as string]: colorVar(space?.color ?? "gray") }}>
                  <span className="hbar-label ellipsis">{space?.name ?? "Unknown"}</span>
                  <span className="hbar-track"><span style={{ width: `${(s.total / maxSpace) * 100}%` }} /></span>
                  <span className="hbar-value">{fmtMinutes(s.total)}</span>
                </li>
              );
            })}
          </ul>
        </Block>

        <Block title="Class and sleep">
          <ul className="hbars">
            {[["Class", data.totals.class, STUDY[0].color], ["Self-study", data.totals.selfStudy, STUDY[1].color]].map(([name, value, color]) => (
              <li key={name as string} style={{ ["--s" as string]: color as string }}>
                <span className="hbar-label">{name as string}</span>
                <span className="hbar-track"><span style={{ width: `${((value as number) / split) * 100}%` }} /></span>
                <span className="hbar-value">{fmtMinutes(value as number)}</span>
              </li>
            ))}
          </ul>
          <div className="sleep-line">
            <span>Average sleep</span>
            <span className="spacer" />
            <strong>{data.sleepAverage !== null ? `${fmtMinutes(data.sleepAverage)} / night` : "–"}</strong>
          </div>
          {data.nights.length > 0 ? (
            <ColumnChart columns={nights} series={SLEEP} label="Sleep per night" height={90} />
          ) : (
            <p className="muted small">No sleep logged. Events in a space marked "Counts as sleep" appear here.</p>
          )}
        </Block>
      </div>
    </>
  );
}

function Semesters({ semesters }: { semesters: Semester[] }) {
  const act = useAction("semesters");
  const archive = useArchiveWithUndo();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return (
    <section className="block">
      <h2>Semesters</h2>
      {semesters.map((s) => (
        <div key={s.id} className="import-row">
          <span className="grow"><span className="name">{s.name}</span> <span className="muted">{dayMonthYear.format(parse(s.startDate))} – {dayMonthYear.format(parse(s.endDate))}</span></span>
          <button className="link" onClick={() => archive("semester", s.id, s.name)}>Archive</button>
        </div>
      ))}
      <form
        className="semester-row"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate(async () => {
            const created = await api.createSemester({ name, startDate: start, endDate: end });
            useUi.setState({ insightsSemesterId: created.id });
            setName("");
            setStart("");
            setEnd("");
          });
        }}
      >
        <label className="field"><span>Name</span><input placeholder="Semester 1, 2026–27" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>First day</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span>Last day</span><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="btn" type="submit" disabled={!name.trim() || !start || !end}>Add</button>
      </form>
    </section>
  );
}

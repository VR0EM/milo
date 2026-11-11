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

        {period ? <Report period={period} kind={kind} /> : <p className="muted">Add a semester below to see Insights for it.</p>}
        {kind === "semester" && <Semesters semesters={semesters} />}
      </div>
    </main>
  );
}

function Report({ period, kind }: { period: Period; kind: InsightsPeriod }) {
  const { data } = useInsights(toDateInput(period.from), toDateInput(period.to));
  const spaces = useSpaces().data ?? [];
  if (!data) return null;
  return <ReportBody data={data} kind={kind} spaces={spaces} />;
}

function Block({ title, legend, table, children }: { title: string; legend?: Series[]; table?: React.ReactNode; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="block">
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

function ReportBody({ data, kind, spaces }: { data: Insights; kind: InsightsPeriod; spaces: Space[] }) {
  const study = data.totals.class + data.totals.selfStudy;
  const perDay = data.elapsedDays > 0 ? study / data.elapsedDays : 0;
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
    // One column per night of the period (or per week for a semester), empty when nothing was logged.
    const byDate = new Map(data.nights.map((n) => [n.date, n.minutes]));
    if (data.bucket === "week") {
      return data.buckets.map((b, i) => {
        const start = parse(b.start);
        const list = Array.from({ length: 7 }, (_, k) => byDate.get(toDateInput(addDays(start, k)))).filter((x): x is number => x !== undefined);
        const avg = list.length ? list.reduce((a, c) => a + c, 0) / list.length : 0;
        return { key: b.start, label: data.buckets.length > 12 && i % 2 ? "" : dayMonth.format(start), title: `Week of ${dayMonth.format(start)}, average per night`, values: [avg] };
      });
    }
    return data.buckets.map((b, i) => {
      const d = parse(b.start);
      return { key: b.start, label: columns[i]?.label ?? "", title: `Night to ${longDay.format(d)}`, values: [byDate.get(b.start) ?? 0] };
    });
  }, [data, columns]);

  const subjects = data.spaces.filter((s) => s.class + s.selfStudy > 0);
  const maxSubject = Math.max(1, ...subjects.map((s) => s.class + s.selfStudy));

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Study time</div>
          <div className="stat-value">{fmtMinutes(study)}</div>
          <div className="stat-note">{study ? `${fmtMinutes(perDay)} per day` : "Nothing logged yet"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Class</div>
          <div className="stat-value">{fmtMinutes(data.totals.class)}</div>
          <div className="stat-note">{study ? `${Math.round((data.totals.class / study) * 100)}% of study time` : " "}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Self-study</div>
          <div className="stat-value">{fmtMinutes(data.totals.selfStudy)}</div>
          <div className="stat-note">{study ? `${Math.round((data.totals.selfStudy / study) * 100)}% of study time` : " "}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sleep</div>
          <div className="stat-value">{data.sleepAverage !== null ? fmtMinutes(data.sleepAverage) : "–"}</div>
          <div className="stat-note">{data.nights.length ? `per night · ${data.nights.length} ${data.nights.length === 1 ? "night" : "nights"} logged` : "No sleep logged"}</div>
        </div>
      </div>

      <Block
        title={data.bucket === "day" ? "Study time per day" : "Study time per week"}
        legend={STUDY}
        table={<DataTable columns={columns} series={STUDY} />}
      >
        <ColumnChart columns={columns} series={STUDY} label="Study time, class and self-study" />
      </Block>

      <Block
        title="Per subject"
        legend={subjects.length ? STUDY : undefined}
        table={
          subjects.length ? (
            <table className="data-table">
              <thead><tr><th>Space</th><th>Class</th><th>Self-study</th><th>Total</th></tr></thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.spaceId}>
                    <td>{spaceById.get(s.spaceId)?.name ?? "Unknown"}</td>
                    <td>{fmtMinutes(s.class)}</td>
                    <td>{fmtMinutes(s.selfStudy)}</td>
                    <td>{fmtMinutes(s.class + s.selfStudy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : undefined
        }
      >
        {subjects.length === 0 && <p className="muted">No class or self-study logged in this {kind}.</p>}
        {subjects.map((s) => {
          const space = spaceById.get(s.spaceId);
          return (
            <div key={s.spaceId} className="subject-row">
              <span className="subject-name" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
                <span className="swatch big-sq" />
                <span className="ellipsis">{space?.name ?? "Unknown"}{space?.deletedAt ? " (archived)" : ""}</span>
              </span>
              <div className="subject-bar" title={`Class ${fmtMinutes(s.class)} · Self-study ${fmtMinutes(s.selfStudy)}`}>
                {s.class > 0 && <div style={{ width: `${(s.class / maxSubject) * 100}%`, ["--s" as string]: STUDY[0].color }} />}
                {s.selfStudy > 0 && <div style={{ width: `${(s.selfStudy / maxSubject) * 100}%`, ["--s" as string]: STUDY[1].color }} />}
              </div>
              <span className="subject-total">{fmtMinutes(s.class + s.selfStudy)}</span>
            </div>
          );
        })}
        {data.totals.other > 0 && (
          <p className="muted small">Other logged time, not counted as study: {fmtMinutes(data.totals.other)}.</p>
        )}
      </Block>

      <Block
        title={data.bucket === "day" ? "Sleep per night" : "Sleep, average per night by week"}
        table={<DataTable columns={nights} series={SLEEP} />}
      >
        {data.nights.length ? (
          <ColumnChart columns={nights} series={SLEEP} label="Sleep per night" />
        ) : (
          <p className="muted">No sleep logged. Events in a space marked "Counts as sleep" appear here.</p>
        )}
      </Block>
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

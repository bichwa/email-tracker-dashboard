import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  CartesianGrid
} from "recharts";
import "./App.css";

/* ------------------------------
   Helpers
------------------------------- */
function toISODate(d) {
  // d is Date
  return d.toISOString().slice(0, 10);
}

function parseISODate(iso) {
  // iso is "YYYY-MM-DD"
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV(rows, filename) {
  if (!rows || rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const header = columns.join(",");
  const body = rows
    .map((r) => columns.map((c) => csvEscape(r[c])).join(","))
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  a.click();

  URL.revokeObjectURL(url);
}

function App() {
  const [teamMetrics, setTeamMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  // Range controls
  const [rangePreset, setRangePreset] = useState("30"); // "7" | "14" | "30" | "custom"
  const [customStart, setCustomStart] = useState(""); // YYYY-MM-DD
  const [customEnd, setCustomEnd] = useState(""); // YYYY-MM-DD

  // Per-employee trend controls
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [employeeMetric, setEmployeeMetric] = useState("total_first_responses"); // or avg_first_response_minutes, sla_breaches

  /* ------------------------------
     LOAD METRICS
  ------------------------------- */
  useEffect(() => {
    async function loadMetrics() {
      const { data, error } = await supabase
        .from("daily_first_responder_metrics")
        .select(
          `
          date,
          employee_email,
          total_first_responses,
          avg_first_response_minutes,
          sla_breaches
        `
        )
        .order("date", { ascending: false });

      if (error) {
        console.error("Supabase error:", error);
        setTeamMetrics([]);
      } else {
        setTeamMetrics(data || []);
      }

      setLoading(false);
    }

    loadMetrics();
  }, []);

  /* ------------------------------
     Derived: available dates & employees
  ------------------------------- */
  const allDatesDesc = useMemo(() => {
    const s = new Set(teamMetrics.map((r) => r.date).filter(Boolean));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [teamMetrics]);

  const allEmployees = useMemo(() => {
    const s = new Set(teamMetrics.map((r) => r.employee_email).filter(Boolean));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [teamMetrics]);

  // Default selected employee once we have data
  useEffect(() => {
    if (!selectedEmployee && allEmployees.length > 0) {
      setSelectedEmployee(allEmployees[0]);
    }
  }, [allEmployees, selectedEmployee]);

  /* ------------------------------
     Time-range filter
  ------------------------------- */
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (allDatesDesc.length === 0) {
      return { rangeStart: null, rangeEnd: null };
    }

    const mostRecent = allDatesDesc[0];
    const mostRecentDate = parseISODate(mostRecent);

    if (rangePreset !== "custom") {
      const days = parseInt(rangePreset, 10);
      const startDate = new Date(mostRecentDate);
      startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

      return {
        rangeStart: toISODate(startDate),
        rangeEnd: mostRecent
      };
    }

    // custom
    // If custom missing, fall back to 30 days
    if (!customStart || !customEnd) {
      const startDate = new Date(mostRecentDate);
      startDate.setUTCDate(startDate.getUTCDate() - 29);
      return {
        rangeStart: toISODate(startDate),
        rangeEnd: mostRecent
      };
    }

    // Normalize (ensure start <= end)
    const s = customStart <= customEnd ? customStart : customEnd;
    const e = customStart <= customEnd ? customEnd : customStart;
    return { rangeStart: s, rangeEnd: e };
  }, [allDatesDesc, rangePreset, customStart, customEnd]);

  const metricsInRange = useMemo(() => {
    if (!rangeStart || !rangeEnd) return [];
    return teamMetrics.filter((r) => r.date >= rangeStart && r.date <= rangeEnd);
  }, [teamMetrics, rangeStart, rangeEnd]);

  /* ------------------------------
     Latest available date WITHIN RANGE
  ------------------------------- */
  const latestDateInRange = useMemo(() => {
    if (!metricsInRange.length) return null;
    // because teamMetrics is desc ordered, but metricsInRange may not be
    let max = metricsInRange[0].date;
    for (const r of metricsInRange) {
      if (r.date > max) max = r.date;
    }
    return max;
  }, [metricsInRange]);

  const latestMetrics = useMemo(() => {
    if (!latestDateInRange) return [];
    return metricsInRange.filter((r) => r.date === latestDateInRange);
  }, [metricsInRange, latestDateInRange]);

  /* ------------------------------
     TEAM ROLLUPS (LATEST DATE)
  ------------------------------- */
  const totalResponses = useMemo(() => {
    return latestMetrics.reduce((sum, r) => sum + (r.total_first_responses || 0), 0);
  }, [latestMetrics]);

  const totalBreaches = useMemo(() => {
    return latestMetrics.reduce((sum, r) => sum + (r.sla_breaches || 0), 0);
  }, [latestMetrics]);

  const avgResponse = useMemo(() => {
    let total = 0;
    let count = 0;

    for (const r of latestMetrics) {
      const avg = safeNumber(r.avg_first_response_minutes);
      const n = safeNumber(r.total_first_responses) || 0;

      if (avg !== null && n > 0) {
        total += avg * n;
        count += n;
      }
    }

    return count > 0 ? Math.round((total / count) * 10) / 10 : "—";
  }, [latestMetrics]);

  const slaPercent = useMemo(() => {
    if (totalResponses <= 0) return "—";
    const p = Math.round(((totalResponses - totalBreaches) / totalResponses) * 100);
    return clamp(p, 0, 100);
  }, [totalResponses, totalBreaches]);

  /* ------------------------------
     Aggregate per employee (LATEST DATE)
  ------------------------------- */
  const perEmployee = useMemo(() => {
    const buckets = {};

    for (const row of latestMetrics) {
      const key = row.employee_email;
      if (!key) continue;

      if (!buckets[key]) {
        buckets[key] = {
          employee_email: key,
          total_first_responses: 0,
          sla_breaches: 0,
          weighted: 0
        };
      }

      const n = row.total_first_responses || 0;
      const avg = safeNumber(row.avg_first_response_minutes) || 0;
      const b = row.sla_breaches || 0;

      buckets[key].total_first_responses += n;
      buckets[key].sla_breaches += b;
      buckets[key].weighted += avg * n;
    }

    return Object.values(buckets)
      .map((emp) => {
        const avg =
          emp.total_first_responses > 0
            ? Math.round((emp.weighted / emp.total_first_responses) * 10) / 10
            : "—";

        const sla =
          emp.total_first_responses > 0
            ? clamp(
                Math.round(
                  ((emp.total_first_responses - emp.sla_breaches) /
                    emp.total_first_responses) *
                    100
                ),
                0,
                100
              )
            : "—";

        return {
          ...emp,
          avg_response: avg,
          sla_percent: sla
        };
      })
      .sort((a, b) => (b.total_first_responses || 0) - (a.total_first_responses || 0));
  }, [latestMetrics]);

  /* ------------------------------
     Daily trend (TEAM total per day within range)
  ------------------------------- */
  const dailyTrend = useMemo(() => {
    const acc = {};
    for (const r of metricsInRange) {
      if (!r.date) continue;
      if (!acc[r.date]) {
        acc[r.date] = { date: r.date, total_first_responses: 0, sla_breaches: 0 };
      }
      acc[r.date].total_first_responses += r.total_first_responses || 0;
      acc[r.date].sla_breaches += r.sla_breaches || 0;
    }

    return Object.values(acc).sort((a, b) => a.date.localeCompare(b.date));
  }, [metricsInRange]);

  /* ------------------------------
     Per-employee trend (selected employee within range)
  ------------------------------- */
  const employeeTrend = useMemo(() => {
    if (!selectedEmployee) return [];

    const acc = {};
    for (const r of metricsInRange) {
      if (r.employee_email !== selectedEmployee) continue;
      if (!r.date) continue;

      if (!acc[r.date]) {
        acc[r.date] = {
          date: r.date,
          total_first_responses: 0,
          avg_first_response_minutes: null,
          sla_breaches: 0,
          _weightedAvg: 0,
          _weightedCount: 0
        };
      }

      const n = r.total_first_responses || 0;
      const avg = safeNumber(r.avg_first_response_minutes);
      const b = r.sla_breaches || 0;

      acc[r.date].total_first_responses += n;
      acc[r.date].sla_breaches += b;

      if (avg !== null && n > 0) {
        acc[r.date]._weightedAvg += avg * n;
        acc[r.date]._weightedCount += n;
      }
    }

    const out = Object.values(acc)
      .map((x) => ({
        date: x.date,
        total_first_responses: x.total_first_responses,
        sla_breaches: x.sla_breaches,
        avg_first_response_minutes:
          x._weightedCount > 0
            ? Math.round((x._weightedAvg / x._weightedCount) * 10) / 10
            : null
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return out;
  }, [metricsInRange, selectedEmployee]);

  /* ------------------------------
     SLA breach heatmap (per employee x date within range)
     - Uses sla_breaches (counts) and shades intensity via inline styles.
  ------------------------------- */
  const heatmap = useMemo(() => {
    // collect unique dates in range (ascending)
    const dates = Array.from(
      new Set(metricsInRange.map((r) => r.date).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const employees = Array.from(
      new Set(metricsInRange.map((r) => r.employee_email).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    // build lookup: employee -> date -> breaches
    const lookup = {};
    let maxBreaches = 0;

    for (const r of metricsInRange) {
      if (!r.employee_email || !r.date) continue;
      if (!lookup[r.employee_email]) lookup[r.employee_email] = {};
      const v = (lookup[r.employee_email][r.date] || 0) + (r.sla_breaches || 0);
      lookup[r.employee_email][r.date] = v;
      if (v > maxBreaches) maxBreaches = v;
    }

    return { dates, employees, lookup, maxBreaches };
  }, [metricsInRange]);

  function breachCellStyle(breaches, maxBreaches) {
    // keep it readable and neutral; no hard-coded brand colors
    // intensity is a grayscale-like alpha
    if (!maxBreaches || maxBreaches <= 0) {
      return { background: "transparent" };
    }
    const t = breaches / maxBreaches; // 0..1
    const alpha = 0.08 + 0.35 * clamp(t, 0, 1); // 0.08..0.43
    return {
      background: `rgba(0,0,0,${alpha})`,
      color: alpha > 0.25 ? "#fff" : "inherit"
    };
  }

  /* ------------------------------
     Exports
  ------------------------------- */
  function exportLatestResponderDay() {
    if (!latestDateInRange) return;
    exportCSV(
      latestMetrics,
      `first-responders-latest-${latestDateInRange}.csv`
    );
  }

  function exportRangeTeamDaily() {
    exportCSV(
      dailyTrend,
      `team-daily-trend-${rangeStart || "start"}-to-${rangeEnd || "end"}.csv`
    );
  }

  function exportRangeRawRows() {
    exportCSV(
      metricsInRange,
      `first-responders-raw-${rangeStart || "start"}-to-${rangeEnd || "end"}.csv`
    );
  }

  /* ------------------------------
     Safe backfill helper (NO secrets in UI)
     This prints commands the user can run locally (PowerShell).
  ------------------------------- */
  const matcherUrl = process.env.REACT_APP_MATCHER_API_URL || "";
  const backfillCommands = useMemo(() => {
    if (!matcherUrl || !rangeStart || !rangeEnd) return [];

    // Generate date list from rangeStart..rangeEnd
    const startD = parseISODate(rangeStart);
    const endD = parseISODate(rangeEnd);

    const cmds = [];
    const d = new Date(startD);
    while (d <= endD) {
      const iso = toISODate(d);
      cmds.push(
        `Invoke-RestMethod -Uri "${matcherUrl.replace(/\/$/, "")}/api/aggregate-first-responders?date=${iso}" -Headers @{ Authorization = "Bearer <CRON_SECRET>" }`
      );
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return cmds;
  }, [matcherUrl, rangeStart, rangeEnd]);

  /* ------------------------------
     UI
  ------------------------------- */
  if (loading) {
    return <p className="loading">Loading team metrics…</p>;
  }

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      {/* RANGE SELECTOR */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ marginBottom: 8 }}>Time Range</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label>
            Preset{" "}
            <select
              value={rangePreset}
              onChange={(e) => setRangePreset(e.target.value)}
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {rangePreset === "custom" && (
            <>
              <label>
                Start{" "}
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </label>
              <label>
                End{" "}
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </label>
            </>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="export-btn" onClick={exportLatestResponderDay} disabled={!latestDateInRange}>
              Export Latest Responder Day
            </button>
            <button className="export-btn" onClick={exportRangeTeamDaily} disabled={dailyTrend.length === 0}>
              Export Team Daily Trend
            </button>
            <button className="export-btn" onClick={exportRangeRawRows} disabled={metricsInRange.length === 0}>
              Export Raw Rows (Range)
            </button>
          </div>
        </div>

        <p className="subtitle" style={{ marginTop: 10 }}>
          Range: <strong>{rangeStart || "—"}</strong> to{" "}
          <strong>{rangeEnd || "—"}</strong>
          {latestDateInRange ? (
            <>
              {" "}• Latest responder day in range:{" "}
              <strong>{latestDateInRange}</strong>
            </>
          ) : null}
        </p>
      </section>

      {/* KPI CARDS (latest responder day in range) */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Team First Responses</h3>
          <p>{totalResponses}</p>
        </div>

        <div className="kpi-card">
          <h3>Team Avg Response</h3>
          <p>{avgResponse} min</p>
        </div>

        <div className="kpi-card">
          <h3>Team SLA %</h3>
          <p>{slaPercent}%</p>
        </div>
      </section>

      {/* TEAM DAILY TREND */}
      <section>
        <h2>Team First Responses Trend</h2>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="total_first_responses"
              name="First Responses"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="sla_breaches"
              name="SLA Breaches"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* TEAM LOAD DISTRIBUTION (latest responder day) */}
      <section>
        <h2>Team Load Distribution (Latest Responder Day)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={perEmployee}>
            <XAxis dataKey="employee_email" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total_first_responses" name="First Responses" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* PER-EMPLOYEE TREND */}
      <section>
        <h2>Per-Employee Trend</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <label>
            Employee{" "}
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
            >
              {allEmployees.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <label>
            Metric{" "}
            <select
              value={employeeMetric}
              onChange={(e) => setEmployeeMetric(e.target.value)}
            >
              <option value="total_first_responses">First Responses</option>
              <option value="avg_first_response_minutes">Avg Response (min)</option>
              <option value="sla_breaches">SLA Breaches</option>
            </select>
          </label>
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={employeeTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey={employeeMetric}
              name={
                employeeMetric === "total_first_responses"
                  ? "First Responses"
                  : employeeMetric === "avg_first_response_minutes"
                  ? "Avg Response (min)"
                  : "SLA Breaches"
              }
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* SLA BREACH HEATMAP */}
      <section>
        <h2>SLA Breach Heatmap</h2>

        {heatmap.dates.length === 0 || heatmap.employees.length === 0 ? (
          <p className="subtitle">No heatmap data available for this range.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                    Employee
                  </th>
                  {heatmap.dates.map((d) => (
                    <th key={d}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.employees.map((emp) => (
                  <tr key={emp}>
                    <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                      {emp}
                    </td>
                    {heatmap.dates.map((d) => {
                      const v = (heatmap.lookup[emp] && heatmap.lookup[emp][d]) || 0;
                      return (
                        <td
                          key={`${emp}-${d}`}
                          style={{
                            textAlign: "center",
                            ...breachCellStyle(v, heatmap.maxBreaches)
                          }}
                          title={`${emp} • ${d} • Breaches: ${v}`}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="subtitle" style={{ marginTop: 8 }}>
          Heatmap shows <strong>sla_breaches</strong> per employee per day in the selected range.
        </p>
      </section>

      {/* TEAM TABLE (latest responder day) */}
      <section>
        <h2>Team SLA Performance (Latest Responder Day)</h2>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>First Responses</th>
              <th>Avg Response (min)</th>
              <th>SLA Breaches</th>
              <th>SLA %</th>
            </tr>
          </thead>
          <tbody>
            {perEmployee.map((emp) => (
              <tr key={emp.employee_email}>
                <td>{emp.employee_email}</td>
                <td>{emp.total_first_responses}</td>
                <td>{emp.avg_response}</td>
                <td>{emp.sla_breaches}</td>
                <td>{emp.sla_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* SAFE BACKFILL HELPER */}
      <section>
        <h2>Backfill Missing Days (Safe)</h2>

        <p className="subtitle">
          This dashboard cannot run backfill automatically without exposing secrets in the browser.
          Use the commands below on your machine to backfill the selected date range.
        </p>

        {!matcherUrl ? (
          <p className="subtitle">
            Missing <strong>REACT_APP_MATCHER_API_URL</strong> in this dashboard deployment.
          </p>
        ) : (
          <>
            <p className="subtitle">
              Matcher URL: <strong>{matcherUrl}</strong>
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button
                className="export-btn"
                onClick={() =>
                  exportCSV(
                    backfillCommands.map((c) => ({ command: c })),
                    `backfill-commands-${rangeStart}-to-${rangeEnd}.csv`
                  )
                }
                disabled={backfillCommands.length === 0}
              >
                Export Backfill Commands
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <pre style={{ padding: 12, borderRadius: 8 }}>
{backfillCommands.slice(0, 40).join("\n")}
{backfillCommands.length > 40 ? `\n\n... (${backfillCommands.length - 40} more commands)` : ""}
              </pre>
            </div>

            <p className="subtitle">
              Replace <strong>&lt;CRON_SECRET&gt;</strong> with the matcher project’s CRON_SECRET.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export default App;

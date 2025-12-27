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
  CartesianGrid,
} from "recharts";
import "./App.css";

/* ------------------------------
  Helpers
------------------------------- */
function parseYmdToUtcDate(ymd) {
  // ymd = "YYYY-MM-DD"
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function formatUtcYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUtc(ymd, deltaDays) {
  const dt = parseYmdToUtcDate(ymd);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatUtcYmd(dt);
}

function diffDaysUtc(aYmd, bYmd) {
  const a = parseYmdToUtcDate(aYmd).getTime();
  const b = parseYmdToUtcDate(bYmd).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows, columns) {
  // columns: [{ key, label }]
  const header = columns.map((c) => `"${String(c.label).replace(/"/g, '""')}"`).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = r?.[c.key];
        const s = v === null || v === undefined ? "" : String(v);
        return `"${s.replace(/"/g, '""')}"`
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function heatColorForBreaches(breaches) {
  // 0 => transparent-ish, higher => more red
  const b = Math.max(0, Math.min(10, safeNum(breaches)));
  const alpha = b === 0 ? 0.05 : Math.min(0.85, 0.10 + b * 0.07);
  return `rgba(220, 38, 38, ${alpha})`; // red-ish
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Range selector
  const [rangeMode, setRangeMode] = useState("30d"); // "latest" | "7d" | "30d"
  const [selectedEmployee, setSelectedEmployee] = useState("");

  /* ------------------------------
     LOAD DATA (daily_first_responder_metrics)
  ------------------------------- */
  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError("");

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
        setLoadError(error.message || "Failed to load data.");
        setRows([]);
      } else {
        setRows(data || []);
      }

      setLoading(false);
    }

    load();
  }, []);

  /* ------------------------------
     DERIVED: latest available date
  ------------------------------- */
  const latestDate = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    // Because we ordered date desc, first row is latest date
    return rows[0]?.date || null;
  }, [rows]);

  /* ------------------------------
     DERIVED: range dates and filtered rows
  ------------------------------- */
  const { startDate, endDate, rangeLabel, rangeDays } = useMemo(() => {
    if (!latestDate) {
      return {
        startDate: null,
        endDate: null,
        rangeLabel: "",
        rangeDays: 0,
      };
    }

    if (rangeMode === "latest") {
      return {
        startDate: latestDate,
        endDate: latestDate,
        rangeLabel: `Latest day (${latestDate})`,
        rangeDays: 1,
      };
    }

    const days = rangeMode === "7d" ? 7 : 30;
    const start = addDaysUtc(latestDate, -(days - 1));
    return {
      startDate: start,
      endDate: latestDate,
      rangeLabel: `Last ${days} days (ending ${latestDate})`,
      rangeDays: days,
    };
  }, [latestDate, rangeMode]);

  const rangeRows = useMemo(() => {
    if (!startDate || !endDate) return [];
    // Inclusive range
    return (rows || []).filter((r) => r.date >= startDate && r.date <= endDate);
  }, [rows, startDate, endDate]);

  /* ------------------------------
     DERIVED: employee list (from range)
  ------------------------------- */
  const employees = useMemo(() => {
    const set = new Set();
    for (const r of rangeRows) {
      if (r?.employee_email) set.add(r.employee_email);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rangeRows]);

  // Auto-set selected employee if empty
  useEffect(() => {
    if (!selectedEmployee && employees.length > 0) {
      setSelectedEmployee(employees[0]);
    }
  }, [employees, selectedEmployee]);

  /* ------------------------------
     TEAM ROLLUPS (over selected range)
  ------------------------------- */
  const teamTotals = useMemo(() => {
    const totalResponses = rangeRows.reduce(
      (sum, r) => sum + safeNum(r.total_first_responses),
      0
    );

    const totalBreaches = rangeRows.reduce(
      (sum, r) => sum + safeNum(r.sla_breaches),
      0
    );

    // Weighted avg response minutes by number of responses
    let weightedTotal = 0;
    let weightedCount = 0;
    for (const r of rangeRows) {
      const n = safeNum(r.total_first_responses);
      const avg = typeof r.avg_first_response_minutes === "number" ? r.avg_first_response_minutes : null;
      if (avg !== null && n > 0) {
        weightedTotal += avg * n;
        weightedCount += n;
      }
    }
    const weightedAvgMinutes =
      weightedCount > 0 ? Math.round((weightedTotal / weightedCount) * 10) / 10 : "—";

    const slaPercent =
      totalResponses > 0
        ? Math.round(((totalResponses - totalBreaches) / totalResponses) * 100)
        : "—";

    return { totalResponses, totalBreaches, weightedAvgMinutes, slaPercent };
  }, [rangeRows]);

  /* ------------------------------
     EMPLOYEE SUMMARY (cumulative over range)
  ------------------------------- */
  const employeeSummary = useMemo(() => {
    const acc = {};
    for (const r of rangeRows) {
      const e = r.employee_email || "unknown";
      if (!acc[e]) {
        acc[e] = {
          employee_email: e,
          total_first_responses: 0,
          sla_breaches: 0,
          weighted_minutes: 0,
          weighted_count: 0,
        };
      }

      const n = safeNum(r.total_first_responses);
      acc[e].total_first_responses += n;
      acc[e].sla_breaches += safeNum(r.sla_breaches);

      if (typeof r.avg_first_response_minutes === "number" && n > 0) {
        acc[e].weighted_minutes += r.avg_first_response_minutes * n;
        acc[e].weighted_count += n;
      }
    }

    const out = Object.values(acc).map((x) => {
      const avg_response =
        x.weighted_count > 0 ? Math.round((x.weighted_minutes / x.weighted_count) * 10) / 10 : "—";

      const sla_percent =
        x.total_first_responses > 0
          ? Math.round(((x.total_first_responses - x.sla_breaches) / x.total_first_responses) * 100)
          : "—";

      return {
        employee_email: x.employee_email,
        total_first_responses: x.total_first_responses,
        avg_response,
        sla_breaches: x.sla_breaches,
        sla_percent,
      };
    });

    // Sort by responses desc, then email
    out.sort((a, b) => {
      const da = safeNum(b.total_first_responses) - safeNum(a.total_first_responses);
      if (da !== 0) return da;
      return String(a.employee_email).localeCompare(String(b.employee_email));
    });

    return out;
  }, [rangeRows]);

  /* ------------------------------
     DAILY TEAM SERIES (for chart)
  ------------------------------- */
  const dailyTeamSeries = useMemo(() => {
    if (!startDate || !endDate) return [];

    // Build date list
    const dates = [];
    for (let i = 0; i < rangeDays; i++) {
      dates.push(addDaysUtc(startDate, i));
    }

    const map = {};
    for (const d of dates) {
      map[d] = {
        date: d,
        total_first_responses: 0,
        sla_breaches: 0,
        weighted_minutes: 0,
        weighted_count: 0,
      };
    }

    for (const r of rangeRows) {
      if (!map[r.date]) continue;
      const n = safeNum(r.total_first_responses);
      map[r.date].total_first_responses += n;
      map[r.date].sla_breaches += safeNum(r.sla_breaches);

      if (typeof r.avg_first_response_minutes === "number" && n > 0) {
        map[r.date].weighted_minutes += r.avg_first_response_minutes * n;
        map[r.date].weighted_count += n;
      }
    }

    const out = dates.map((d) => {
      const row = map[d];
      const avg =
        row.weighted_count > 0 ? Math.round((row.weighted_minutes / row.weighted_count) * 10) / 10 : null;
      const sla_percent =
        row.total_first_responses > 0
          ? Math.round(((row.total_first_responses - row.sla_breaches) / row.total_first_responses) * 100)
          : null;
      return {
        date: d,
        total_first_responses: row.total_first_responses,
        sla_breaches: row.sla_breaches,
        avg_first_response_minutes: avg,
        sla_percent,
      };
    });

    return out;
  }, [rangeRows, startDate, endDate, rangeDays]);

  /* ------------------------------
     PER-EMPLOYEE TREND (selectedEmployee)
  ------------------------------- */
  const employeeTrend = useMemo(() => {
    if (!selectedEmployee || !startDate || !endDate) return [];
    // Build date list for continuity
    const dates = [];
    for (let i = 0; i < rangeDays; i++) {
      dates.push(addDaysUtc(startDate, i));
    }

    const map = {};
    for (const d of dates) {
      map[d] = {
        date: d,
        total_first_responses: 0,
        sla_breaches: 0,
        avg_first_response_minutes: null,
      };
    }

    // For an individual employee, daily table row is already "one row per day per employee"
    // but we’ll still accumulate safely.
    let weightedMinutes = {};
    let weightedCount = {};
    for (const d of dates) {
      weightedMinutes[d] = 0;
      weightedCount[d] = 0;
    }

    for (const r of rangeRows) {
      if (r.employee_email !== selectedEmployee) continue;
      if (!map[r.date]) continue;

      const n = safeNum(r.total_first_responses);
      map[r.date].total_first_responses += n;
      map[r.date].sla_breaches += safeNum(r.sla_breaches);

      if (typeof r.avg_first_response_minutes === "number" && n > 0) {
        weightedMinutes[r.date] += r.avg_first_response_minutes * n;
        weightedCount[r.date] += n;
      }
    }

    return dates.map((d) => {
      const avg =
        weightedCount[d] > 0 ? Math.round((weightedMinutes[d] / weightedCount[d]) * 10) / 10 : null;
      return {
        date: d,
        total_first_responses: map[d].total_first_responses,
        sla_breaches: map[d].sla_breaches,
        avg_first_response_minutes: avg,
      };
    });
  }, [rangeRows, selectedEmployee, startDate, endDate, rangeDays]);

  /* ------------------------------
     SLA BREACH HEATMAP MATRIX
     rows: employees, cols: dates, values: breaches count
  ------------------------------- */
  const heatmap = useMemo(() => {
    if (!startDate || !endDate) return { dates: [], employees: [], matrix: {} };

    const dates = [];
    for (let i = 0; i < rangeDays; i++) dates.push(addDaysUtc(startDate, i));

    const emps = employees;

    const matrix = {};
    for (const e of emps) {
      matrix[e] = {};
      for (const d of dates) matrix[e][d] = 0;
    }

    for (const r of rangeRows) {
      const e = r.employee_email;
      const d = r.date;
      if (!e || !matrix[e] || matrix[e][d] === undefined) continue;
      matrix[e][d] += safeNum(r.sla_breaches);
    }

    return { dates, employees: emps, matrix };
  }, [rangeRows, employees, startDate, endDate, rangeDays]);

  /* ------------------------------
     EXPORTS
  ------------------------------- */
  function exportRawRowsCsv() {
    const csv = toCsv(rangeRows, [
      { key: "date", label: "date" },
      { key: "employee_email", label: "employee_email" },
      { key: "total_first_responses", label: "total_first_responses" },
      { key: "avg_first_response_minutes", label: "avg_first_response_minutes" },
      { key: "sla_breaches", label: "sla_breaches" },
    ]);
    downloadTextFile(`first_responder_raw_${startDate}_to_${endDate}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportEmployeeSummaryCsv() {
    const csv = toCsv(employeeSummary, [
      { key: "employee_email", label: "employee_email" },
      { key: "total_first_responses", label: "total_first_responses" },
      { key: "avg_response", label: "avg_response_minutes" },
      { key: "sla_breaches", label: "sla_breaches" },
      { key: "sla_percent", label: "sla_percent" },
    ]);
    downloadTextFile(`employee_summary_${startDate}_to_${endDate}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportEmployeeTrendCsv() {
    if (!selectedEmployee) return;
    const csv = toCsv(employeeTrend, [
      { key: "date", label: "date" },
      { key: "total_first_responses", label: "total_first_responses" },
      { key: "avg_first_response_minutes", label: "avg_first_response_minutes" },
      { key: "sla_breaches", label: "sla_breaches" },
    ]);
    downloadTextFile(
      `employee_trend_${selectedEmployee}_${startDate}_to_${endDate}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  }

  function exportHeatmapCsv() {
    // Flatten: date, employee_email, sla_breaches
    const flat = [];
    for (const e of heatmap.employees) {
      for (const d of heatmap.dates) {
        flat.push({
          date: d,
          employee_email: e,
          sla_breaches: heatmap.matrix[e]?.[d] ?? 0,
        });
      }
    }
    const csv = toCsv(flat, [
      { key: "date", label: "date" },
      { key: "employee_email", label: "employee_email" },
      { key: "sla_breaches", label: "sla_breaches" },
    ]);
    downloadTextFile(`sla_heatmap_${startDate}_to_${endDate}.csv`, csv, "text/csv;charset=utf-8");
  }

  /* ------------------------------
     UI
  ------------------------------- */
  if (loading) return <p className="loading">Loading team metrics…</p>;

  if (loadError) {
    return (
      <div className="container">
        <h1>Solvit Email Response Dashboard</h1>
        <p className="loading" style={{ color: "#b91c1c" }}>
          Failed to load: {loadError}
        </p>
        <p className="loading">
          Check Supabase URL / key env vars and table permissions for <strong>daily_first_responder_metrics</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <div className="toolbar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div className="toolbar-group" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 600 }}>Range</span>
          <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}>
            <option value="latest">Latest day</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>

        <div className="toolbar-group" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 600 }}>Employee</span>
          <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)}>
            {employees.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group" style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={exportRawRowsCsv}>Export raw (CSV)</button>
          <button onClick={exportEmployeeSummaryCsv}>Export summary (CSV)</button>
          <button onClick={exportEmployeeTrendCsv} disabled={!selectedEmployee}>
            Export trend (CSV)
          </button>
          <button onClick={exportHeatmapCsv}>Export heatmap (CSV)</button>
        </div>
      </div>

      <p className="subtitle" style={{ marginTop: 8 }}>
        Showing: <strong>{rangeLabel || "—"}</strong>
      </p>

      {/* KPI CARDS */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Team First Responses</h3>
          <p>{teamTotals.totalResponses}</p>
        </div>

        <div className="kpi-card">
          <h3>Team Avg Response</h3>
          <p>
            {teamTotals.weightedAvgMinutes}
            {teamTotals.weightedAvgMinutes === "—" ? "" : " min"}
          </p>
        </div>

        <div className="kpi-card">
          <h3>Team SLA %</h3>
          <p>{teamTotals.slaPercent}%</p>
        </div>
      </section>

      {/* TEAM DAILY TRENDS */}
      <section>
        <h2>Team Trends (Daily)</h2>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={dailyTeamSeries}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total_first_responses" name="First Responses" dot={false} />
            <Line type="monotone" dataKey="sla_breaches" name="SLA Breaches" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* TEAM LOAD DISTRIBUTION (cumulative over range) */}
      <section>
        <h2>Team Load Distribution (Cumulative)</h2>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={employeeSummary}>
            <XAxis dataKey="employee_email" interval={0} angle={-15} textAnchor="end" height={80} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total_first_responses" name="First Responses" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* EMPLOYEE TREND */}
      <section>
        <h2>Employee Trend: {selectedEmployee || "—"}</h2>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={employeeTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total_first_responses" name="First Responses" dot={false} />
            <Line type="monotone" dataKey="sla_breaches" name="SLA Breaches" dot={false} />
            <Line type="monotone" dataKey="avg_first_response_minutes" name="Avg Response (min)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* SLA BREACH HEATMAP */}
      <section>
        <h2>SLA Breach Heatmap</h2>
        <div style={{ overflowX: "auto", borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", minWidth: 900, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>
                  Employee
                </th>
                {heatmap.dates.map((d) => (
                  <th key={d} style={{ padding: 6, fontSize: 12, whiteSpace: "nowrap" }}>
                    {d.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.employees.map((e) => (
                <tr key={e}>
                  <td
                    style={{
                      padding: 8,
                      position: "sticky",
                      left: 0,
                      background: "#fff",
                      zIndex: 1,
                      whiteSpace: "nowrap",
                      maxWidth: 240,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={e}
                  >
                    {e}
                  </td>
                  {heatmap.dates.map((d) => {
                    const breaches = heatmap.matrix[e]?.[d] ?? 0;
                    return (
                      <td
                        key={`${e}_${d}`}
                        title={`${e} • ${d} • breaches: ${breaches}`}
                        style={{
                          padding: 0,
                          width: 28,
                          height: 26,
                          background: heatColorForBreaches(breaches),
                          border: "1px solid rgba(0,0,0,0.06)",
                          textAlign: "center",
                          fontSize: 12,
                        }}
                      >
                        {breaches ? breaches : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {heatmap.employees.length === 0 && (
                <tr>
                  <td colSpan={heatmap.dates.length + 1} style={{ padding: 12 }}>
                    No responders in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* EMPLOYEE SLA TABLE (cumulative over range) */}
      <section>
        <h2>Team SLA Performance (Cumulative)</h2>
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
            {employeeSummary.map((emp) => (
              <tr key={emp.employee_email}>
                <td>{emp.employee_email}</td>
                <td>{emp.total_first_responses}</td>
                <td>{emp.avg_response}</td>
                <td>{emp.sla_breaches}</td>
                <td>{emp.sla_percent}%</td>
              </tr>
            ))}
            {employeeSummary.length === 0 && (
              <tr>
                <td colSpan={5}>No responder rows for this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Small note for "latest data" expectations */}
      <section style={{ marginTop: 18 }}>
        <p className="subtitle">
          Note: “Latest” here means the <strong>latest date present</strong> inside{" "}
          <strong>daily_first_responder_metrics</strong>. If recent days show zero responders in{" "}
          <strong>tracked_emails</strong>, aggregation will correctly produce no rows for those dates.
        </p>
      </section>
    </div>
  );
}

export default App;

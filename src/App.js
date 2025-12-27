import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import "./App.css";

/**
 * Dashboard (Safe)
 * - Reads from: daily_first_responder_metrics (no secrets in browser)
 * - Range-based rollups + charts + exports
 */

function toISODate(d) {
  // returns YYYY-MM-DD in local time
  const dt = new Date(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return toISODate(dt);
}

function dateRangeInclusive(startISO, endISO) {
  const out = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
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

function toCSV(rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\n");
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Time range selector
  const [preset, setPreset] = useState("30"); // 7,14,30,60,custom
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const defaultEnd = todayISO;
  const defaultStart = addDays(todayISO, -29); // last 30 days inclusive
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // UI knobs (to avoid clutter)
  const [topN, setTopN] = useState(8); // employees shown in trend + heatmap

  // Apply preset to dates
  useEffect(() => {
    if (preset === "custom") return;

    const n = parseInt(preset, 10);
    if (!Number.isFinite(n) || n <= 0) return;

    const end = todayISO;
    const start = addDays(end, -(n - 1));
    setStartDate(start);
    setEndDate(end);
  }, [preset, todayISO]);

  // Load data for the selected range
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");

      // basic guard
      if (!startDate || !endDate || startDate > endDate) {
        setRows([]);
        setLoading(false);
        setLoadError("Invalid date range.");
        return;
      }

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
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("Supabase error:", error);
        setRows([]);
        setLoadError(error.message || "Failed to load data.");
      } else {
        setRows(data || []);
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  // Derived: latest date within range that actually has responder rows
  const latestResponderDate = useMemo(() => {
    if (!rows.length) return null;
    return rows[0].date; // rows ordered desc by date
  }, [rows]);

  // Rollups over the whole selected range (cumulative)
  const totals = useMemo(() => {
    const totalResponses = rows.reduce(
      (sum, r) => sum + (r.total_first_responses || 0),
      0
    );
    const totalBreaches = rows.reduce(
      (sum, r) => sum + (r.sla_breaches || 0),
      0
    );

    // weighted average by volume
    let wTotal = 0;
    let wCount = 0;
    for (const r of rows) {
      const avg = r.avg_first_response_minutes;
      const cnt = r.total_first_responses || 0;
      if (typeof avg === "number" && cnt > 0) {
        wTotal += avg * cnt;
        wCount += cnt;
      }
    }
    const avgMinutes = wCount > 0 ? Math.round((wTotal / wCount) * 10) / 10 : "—";

    const slaPercent =
      totalResponses > 0
        ? Math.round(((totalResponses - totalBreaches) / totalResponses) * 100)
        : "—";

    return {
      totalResponses,
      totalBreaches,
      avgMinutes,
      slaPercent,
    };
  }, [rows]);

  // Aggregate per employee over the selected range
  const perEmployee = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      const email = r.employee_email;
      if (!email) continue;
      if (!acc[email]) {
        acc[email] = {
          employee_email: email,
          total_first_responses: 0,
          sla_breaches: 0,
          weighted: 0,
        };
      }
      const cnt = r.total_first_responses || 0;
      const breaches = r.sla_breaches || 0;
      const avg = r.avg_first_response_minutes;

      acc[email].total_first_responses += cnt;
      acc[email].sla_breaches += breaches;
      if (typeof avg === "number" && cnt > 0) {
        acc[email].weighted += avg * cnt;
      }
    }

    const out = Object.values(acc).map((e) => {
      const avg_response =
        e.total_first_responses > 0
          ? Math.round((e.weighted / e.total_first_responses) * 10) / 10
          : "—";

      const sla_percent =
        e.total_first_responses > 0
          ? Math.round(
              ((e.total_first_responses - e.sla_breaches) /
                e.total_first_responses) *
                100
            )
          : "—";

      return {
        employee_email: e.employee_email,
        total_first_responses: e.total_first_responses,
        sla_breaches: e.sla_breaches,
        avg_response,
        sla_percent,
      };
    });

    // sort by volume desc
    out.sort((a, b) => (b.total_first_responses || 0) - (a.total_first_responses || 0));
    return out;
  }, [rows]);

  const topEmployees = useMemo(() => perEmployee.slice(0, topN), [perEmployee, topN]);

  // Build daily time series per employee (for trends + heatmap)
  const days = useMemo(() => {
    if (!startDate || !endDate || startDate > endDate) return [];
    return dateRangeInclusive(startDate, endDate);
  }, [startDate, endDate]);

  // Map: day -> employee -> {responses, breaches}
  const dayEmployeeMap = useMemo(() => {
    const map = {};
    for (const d of days) map[d] = {};
    for (const r of rows) {
      const d = r.date;
      const e = r.employee_email;
      if (!d || !e) continue;
      if (!map[d]) map[d] = {};
      map[d][e] = {
        responses: r.total_first_responses || 0,
        breaches: r.sla_breaches || 0,
      };
    }
    return map;
  }, [rows, days]);

  // Trend chart data: one row per day, with fields for each top employee
  const trendData = useMemo(() => {
    const topEmails = topEmployees.map((e) => e.employee_email);

    return days.map((d) => {
      const row = { date: d };
      for (const email of topEmails) {
        row[email] = (dayEmployeeMap[d]?.[email]?.responses || 0);
      }
      return row;
    });
  }, [days, dayEmployeeMap, topEmployees]);

  // Heatmap: top employees vs last up to 14 days (to keep it readable)
  const heatmapDays = useMemo(() => {
    const max = 14;
    if (days.length <= max) return days;
    return days.slice(days.length - max);
  }, [days]);

  const heatMax = useMemo(() => {
    let m = 0;
    for (const d of heatmapDays) {
      for (const e of topEmployees) {
        const v = dayEmployeeMap[d]?.[e.employee_email]?.breaches || 0;
        if (v > m) m = v;
      }
    }
    return m;
  }, [heatmapDays, topEmployees, dayEmployeeMap]);

  function heatStyle(v) {
    // Safe: inline style, no extra CSS needed
    // intensity 0..1, avoid full black
    const intensity = heatMax > 0 ? v / heatMax : 0;
    const bg = `rgba(220, 0, 0, ${Math.min(0.75, 0.08 + intensity * 0.67)})`;
    const fg = v > 0 ? "#fff" : "#111";
    return {
      background: v > 0 ? bg : "rgba(0,0,0,0.04)",
      color: fg,
      borderRadius: "8px",
      padding: "6px 8px",
      textAlign: "center",
      minWidth: "44px",
      fontWeight: 700,
    };
  }

  // Exports
  const exportRaw = () => {
    const csv = toCSV(
      rows.map((r) => ({
        date: r.date,
        employee_email: r.employee_email,
        total_first_responses: r.total_first_responses || 0,
        avg_first_response_minutes:
          typeof r.avg_first_response_minutes === "number" ? r.avg_first_response_minutes : "",
        sla_breaches: r.sla_breaches || 0,
      })),
      ["date", "employee_email", "total_first_responses", "avg_first_response_minutes", "sla_breaches"]
    );
    downloadText(`first_responder_raw_${startDate}_to_${endDate}.csv`, csv, "text/csv;charset=utf-8");
  };

  const exportEmployees = () => {
    const csv = toCSV(
      perEmployee.map((e) => ({
        employee_email: e.employee_email,
        total_first_responses: e.total_first_responses,
        avg_response: e.avg_response,
        sla_breaches: e.sla_breaches,
        sla_percent: e.sla_percent,
      })),
      ["employee_email", "total_first_responses", "avg_response", "sla_breaches", "sla_percent"]
    );
    downloadText(`first_responder_employee_summary_${startDate}_to_${endDate}.csv`, csv, "text/csv;charset=utf-8");
  };

  const exportHeatmap = () => {
    const topEmails = topEmployees.map((e) => e.employee_email);
    const out = heatmapDays.map((d) => {
      const row = { date: d };
      for (const email of topEmails) {
        row[email] = dayEmployeeMap[d]?.[email]?.breaches || 0;
      }
      return row;
    });
    const csv = toCSV(out, ["date", ...topEmails]);
    downloadText(`sla_breach_heatmap_${heatmapDays[0]}_to_${heatmapDays[heatmapDays.length - 1]}.csv`, csv, "text/csv;charset=utf-8");
  };

  if (loading) return <p className="loading">Loading team metrics…</p>;

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <div style={{ marginTop: 8, marginBottom: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Range
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {preset === "custom" && (
            <>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                Start
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                End
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </>
          )}

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Top employees
            <select value={topN} onChange={(e) => setTopN(parseInt(e.target.value, 10))}>
              <option value={5}>Top 5</option>
              <option value={8}>Top 8</option>
              <option value={12}>Top 12</option>
            </select>
          </label>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" onClick={exportRaw}>Export Raw</button>
            <button className="btn" onClick={exportEmployees}>Export Employee Summary</button>
            <button className="btn" onClick={exportHeatmap}>Export Heatmap</button>
          </div>
        </div>

        <div style={{ marginTop: 8, opacity: 0.9 }}>
          {latestResponderDate ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Selected range: <strong>{startDate}</strong> to <strong>{endDate}</strong>. Latest responder date in range:{" "}
              <strong>{latestResponderDate}</strong>
            </p>
          ) : (
            <p className="subtitle" style={{ margin: 0 }}>
              Selected range: <strong>{startDate}</strong> to <strong>{endDate}</strong>. No responder rows found in this range.
            </p>
          )}
          {loadError ? (
            <p style={{ marginTop: 8, color: "#b00020", fontWeight: 700 }}>{loadError}</p>
          ) : null}
        </div>
      </div>

      {/* KPI CARDS (CUMULATIVE OVER RANGE) */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Team First Responses</h3>
          <p>{totals.totalResponses}</p>
        </div>

        <div className="kpi-card">
          <h3>Team Avg Response</h3>
          <p>{totals.avgMinutes} min</p>
        </div>

        <div className="kpi-card">
          <h3>Team SLA %</h3>
          <p>{totals.slaPercent}%</p>
        </div>
      </section>

      {/* TEAM LOAD (CUMULATIVE PER EMPLOYEE) */}
      <section>
        <h2>Team Load Distribution (Cumulative)</h2>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={perEmployee.slice(0, 20)}>
            <XAxis dataKey="employee_email" hide={false} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total_first_responses" name="First Responses" />
          </BarChart>
        </ResponsiveContainer>
        <p style={{ marginTop: 6, opacity: 0.8 }}>
          Showing top 20 employees by volume for readability.
        </p>
      </section>

      {/* EMPLOYEE TRENDS */}
      <section style={{ marginTop: 26 }}>
        <h2>Employee Trends (Daily First Responses)</h2>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {topEmployees.map((e) => (
              <Line
                key={e.employee_email}
                type="monotone"
                dataKey={e.employee_email}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p style={{ marginTop: 6, opacity: 0.8 }}>
          Trend lines show top {topN} employees by total volume in the selected range.
        </p>
      </section>

      {/* SLA BREACH HEATMAP */}
      <section style={{ marginTop: 26 }}>
        <h2>SLA Breach Heatmap (Last {heatmapDays.length} Days)</h2>
        {topEmployees.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No employees found in range.</p>
        ) : (
          <div style={{ overflowX: "auto", paddingBottom: 6 }}>
            <table style={{ borderCollapse: "separate", borderSpacing: "8px 8px" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", minWidth: 220 }}>Employee</th>
                  {heatmapDays.map((d) => (
                    <th key={d} style={{ textAlign: "center", minWidth: 54 }}>{d.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topEmployees.map((e) => (
                  <tr key={e.employee_email}>
                    <td style={{ fontWeight: 700 }}>{e.employee_email}</td>
                    {heatmapDays.map((d) => {
                      const v = dayEmployeeMap[d]?.[e.employee_email]?.breaches || 0;
                      return (
                        <td key={`${e.employee_email}-${d}`}>
                          <div style={heatStyle(v)} title={`${d} breaches: ${v}`}>
                            {v}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: 6, opacity: 0.8 }}>
          Heatmap shows SLA breaches (count). Limited to top {topN} employees for readability.
        </p>
      </section>

      {/* TEAM TABLE */}
      <section style={{ marginTop: 26 }}>
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

      {/* CRONJOB.ORG CONFIG (INFO) */}
      <section style={{ marginTop: 26 }}>
        <h2>cronjob.org (Daily Metrics Job)</h2>
        <p style={{ marginTop: 6, opacity: 0.9 }}>
          Use this endpoint:
          <br />
          <strong>URL:</strong> https://email-tracker-matcher.vercel.app/api/aggregate-first-responders
          <br />
          <strong>Method:</strong> GET
          <br />
          <strong>Header:</strong> Authorization = <strong>Bearer &lt;CRON_SECRET&gt;</strong>
          <br />
          <strong>Timezone:</strong> Africa/Nairobi
          <br />
          <strong>Schedule:</strong> once daily (example 00:10)
        </p>
        <p style={{ marginTop: 6, opacity: 0.9 }}>
          If cronjob.org “Test run” shows 401, it almost always means the header value is missing the <strong>Bearer</strong> prefix.
        </p>
      </section>
    </div>
  );
}

export default App;

import { useEffect, useState } from "react";
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
  Line
} from "recharts";
import "./App.css";

function App() {
  const [teamMetrics, setTeamMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

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
      } else {
        setTeamMetrics(data || []);
      }

      setLoading(false);
    }

    loadMetrics();
  }, []);

  if (loading) {
    return <p className="loading">Loading team metrics…</p>;
  }

  /* ------------------------------
     USE LATEST AVAILABLE DATE
  ------------------------------- */
  const latestDate =
    teamMetrics.length > 0 ? teamMetrics[0].date : null;

  const latestMetrics = latestDate
    ? teamMetrics.filter(r => r.date === latestDate)
    : [];

  /* ------------------------------
     TEAM ROLLUPS (LATEST DATE)
  ------------------------------- */
  const totalResponses = latestMetrics.reduce(
    (sum, r) => sum + (r.total_first_responses || 0),
    0
  );

  const totalBreaches = latestMetrics.reduce(
    (sum, r) => sum + (r.sla_breaches || 0),
    0
  );

  const avgResponse = (() => {
    let total = 0;
    let count = 0;

    for (const r of latestMetrics) {
      if (
        typeof r.avg_first_response_minutes === "number" &&
        r.total_first_responses > 0
      ) {
        total +=
          r.avg_first_response_minutes * r.total_first_responses;
        count += r.total_first_responses;
      }
    }

    return count > 0 ? Math.round((total / count) * 10) / 10 : "—";
  })();

  const slaPercent =
    totalResponses > 0
      ? Math.round(
          ((totalResponses - totalBreaches) / totalResponses) * 100
        )
      : "—";

  /* ------------------------------
     AGGREGATE PER EMPLOYEE
  ------------------------------- */
  const perEmployee = Object.values(
    latestMetrics.reduce((acc, row) => {
      if (!acc[row.employee_email]) {
        acc[row.employee_email] = {
          employee_email: row.employee_email,
          total_first_responses: 0,
          sla_breaches: 0,
          weighted: 0
        };
      }

      acc[row.employee_email].total_first_responses +=
        row.total_first_responses || 0;

      acc[row.employee_email].sla_breaches +=
        row.sla_breaches || 0;

      acc[row.employee_email].weighted +=
        (row.avg_first_response_minutes || 0) *
        (row.total_first_responses || 0);

      return acc;
    }, {})
  ).map(emp => ({
    ...emp,
    avg_response:
      emp.total_first_responses > 0
        ? Math.round(
            (emp.weighted / emp.total_first_responses) * 10
          ) / 10
        : "—",
    sla_percent:
      emp.total_first_responses > 0
        ? Math.round(
            ((emp.total_first_responses - emp.sla_breaches) /
              emp.total_first_responses) *
              100
          )
        : "—"
  }));

  /* ------------------------------
     DAILY TREND (LAST 30 DATES)
  ------------------------------- */
  const dailyTrend = Object.values(
    teamMetrics.reduce((acc, r) => {
      if (!acc[r.date]) {
        acc[r.date] = { date: r.date, total: 0 };
      }
      acc[r.date].total += r.total_first_responses || 0;
      return acc;
    }, {})
  )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  /* ------------------------------
     EXPORT CSV
  ------------------------------- */
  function exportCSV(rows) {
    if (!rows.length) return;

    const header = Object.keys(rows[0]).join(",");
    const csv = [
      header,
      ...rows.map(r => Object.values(r).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `first-responders-${latestDate}.csv`;
    a.click();
  }

  /* ------------------------------
     RENDER
  ------------------------------- */
  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      {latestDate && (
        <p className="subtitle">
          Showing latest available responder data:{" "}
          <strong>{latestDate}</strong>
        </p>
      )}

      {/* KPI CARDS */}
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

      {/* LOAD DISTRIBUTION */}
      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={perEmployee}>
            <XAxis dataKey="employee_email" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="total_first_responses"
              name="First Responses"
            />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* DAILY TREND */}
      <section>
        <h2>Daily First Responses (Last 30)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dailyTrend}>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="total"
              name="First Responses"
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* SLA TABLE */}
      <section>
        <h2>Team SLA Performance</h2>

        <button
          className="export-btn"
          onClick={() => exportCSV(latestMetrics)}
        >
          Export Latest Data
        </button>

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
            {perEmployee.map(emp => (
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
    </div>
  );
}

export default App;

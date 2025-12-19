import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import "./App.css";

function App() {
  const [teamMetrics, setTeamMetrics] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(true);

  /* ------------------------------
     Load Team First Responder Data
  ------------------------------- */
  useEffect(() => {
    async function loadTeamMetrics() {
      const { data, error } = await supabase
        .from("daily_first_responder_metrics")
        .select("*")
        .order("date", { ascending: false });

      if (!error) {
        setTeamMetrics(data || []);
      }

      setLoadingTeam(false);
    }

    loadTeamMetrics();
  }, []);

  if (loadingTeam) {
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
  const totalTeamResponses = latestMetrics.reduce(
    (sum, r) => sum + (r.total_first_responses || 0),
    0
  );

  const totalTeamBreaches = latestMetrics.reduce(
    (sum, r) => sum + (r.sla_breaches || 0),
    0
  );

  const weightedAvgResponse = (() => {
    const weighted = latestMetrics.reduce(
      (acc, r) => {
        acc.total +=
          (r.avg_first_response_minutes || 0) *
          (r.total_first_responses || 0);
        acc.count += r.total_first_responses || 0;
        return acc;
      },
      { total: 0, count: 0 }
    );

    if (weighted.count === 0) return "—";
    return Math.round((weighted.total / weighted.count) * 10) / 10;
  })();

  const teamSlaPercent =
    totalTeamResponses > 0
      ? Math.round(
          ((totalTeamResponses - totalTeamBreaches) /
            totalTeamResponses) *
            100
        )
      : "—";

  /* ------------------------------
     AGGREGATE PER EMPLOYEE
  ------------------------------- */
  const byEmployee = Object.values(
    latestMetrics.reduce((acc, row) => {
      if (!acc[row.employee_email]) {
        acc[row.employee_email] = {
          employee_email: row.employee_email,
          total_first_responses: 0,
          sla_breaches: 0,
          weighted_response: 0
        };
      }

      acc[row.employee_email].total_first_responses +=
        row.total_first_responses || 0;
      acc[row.employee_email].sla_breaches +=
        row.sla_breaches || 0;
      acc[row.employee_email].weighted_response +=
        (row.avg_first_response_minutes || 0) *
        (row.total_first_responses || 0);

      return acc;
    }, {})
  ).map(emp => ({
    ...emp,
    avg_response:
      emp.total_first_responses > 0
        ? Math.round(
            (emp.weighted_response / emp.total_first_responses) * 10
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
     RENDER
  ------------------------------- */
  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>
      {latestDate && (
        <p className="subtitle">
          Showing latest available data: <strong>{latestDate}</strong>
        </p>
      )}

      {/* KPI CARDS */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Team First Responses</h3>
          <p>{totalTeamResponses}</p>
        </div>

        <div className="kpi-card">
          <h3>Team Avg Response</h3>
          <p>{weightedAvgResponse} min</p>
        </div>

        <div className="kpi-card">
          <h3>Team SLA %</h3>
          <p>{teamSlaPercent}%</p>
        </div>
      </section>

      {/* LOAD DISTRIBUTION */}
      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byEmployee}>
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

      {/* SLA TABLE */}
      <section>
        <h2>Team SLA Performance</h2>
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
            {byEmployee.map(emp => (
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

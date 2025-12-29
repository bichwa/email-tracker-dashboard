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
  Line
} from "recharts";
import "./App.css";

/* ------------------------------
   Helpers
------------------------------- */
function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts)) / 60000);
}

function outlookLink(messageId) {
  if (!messageId) return null;
  return `https://outlook.office.com/mail/deeplink/read/${messageId}`;
}

function downloadCSV(rows, filename) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r =>
      headers.map(h => `"${r[h] ?? ""}"`).join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------
   App
------------------------------- */
function App() {
  const [employees, setEmployees] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [unanswered, setUnanswered] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  /* ------------------------------
     Load data
  ------------------------------- */
  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceISO = since.toISOString().slice(0, 10);

      const [
        { data: emp },
        { data: met },
        { data: unresp }
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("email, name, department")
          .eq("is_client_facing", true),

        supabase
          .from("daily_first_responder_metrics")
          .select("*")
          .gte("date", sinceISO),

        supabase
          .from("tracked_emails")
          .select(
            `
            id,
            subject,
            client_email,
            employee_email,
            received_at,
            message_id
          `
          )
          .eq("has_response", false)
          .order("received_at", { ascending: true })
          .limit(20)
      ]);

      setEmployees(emp || []);
      setMetrics(met || []);
      setUnanswered(unresp || []);
      setLoading(false);
    }

    load();
  }, [days]);

  /* ------------------------------
     Merge employees + metrics
  ------------------------------- */
  const byEmployee = useMemo(() => {
    return employees.map(emp => {
      const rows = metrics.filter(
        r => r.employee_email === emp.email
      );

      const total = rows.reduce(
        (s, r) => s + r.total_first_responses,
        0
      );

      const breaches = rows.reduce(
        (s, r) => s + r.sla_breaches,
        0
      );

      const avg =
        total > 0
          ? rows.reduce(
              (s, r) =>
                s +
                r.avg_first_response_minutes *
                  r.total_first_responses,
              0
            ) / total
          : null;

      return {
        employee_email: emp.email,
        name: emp.name,
        total_first_responses: total,
        avg_response: avg ? Math.round(avg) : "—",
        sla_breaches: breaches,
        sla_percent:
          total > 0
            ? Math.round(((total - breaches) / total) * 100)
            : "—"
      };
    });
  }, [employees, metrics]);

  /* ------------------------------
     Team KPIs
  ------------------------------- */
  const teamTotals = useMemo(() => {
    const total = byEmployee.reduce(
      (s, e) => s + e.total_first_responses,
      0
    );
    const breaches = byEmployee.reduce(
      (s, e) => s + e.sla_breaches,
      0
    );

    return {
      total,
      avg:
        total > 0
          ? Math.round(
              byEmployee.reduce(
                (s, e) =>
                  s +
                  (e.avg_response === "—"
                    ? 0
                    : e.avg_response *
                      e.total_first_responses),
                0
              ) / total
            )
          : "—",
      sla:
        total > 0
          ? Math.round(((total - breaches) / total) * 100)
          : "—"
    };
  }, [byEmployee]);

  /* ------------------------------
     Trend data
  ------------------------------- */
  const trendData = useMemo(() => {
    const map = {};
    metrics.forEach(r => {
      if (!map[r.date]) map[r.date] = { date: r.date };
      map[r.date][r.employee_email] =
        r.total_first_responses;
    });
    return Object.values(map).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [metrics]);

  if (loading) {
    return <p className="loading">Loading dashboard…</p>;
  }

  /* ------------------------------
     Render
  ------------------------------- */
  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      {/* UNANSWERED EMAILS */}
      <section className="unanswered">
        <h2>Unanswered Emails (Live)</h2>

        {unanswered.length === 0 ? (
          <p>🎉 All client emails have been responded to.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Subject</th>
                <th>Inbox</th>
                <th>Minutes Unanswered</th>
                <th>SLA Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {unanswered.map(e => {
                const mins = minutesSince(e.received_at);
                const breached = mins > 15;
                const link = outlookLink(e.message_id);

                return (
                  <tr
                    key={e.id}
                    className={breached ? "sla-breach" : ""}
                  >
                    <td>{e.client_email}</td>
                    <td>{e.subject || "(No subject)"}</td>
                    <td>{e.employee_email}</td>
                    <td>{mins}</td>
                    <td>
                      {breached
                        ? "🔴 Breached"
                        : "🟢 Within SLA"}
                    </td>
                    <td>
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in Outlook
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Controls */}
      <div className="controls">
        <label>
          Show last&nbsp;
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            {[7, 14, 30, 60].map(d => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() =>
            downloadCSV(
              byEmployee,
              `email-response-${days}days.csv`
            )
          }
        >
          Export CSV
        </button>
      </div>

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Team First Responses</h3>
          <p>{teamTotals.total}</p>
        </div>
        <div className="kpi-card">
          <h3>Team Avg Response</h3>
          <p>{teamTotals.avg} min</p>
        </div>
        <div className="kpi-card">
          <h3>Team SLA %</h3>
          <p>{teamTotals.sla}%</p>
        </div>
      </section>

      {/* Load Distribution */}
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

      {/* Employee Trends */}
      <section>
        <h2>Employee Trends</h2>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={trendData}>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {employees.map(emp => (
              <Line
                key={emp.email}
                type="monotone"
                dataKey={emp.email}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* SLA Heatmap */}
      <section>
        <h2>SLA Breach Heatmap</h2>
        <table className="heatmap">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Responses</th>
              <th>Breaches</th>
              <th>SLA %</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map(e => (
              <tr
                key={e.employee_email}
                className={
                  e.sla_percent !== "—" && e.sla_percent < 80
                    ? "bad"
                    : ""
                }
              >
                <td>{e.employee_email}</td>
                <td>{e.total_first_responses}</td>
                <td>{e.sla_breaches}</td>
                <td>{e.sla_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;

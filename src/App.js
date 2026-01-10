import { useEffect, useState, useMemo } from "react";
import { supabase } from "./supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import "./App.css";

function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}

function App() {
  const [days, setDays] = useState(30);
  const [unanswered, setUnanswered] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);

      const [
        { data: emp },
        { data: unresp },
        { data: daily }
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("email, name")
          .eq("is_client_facing", true),

        supabase
          .from("tracked_emails")
          .select("id, client_email, subject, employee_email, received_at, scenario")
          .eq("has_response", false)
          .gte("received_at", since.toISOString())
          .order("received_at", { ascending: false })
          .limit(100),

        supabase
          .from("daily_first_responder_metrics")
          .select("*")
          .gte("date", since.toISOString().slice(0, 10))
      ]);

      setEmployees(emp || []);
      setUnanswered(unresp || []);
      setMetrics(daily || []);
      setLoading(false);
    }

    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [days]);

  const teamTotals = useMemo(() => {
    const total = metrics.reduce((s, r) => s + r.total_first_responses, 0);
    const breaches = metrics.reduce((s, r) => s + r.sla_breaches, 0);

    return {
      total,
      avg:
        total > 0
          ? Math.round(
              metrics.reduce(
                (s, r) =>
                  s +
                  r.avg_first_response_minutes *
                    r.total_first_responses,
                0
              ) / total
            )
          : 0,
      sla: total > 0 ? Math.round(((total - breaches) / total) * 100) : 0
    };
  }, [metrics]);

  if (loading) {
    return <p className="loading">Loading dashboard…</p>;
  }

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <section>
        <h2>Unanswered Emails Live</h2>

        <label>
          Show last&nbsp;
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            {[7, 14, 30, 60].map(d => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </label>

        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Client</th>
              <th>Subject</th>
              <th>Inbox</th>
              <th>Minutes</th>
              <th>Scenario</th>
            </tr>
          </thead>
          <tbody>
            {unanswered.map(e => (
              <tr key={e.id}>
                <td>{new Date(e.received_at).toLocaleString()}</td>
                <td>{e.client_email}</td>
                <td>{e.subject || "(No subject)"}</td>
                <td>{e.employee_email || "Team"}</td>
                <td>{minutesSince(e.received_at)}</td>
                <td>{e.scenario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Total Responses</h3>
          <p>{teamTotals.total}</p>
        </div>
        <div className="kpi-card">
          <h3>Avg Response</h3>
          <p>{teamTotals.avg} min</p>
        </div>
        <div className="kpi-card">
          <h3>SLA %</h3>
          <p>{teamTotals.sla}%</p>
        </div>
      </section>

      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={metrics}>
            <XAxis dataKey="employee_email" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total_first_responses" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

export default App;

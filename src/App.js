import { useEffect, useMemo, useState } from "react";
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
  return Math.round(
    (Date.now() - new Date(ts).getTime()) / 60000
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data } = await supabase
        .from("tracked_emails")
        .select(`
          id,
          subject,
          client_email,
          employee_email,
          received_at,
          scenario,
          has_response
        `)
        .gte("received_at", since.toISOString())
        .order("received_at", { ascending: false });

      setRows(data || []);
      setLoading(false);
    }

    load();
  }, [days]);

  const unanswered = rows.filter(r => !r.has_response);

  const teamKPIs = useMemo(() => {
    const total = rows.length;
    const responded = rows.filter(r => r.has_response).length;

    const times = rows
      .filter(r => r.has_response && r.responded_at)
      .map(r =>
        Math.round(
          (new Date(r.responded_at) -
            new Date(r.received_at)) /
            60000
        )
      );

    const avg =
      times.length > 0
        ? Math.round(
            times.reduce((a, b) => a + b, 0) /
              times.length
          )
        : 0;

    const breaches = times.filter(t => t > 15).length;

    return {
      total,
      avg,
      sla:
        total > 0
          ? Math.round(
              ((total - breaches) / total) * 100
            )
          : 0
    };
  }, [rows]);

  const byEmployee = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      if (!r.employee_email) return;
      map[r.employee_email] =
        (map[r.employee_email] || 0) + 1;
    });
    return Object.entries(map).map(([k, v]) => ({
      name: k,
      total: v
    }));
  }, [rows]);

  if (loading) return <p>Loading…</p>;

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <section>
        <h2>Unanswered Emails Live</h2>

        <label>
          Show last&nbsp;
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            {[1, 7, 14, 30, 60].map(d => (
              <option key={d} value={d}>
                {d} days
              </option>
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
                <td>
                  {new Date(e.received_at).toLocaleString()}
                </td>
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

      <section className="kpis">
        <div>
          <h3>Total Emails</h3>
          <p>{teamKPIs.total}</p>
        </div>
        <div>
          <h3>Avg Response</h3>
          <p>{teamKPIs.avg} min</p>
        </div>
        <div>
          <h3>SLA %</h3>
          <p>{teamKPIs.sla}%</p>
        </div>
      </section>

      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byEmployee}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

export default App;

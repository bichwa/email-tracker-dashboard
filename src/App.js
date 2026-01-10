import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts";

function minutesSince(ts) {
  return Math.floor((Date.now() - new Date(ts)) / 60000);
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("live-tracked-emails")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracked_emails" },
        load
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [days]);

  async function load() {
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data } = await supabase
      .from("tracked_emails")
      .select(
        "received_at, client_email, subject, employee_email, scenario"
      )
      .eq("has_response", false)
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false });

    setRows(data || []);
    setLoading(false);
  }

  const kpis = {
    total: rows.length,
    avg:
      rows.length === 0
        ? 0
        : Math.round(
            rows.reduce(
              (s, r) => s + minutesSince(r.received_at),
              0
            ) / rows.length
          ),
    sla:
      rows.length === 0
        ? 0
        : Math.round(
            (rows.filter(
              r => minutesSince(r.received_at) <= 15
            ).length /
              rows.length) *
              100
          )
  };

  const loadByEmployee = {};
  rows.forEach(r => {
    if (!r.employee_email) return;
    loadByEmployee[r.employee_email] =
      (loadByEmployee[r.employee_email] || 0) + 1;
  });

  const chartData = Object.entries(loadByEmployee).map(
    ([email, count]) => ({
      email,
      count
    })
  );

  if (loading) return <p>Loading…</p>;

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

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

      <div className="kpis">
        <div>Total Emails {kpis.total}</div>
        <div>Avg Response {kpis.avg} min</div>
        <div>SLA % {kpis.sla}</div>
      </div>

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
          {rows.map(r => (
            <tr key={r.received_at + r.client_email}>
              <td>
                {new Date(r.received_at).toLocaleString()}
              </td>
              <td>{r.client_email}</td>
              <td>{r.subject || "(No subject)"}</td>
              <td>{r.employee_email || "team"}</td>
              <td>{minutesSince(r.received_at)}</td>
              <td>{r.scenario}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Team Load Distribution</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <XAxis dataKey="email" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

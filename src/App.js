import { useEffect, useMemo, useState } from "react";
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

function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts)) / 60000);
}

function outlookLink(id) {
  return id
    ? `https://outlook.office.com/mail/deeplink/read/${id}`
    : null;
}

export default function App() {
  const [employees, setEmployees] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [unanswered, setUnanswered] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceISO = since.toISOString();

      const empRes = await supabase
        .from("employees")
        .select("email, name")
        .eq("is_client_facing", true);

      const metRes = await supabase
        .from("tracked_emails")
        .select("employee_email, response_time_minutes, sla_breached")
        .gte("received_at", sinceISO)
        .eq("has_response", true);

      const unRes = await supabase
        .from("tracked_emails")
        .select("id, subject, client_email, employee_email, received_at, graph_message_id")
        .eq("has_response", false)
        .order("received_at", { ascending: true })
        .limit(100);

      setEmployees(empRes.data || []);
      setMetrics(metRes.data || []);
      setUnanswered(unRes.data || []);
      setLoading(false);
    }

    load();
  }, [days]);

  const byEmployee = useMemo(() => {
    return employees.map(e => {
      const rows = metrics.filter(m => m.employee_email === e.email);
      const total = rows.length;
      const breaches = rows.filter(r => r.sla_breached).length;
      const avg =
        total > 0
          ? Math.round(
              rows.reduce((s, r) => s + (r.response_time_minutes || 0), 0) /
                total
            )
          : 0;

      return {
        name: e.name,
        total,
        avg,
        sla: total > 0 ? Math.round(((total - breaches) / total) * 100) : 0
      };
    });
  }, [employees, metrics]);

  const teamTotals = useMemo(() => {
    const total = byEmployee.reduce((s, e) => s + e.total, 0);
    const breaches = byEmployee.reduce(
      (s, e) => s + (e.sla < 100 ? 1 : 0),
      0
    );
    const avg =
      total > 0
        ? Math.round(
            byEmployee.reduce((s, e) => s + e.avg * e.total, 0) / total
          )
        : 0;

    return {
      total,
      avg,
      sla: total > 0 ? Math.round(((total - breaches) / total) * 100) : 0
    };
  }, [byEmployee]);

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <section>
        <h2>Unanswered Emails Live</h2>
        {unanswered.length === 0 ? (
          <p>All client emails handled.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Subject</th>
                <th>Inbox</th>
                <th>Minutes</th>
                <th>SLA</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {unanswered.map(e => {
                const mins = minutesSince(e.received_at);
                const breached = mins > 15;
                return (
                  <tr key={e.id}>
                    <td>{e.client_email}</td>
                    <td>{e.subject || "(No subject)"}</td>
                    <td>{e.employee_email}</td>
                    <td>{mins}</td>
                    <td>{breached ? "Breached" : "OK"}</td>
                    <td>
                      {outlookLink(e.graph_message_id) && (
                        <a
                          href={outlookLink(e.graph_message_id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="controls">
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      <section className="kpis">
        <div>Team Responses {teamTotals.total}</div>
        <div>Avg Response {teamTotals.avg} min</div>
        <div>SLA {teamTotals.sla}%</div>
      </section>

      <section>
        <h2>Team Load</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byEmployee}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

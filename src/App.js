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

const SLA_MINUTES = 15;

function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts)) / 60000);
}

function outlookLink(id) {
  return id
    ? `https://outlook.office.com/mail/deeplink/read/${id}`
    : null;
}

function App() {
  const [employees, setEmployees] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [unanswered, setUnanswered] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceISO = since.toISOString();

      const [
        empRes,
        metRes,
        unRes
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("email,name")
          .eq("is_client_facing", true),

        supabase
          .from("daily_first_responder_metrics")
          .select("*")
          .gte("date", sinceISO.slice(0, 10)),

        supabase
          .from("tracked_emails")
          .select(`
            id,
            subject,
            client_email,
            employee_email,
            received_at,
            graph_message_id
          `)
          .eq("has_response", false)
          .gte("received_at", sinceISO)
          .order("received_at", { ascending: true })
      ]);

      setEmployees(empRes.data || []);
      setMetrics(metRes.data || []);
      setUnanswered(unRes.data || []);
      setLoading(false);
    }

    load();
  }, [days]);

  const byEmployee = useMemo(() => {
    return employees.map(e => {
      const rows = metrics.filter(
        r => r.employee_email === e.email
      );

      const total = rows.reduce(
        (s, r) => s + (r.total_first_responses || 0),
        0
      );

      const breaches = rows.reduce(
        (s, r) => s + (r.sla_breaches || 0),
        0
      );

      const avg =
        total > 0
          ? Math.round(
              rows.reduce(
                (s, r) =>
                  s +
                  (r.avg_first_response_minutes || 0) *
                    (r.total_first_responses || 0),
                0
              ) / total
            )
          : 0;

      return {
        name: e.name,
        email: e.email,
        total,
        breaches,
        avg,
        sla: total > 0
          ? Math.round(((total - breaches) / total) * 100)
          : 0
      };
    });
  }, [employees, metrics]);

  const teamTotals = useMemo(() => {
    const total = byEmployee.reduce(
      (s, e) => s + e.total,
      0
    );
    const breaches = byEmployee.reduce(
      (s, e) => s + e.breaches,
      0
    );

    return {
      total,
      avg: total > 0
        ? Math.round(
            byEmployee.reduce(
              (s, e) => s + e.avg * e.total,
              0
            ) / total
          )
        : 0,
      sla: total > 0
        ? Math.round(((total - breaches) / total) * 100)
        : 0
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
              return (
                <tr key={e.id}>
                  <td>{e.client_email}</td>
                  <td>{e.subject || "(No subject)"}</td>
                  <td>{e.employee_email}</td>
                  <td>{mins}</td>
                  <td>
                    {mins > SLA_MINUTES ? "Breached" : "OK"}
                  </td>
                  <td>
                    <a
                      href={outlookLink(e.graph_message_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

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

export default App;

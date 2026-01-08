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

/* helpers */
function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}

function outlookLink(graphMessageId) {
  if (!graphMessageId) return null;
  return `https://outlook.office.com/mail/deeplink/read/${graphMessageId}`;
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

function App() {
  const [employees, setEmployees] = useState([]);
  const [emails, setEmails] = useState([]);
  const [unanswered, setUnanswered] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - days);

      const sinceISO = since.toISOString();

      const [{ data: emp }, { data: mail }, { data: unresp }] =
        await Promise.all([
          supabase
            .from("employees")
            .select("email, name")
            .eq("is_client_facing", true),

          supabase
            .from("tracked_emails")
            .select(`
              id,
              received_at,
              response_time_minutes,
              sla_breached,
              first_responder_email,
              employee_email,
              has_response
            `)
            .gte("received_at", sinceISO),

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
            .order("received_at", { ascending: true })
            .limit(50)
        ]);

      setEmployees(emp || []);
      setEmails(mail || []);
      setUnanswered(unresp || []);
      setLoading(false);
    }

    load();
  }, [days]);

  /* LIVE KPI COMPUTATION */
  const byEmployee = useMemo(() => {
    return employees.map(emp => {
      const rows = emails.filter(
        e => e.first_responder_email === emp.email
      );

      const total = rows.length;
      const breaches = rows.filter(e => e.sla_breached).length;

      const avg =
        total > 0
          ? Math.round(
              rows.reduce(
                (s, r) => s + (r.response_time_minutes || 0),
                0
              ) / total
            )
          : null;

      return {
        employee_email: emp.email,
        name: emp.name,
        total_first_responses: total,
        avg_response: avg ?? "—",
        sla_breaches: breaches,
        sla_percent:
          total > 0
            ? Math.round(((total - breaches) / total) * 100)
            : "—"
      };
    });
  }, [employees, emails]);

  const teamTotals = useMemo(() => {
    const total = byEmployee.reduce(
      (s, e) => s + e.total_first_responses,
      0
    );
    const breaches = byEmployee.reduce(
      (s, e) => s + e.sla_breaches,
      0
    );

    const avg =
      total > 0
        ? Math.round(
            byEmployee.reduce(
              (s, e) =>
                s +
                (e.avg_response === "—"
                  ? 0
                  : e.avg_response * e.total_first_responses),
              0
            ) / total
          )
        : "—";

    const sla =
      total > 0
        ? Math.round(((total - breaches) / total) * 100)
        : "—";

    return { total, avg, sla };
  }, [byEmployee]);

  if (loading) {
    return <p className="loading">Loading…</p>;
  }

  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      <section className="unanswered">
        <h2>Unanswered Emails Live</h2>

        {unanswered.length === 0 ? (
          <p>All client emails have been responded to.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Subject</th>
                <th>Inbox</th>
                <th>Minutes Unanswered</th>
                <th>SLA</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {unanswered.map(e => {
                const mins = minutesSince(e.received_at);
                const breached = mins > 15;
                const link = outlookLink(e.graph_message_id);

                return (
                  <tr key={e.id}>
                    <td>{e.client_email}</td>
                    <td>{e.subject || "(No subject)"}</td>
                    <td>{e.employee_email}</td>
                    <td>{mins}</td>
                    <td>{breached ? "Breached" : "OK"}</td>
                    <td>
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer">
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
            downloadCSV(byEmployee, `email-response-${days}days.csv`)
          }
        >
          Export CSV
        </button>
      </div>

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

      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byEmployee}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total_first_responses" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

export default App;

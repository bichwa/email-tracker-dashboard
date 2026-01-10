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

function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts)) / 60000);
}

export default function App() {
  const [days, setDays] = useState(30);
  const [emails, setEmails] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [employees, setEmployees] = useState([]);

  /* -------------------------------------------
     LIVE EMAILS
  -------------------------------------------- */
  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - days);

    supabase
      .from("tracked_emails")
      .select("*")
      .gte("received_at", since.toISOString())
      .eq("has_response", false)
      .order("received_at", { ascending: false })
      .then(({ data }) => setEmails(data || []));

    const channel = supabase
      .channel("tracked_emails_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracked_emails" },
        payload => {
          setEmails(prev => {
            const filtered = prev.filter(e => e.id !== payload.new.id);
            return [payload.new, ...filtered];
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [days]);

  /* -------------------------------------------
     AGGREGATES
  -------------------------------------------- */
  useEffect(() => {
    supabase
      .from("daily_first_responder_metrics")
      .select("*")
      .gte("date", new Date(Date.now() - days * 86400000).toISOString())
      .then(({ data }) => setMetrics(data || []));

    supabase
      .from("employees")
      .select("email, name")
      .then(({ data }) => setEmployees(data || []));
  }, [days]);

  /* -------------------------------------------
     KPIs
  -------------------------------------------- */
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
                  r.avg_first_response_minutes * r.total_first_responses,
                0
              ) / total
            )
          : 0,
      sla: total > 0 ? Math.round(((total - breaches) / total) * 100) : 0
    };
  }, [metrics]);

  /* -------------------------------------------
     RENDER
  -------------------------------------------- */
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
            {emails.map(e => (
              <tr key={e.id}>
                <td>{new Date(e.received_at).toLocaleString()}</td>
                <td>{e.client_email}</td>
                <td>{e.subject || "(no subject)"}</td>
                <td>{e.employee_email}</td>
                <td>{minutesSince(e.received_at)}</td>
                <td>{e.scenario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="kpis">
        <div>Total Emails<br />{teamTotals.total}</div>
        <div>Avg Response<br />{teamTotals.avg} min</div>
        <div>SLA %<br />{teamTotals.sla}%</div>
      </section>

      <section>
        <h2>Team Load Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={metrics}>
            <XAxis dataKey="employee_email" />
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

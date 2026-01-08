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

const SLA_TARGET_MINUTES = 15;

function minutesBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 60000);
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
  const [dailyMetrics, setDailyMetrics] = useState([]);
  const [liveEmails, setLiveEmails] = useState([]);
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
        { data: emp },
        { data: daily },
        { data: live },
        { data: unresp }
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("email, name, department")
          .eq("is_client_facing", true),

        supabase
          .from("daily_first_responder_metrics")
          .select("*")
          .gte("date", sinceISO.slice(0, 10)),

        supabase
          .from("tracked_emails")
          .select(`
            id,
            employee_email,
            received_at,
            first_response_at,
            response_time_minutes,
            sla_breached
          `)
          .eq("is_incoming", true)
          .eq("has_response", true)
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
          .eq("is_incoming", true)
          .eq("has_response", false)
          .order("received_at", { ascending: true })
          .limit(50)
      ]);

      setEmployees(emp || []);
      setDailyMetrics(daily || []);
      setLiveEmails(live || []);
      setUnanswered(unresp || []);
      setLoading(false);
    }

    load();
  }, [days]);

  const liveByEmployee = useMemo(() => {
    const map = {};

    liveEmails.forEach(e => {
      if (!e.employee_email) return;

      if (!map[e.employee_email]) {
        map[e.employee_email] = {
          total: 0,
          breaches: 0,
          sumMinutes: 0
        };
      }

      const mins =
        typeof e.response_time_minutes === "number"
          ? e.response_time_minutes
          : minutesBetween(e.received_at, e.first_response_at);

      map[e.employee_email].total += 1;
      map[e.employee_email].sumMinutes += mins;

      if (mins > SLA_TARGET_MINUTES) {
        map[e.employee_email].breaches += 1;
      }
    });

    return map;
  }, [liveEmails]);

  const byEmployee = useMemo(() => {
    return employees.map(emp => {
      const stats = liveByEmployee[emp.email];

      if (!stats) {
        return {
          employee_email: emp.email,
          name: emp.name,
          total_first_responses: 0,
          avg_response: "—",
          sla_breaches: 0,
          sla_percent: "—"
        };
      }

      const avg = Math.round(stats.sumMinutes / stats.total);
      const sla = Math.round(
        ((stats.total - stats.breaches) / stats.total) * 100
      );

      return {
        employee_email: emp.email,
        name: emp.name,
        total_first_responses: stats.total,
        avg_response: avg,
        sla_breaches: stats.breaches,
        sla_percent: sla
      };
    });
  }, [employees, liveByEmployee]);

  const teamTotals = useMemo(() => {
    const total = byEmployee.reduce(
      (s, e) => s + e.total_first_responses,
      0
    );

    const breaches = byEmployee.reduce(
      (s, e) => s + (e.sla_breaches || 0),
      0
    );

    const weightedAvg =
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

    return { total, avg: weightedAvg, sla };
  }, [byEmployee]);

  const stackedByDate = useMemo(() => {
    const map = {};

    dailyMetrics.forEach(r => {
      if (!map[r.date]) map[r.date] = { date: r.date };
      map[r.date][r.employee_email] =
        (map[r.date][r.employee_email] || 0) +
        (r.total_first_responses || 0);
    });

    return Object.values(map).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [dailyMetrics]);

  if (loading) {
    return <p className="loading">Loading dashboard…</p>;
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
                const mins = minutesBetween(e.received_at, new Date());
                const breached = mins > SLA_TARGET_MINUTES;
                const link = outlookLink(e.graph_message_id);

                return (
                  <tr
                    key={e.id}
                    className={breached ? "sla-breach" : ""}
                  >
                    <td>{e.client_email}</td>
                    <td>{e.subject || "(No subject)"}</td>
                    <td>{e.employee_email}</td>
                    <td>{mins}</td>
                    <td>{breached ? "Breached" : "OK"}</td>
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

      <section>
        <h2>Daily First Responses</h2>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={stackedByDate}>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {employees.map(emp => (
              <Bar
                key={emp.email}
                dataKey={emp.email}
                stackId="responses"
                name={emp.name || emp.email}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

export default App;

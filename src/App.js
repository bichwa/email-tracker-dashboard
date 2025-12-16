import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";

function App() {
  // ---------------------------
  // State
  // ---------------------------
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  const [unrespondedEmails, setUnrespondedEmails] = useState([]);
  const [loadingUnresponded, setLoadingUnresponded] = useState(true);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // ---------------------------
  // Effects
  // ---------------------------
  useEffect(() => {
    async function loadMetrics() {
      const { data } = await supabase
        .from("daily_metrics")
        .select("*")
        .order("date", { ascending: false });

      setMetrics(data || []);
      setLoading(false);
    }

    loadMetrics();
  }, []);

  useEffect(() => {
    fetch("https://email-tracker-vercel.vercel.app/api/unresponded", {
      headers: {
        Authorization: "Bearer solvit_tracker_2024_secure_key_xyz789",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setUnrespondedEmails(data.items || []);
        setLoadingUnresponded(false);
      })
      .catch(() => {
        setLoadingUnresponded(false);
      });
  }, []);

  // ---------------------------
  // Early loading state
  // ---------------------------
  if (loading) {
    return <p className="loading">Loading dashboard…</p>;
  }

  // ---------------------------
  // Enrich metrics with SLA %
  // ---------------------------
  const enrichedMetrics = metrics.map((row) => {
    const responded = row.total_emails_responded || 0;
    const breaches = row.sla_breaches || 0;

    const slaPercent =
      responded > 0
        ? Math.round(((responded - breaches) / responded) * 100)
        : null;

    return { ...row, slaPercent };
  });

  // ---------------------------
  // Date filter
  // ---------------------------
  const filteredMetrics = enrichedMetrics.filter((row) => {
    if (startDate && row.date < startDate) return false;
    if (endDate && row.date > endDate) return false;
    return true;
  });

  // ---------------------------
  // KPI calculations
  // ---------------------------
  const totalReceived = filteredMetrics.reduce(
    (sum, r) => sum + (r.total_emails_received || 0),
    0
  );

  const totalResponded = filteredMetrics.reduce(
    (sum, r) => sum + (r.total_emails_responded || 0),
    0
  );

  const totalBreaches = filteredMetrics.reduce(
    (sum, r) => sum + (r.sla_breaches || 0),
    0
  );

  const overallSlaPercent =
    totalResponded > 0
      ? Math.round(((totalResponded - totalBreaches) / totalResponded) * 100)
      : "—";

  const avgResponseOverall = (() => {
    const valid = filteredMetrics
      .map((r) => r.avg_response_time_minutes)
      .filter((v) => v !== null);

    if (valid.length === 0) return "—";

    return (
      Math.round(
        (valid.reduce((a, b) => a + b, 0) / valid.length) * 10
      ) / 10
    );
  })();

  // ---------------------------
  // CSV export
  // ---------------------------
  function exportToCSV(rows) {
    if (!rows.length) return;

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((h) => `"${row[h] ?? ""}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "email_metrics.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <div className="container">
      <h1>Solvit Email Response Dashboard</h1>

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Total Received</h3>
          <p>{totalReceived}</p>
        </div>

        <div className="kpi-card">
          <h3>Total Responded</h3>
          <p>{totalResponded}</p>
        </div>

        <div className="kpi-card">
          <h3>Overall SLA %</h3>
          <p>{overallSlaPercent}%</p>
        </div>

        <div className="kpi-card">
          <h3>Avg Response</h3>
          <p>{avgResponseOverall} min</p>
        </div>
      </section>
      <section className="sla-legend">
  <h3>How to read this dashboard</h3>
  <ul>
    <li>
      <strong>Avg Response:</strong> Average minutes taken to send the first reply.
    </li>
    <li>
      <strong>SLA Breach:</strong> Response sent after the SLA target time.
    </li>
    <li>
      <strong>SLA %:</strong> Percentage of responses sent within SLA time.
    </li>
  </ul>
</section>


      {/* Filters */}
      <section>
        <h2>Filter by Date</h2>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </section>

      {/* Charts */}
      <section>
        <h2>Average Response Time Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={filteredMetrics}>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
  dataKey="avg_response_time_minutes"
  name="Avg Response (min)"
  stroke="#E30613"
  strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section>
        <h2>Emails Received vs Responded</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={filteredMetrics}>
            <XAxis dataKey="employee_email" hide />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total_emails_received" name="Received" fill="#0A2540" />
            <Bar dataKey="total_emails_responded" name="Responded" fill="#E11D2E"/>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Rankings */}
      <section>
        <h2>Top Responders</h2>
        <ul>
          {[...filteredMetrics]
            .filter((r) => r.avg_response_time_minutes !== null)
            .sort(
              (a, b) =>
                a.avg_response_time_minutes - b.avg_response_time_minutes
            )
            .slice(0, 5)
            .map((r) => (
              <li key={r.employee_email}>
                {r.employee_email} — {r.avg_response_time_minutes} min
              </li>
            ))}
        </ul>
      </section>

      {/* Unresponded emails */}
      <section>
        <h2 style={{ color: "#E30613" }}>
  🔴 Unresponded Emails (SLA &gt; 15 minutes)</h2>
        {loadingUnresponded ? (
          <p>Loading…</p>
        ) : (
          <ul>
            {unrespondedEmails.slice(0, 20).map((e) => (
              <li key={e.id}>
                <strong className="text-breach">{e.subject}</strong> — {e.from_email}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
  <h3>Unresponded Emails</h3>

  {loadingUnresponded ? (
    <p>Loading unresponded emails…</p>
  ) : unrespondedEmails.length === 0 ? (
    <p>All emails responded to 🎉</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Subject</th>
          <th>From</th>
          <th>Age</th>
        </tr>
      </thead>
      <tbody>
        {unrespondedEmails.map(email => (
          <tr key={email.id}>
            <td>{email.subject}</td>
            <td>{email.from_email}</td>
            <td style={{ color: "#E11D2E", fontWeight: 600 }}>
              {email.age_minutes} min
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</section>


      {/* Table */}
      <section>
        <div className="table-actions">
          <h2>Daily Metrics</h2>
          <button onClick={() => exportToCSV(filteredMetrics)}>
            Export CSV
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Received</th>
              <th>Responded</th>
              <th>Avg Response</th>
              <th>SLA Breaches</th>
              <th>SLA %</th>
            </tr>
          </thead>
          <tbody>
            {filteredMetrics.map((row) => (
              <tr key={`${row.employee_email}-${row.date}`}>
                <td>{row.date}</td>
                <td>{row.employee_email}</td>
                <td style={{ color: "#0A2540", fontWeight: 600 }}>{row.total_emails_received}</td>
                <td style={{ color: "#E11D2E", fontWeight: 600 }}>{row.total_emails_responded}</td>
                <td>{row.avg_response_time_minutes ?? "—"}</td>
                <td>{row.sla_breaches}</td>
                <td>{row.slaPercent ?? "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;

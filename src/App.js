import { useEffect, useState } from 'react';
import { supabase } from './supabase';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

function App() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from('daily_metrics')
        .select('*')
        .order('date', { ascending: false });

      if (!error && data) {
        setMetrics(data);
      }
      setLoading(false);
    }

    loadData();
  }, []);

  if (loading) {
    return <p style={{ padding: 24 }}>Loading dashboard…</p>;
  }

  // Enrich metrics with SLA %
  const enrichedMetrics = metrics.map(row => {
    const responded = row.total_emails_responded || 0;
    const breaches = row.sla_breaches || 0;

    const slaPercent =
      responded > 0
        ? Math.round(((responded - breaches) / responded) * 100)
        : null;

    return { ...row, slaPercent };
  });

  // Apply date filters
  const filteredMetrics = enrichedMetrics.filter(row => {
    if (startDate && row.date < startDate) return false;
    if (endDate && row.date > endDate) return false;
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      <h1>Email Response Dashboard</h1>

      {/* Date Filters */}
      <section style={{ marginBottom: 24 }}>
        <h2>Filter by Date</h2>
        <label>
          From:{' '}
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </label>

        <label style={{ marginLeft: 16 }}>
          To:{' '}
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </label>
      </section>

      {/* Avg Response Time Trend */}
      <section style={{ marginBottom: 32 }}>
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
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Emails Received vs Responded */}
      <section style={{ marginBottom: 32 }}>
        <h2>Emails Received vs Responded</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={filteredMetrics}>
            <XAxis dataKey="employee_email" hide />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="total_emails_received"
              name="Received"
            />
            <Bar
              dataKey="total_emails_responded"
              name="Responded"
            />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Rankings */}
      <section style={{ marginBottom: 32 }}>
        <h2>Top Responders (Fastest Avg Response)</h2>
        <ul>
          {[...filteredMetrics]
            .filter(r => r.avg_response_time_minutes !== null)
            .sort(
              (a, b) =>
                a.avg_response_time_minutes - b.avg_response_time_minutes
            )
            .slice(0, 5)
            .map(r => (
              <li key={`${r.employee_email}-fast`}>
                {r.employee_email} — {r.avg_response_time_minutes} min
              </li>
            ))}
        </ul>

        <h2>Best SLA Compliance</h2>
        <ul>
          {[...filteredMetrics]
            .filter(r => r.slaPercent !== null)
            .sort((a, b) => b.slaPercent - a.slaPercent)
            .slice(0, 5)
            .map(r => (
              <li key={`${r.employee_email}-sla`}>
                {r.employee_email} — {r.slaPercent}%
              </li>
            ))}
        </ul>
      </section>

      {/* Metrics Table */}
      <section>
        <h2>Daily Metrics</h2>
        <table border="1" cellPadding="8">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Received</th>
              <th>Responded</th>
              <th>Avg Response (min)</th>
              <th>SLA Breaches</th>
              <th>SLA %</th>
            </tr>
          </thead>
          <tbody>
            {filteredMetrics.map(row => (
              <tr key={`${row.employee_email}-${row.date}`}>
                <td>{row.date}</td>
                <td>{row.employee_email}</td>
                <td>{row.total_emails_received}</td>
                <td>{row.total_emails_responded}</td>
                <td>
                  {row.avg_response_time_minutes !== null
                    ? row.avg_response_time_minutes
                    : '—'}
                </td>
                <td>{row.sla_breaches}</td>
                <td>
                  {row.slaPercent !== null ? `${row.slaPercent}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;

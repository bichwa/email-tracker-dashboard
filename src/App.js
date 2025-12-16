import { useEffect, useState } from 'react';
import { supabase } from './supabase';

function App() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from('daily_metrics')
        .select('*')
        .order('date', { ascending: false });

      if (!error) setMetrics(data);
      setLoading(false);
    }

    loadData();
  }, []);

  if (loading) return <p>Loading dashboard…</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Email Response Dashboard</h1>

      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Date</th>
            <th>Employee</th>
            <th>Received</th>
            <th>Responded</th>
            <th>Avg Response (min)</th>
            <th>SLA Breaches</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(row => (
            <tr key={`${row.employee_email}-${row.date}`}>
              <td>{row.date}</td>
              <td>{row.employee_email}</td>
              <td>{row.total_emails_received}</td>
              <td>{row.total_emails_responded}</td>
              <td>{row.avg_response_time_minutes}</td>
              <td>{row.sla_breaches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { hrApi } from "../services/api";

export default function HRInterviewListPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await hrApi.interviews();
        setData(res.interviews || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p className="center muted">Loading interviews...</p>;

  return (
    <div className="stack">
      <h2>HR Interviews</h2>
      {error && <p className="alert error">{error}</p>}
      {!data.length && <p className="muted">No interviews found.</p>}
      {!!data.length && (
        <table className="table">
          <thead>
            <tr>
              <th>Application</th>
              <th>Candidate</th>
              <th>Job</th>
              <th>Status</th>
              <th>Events</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.interview_id}>
                <td>{row.application_id || "N/A"}</td>
                <td>{row.candidate?.name} ({row.candidate?.email})</td>
                <td>{row.job?.title || "Job"}</td>
                <td>{row.status}</td>
                <td>{row.events_count}</td>
                <td>
                  <Link to={`/hr/interviews/${row.interview_id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

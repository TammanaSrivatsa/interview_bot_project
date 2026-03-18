import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import MetricCard from "../components/MetricCard";
import PageHeader from "../components/PageHeader";
import { hrApi } from "../services/api";
import { formatDateTime } from "../utils/formatters";

export default function HRInterviewListPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await hrApi.interviews();
        setData(response.interviews || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((row) => {
      const candidateName = row.candidate?.name || "";
      const candidateEmail = row.candidate?.email || "";
      const jobTitle = row.job?.title || "";
      const applicationId = row.application_id || "";
      return [candidateName, candidateEmail, jobTitle, applicationId, row.status || ""]
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [data, search]);

  const suspiciousTotal = filteredRows.reduce((sum, row) => sum + Number(row.suspicious_events_count || 0), 0);
  const completedCount = filteredRows.filter((row) => row.status === "completed" || row.status === "selected" || row.status === "rejected").length;

  if (loading) return <p className="center muted">Loading interviews...</p>;

  return (
    <div className="stack">
      <PageHeader
        title="Interview Reviews"
        subtitle="Review completed sessions, suspicious events, and finalize outcomes."
        actions={
          <Link to="/hr" className="button-link subtle-button">
            Back to HR Dashboard
          </Link>
        }
      />

      {error && <p className="alert error">{error}</p>}

      <section className="metric-grid">
        <MetricCard label="Interviews" value={String(filteredRows.length)} hint="Current filtered sessions" />
        <MetricCard label="Completed" value={String(completedCount)} hint="Ready for final decision" />
        <MetricCard label="Suspicious events" value={String(suspiciousTotal)} hint="Across visible sessions" />
      </section>

      <section className="card stack">
        <div className="section-grid">
          <input type="search" placeholder="Search candidate, email, job, application, or status" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {!filteredRows.length && <p className="muted">No interviews found.</p>}
        {!!filteredRows.length && (
          <table className="table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Candidate</th>
                <th>Job</th>
                <th>Status</th>
                <th>Started</th>
                <th>Events</th>
                <th>Suspicious</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.interview_id}>
                  <td>{row.application_id || "N/A"}</td>
                  <td>
                    <div className="stack-sm">
                      <strong>{row.candidate?.name}</strong>
                      <span className="muted">{row.candidate?.email}</span>
                    </div>
                  </td>
                  <td>{row.job?.title || "Job"}</td>
                  <td>{row.status}</td>
                  <td>{formatDateTime(row.started_at)}</td>
                  <td>{row.events_count}</td>
                  <td>{row.suspicious_events_count ?? 0}</td>
                  <td>
                    <Link to={`/hr/interviews/${row.interview_id}`} className="button-link subtle-button">
                      Open review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

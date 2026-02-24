import { useEffect, useMemo, useState } from "react";
import { candidateApi } from "../services/api";

export default function CandidateDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumeFile, setResumeFile] = useState(null);
  const [interviewDate, setInterviewDate] = useState("");

  const selectedJobId = data?.selected_job_id || null;
  const availableJobs = data?.available_jobs || [];
  const selectedJob = useMemo(
    () => availableJobs.find((job) => job.id === selectedJobId) || null,
    [availableJobs, selectedJobId],
  );

  async function loadDashboard(jobId) {
    setLoading(true);
    setError("");
    try {
      const dashboard = await candidateApi.dashboard(jobId);
      setData(dashboard);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleUploadResume() {
    if (!resumeFile || !selectedJobId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await candidateApi.uploadResume(resumeFile, selectedJobId);
      setData(response);
      setResumeFile(null);
      setNotice(response.message || "Resume uploaded.");
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduleInterview() {
    if (!data?.result?.id || !interviewDate) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await candidateApi.scheduleInterview({
        result_id: data.result.id,
        interview_date: interviewDate,
      });
      setNotice(response.message);
      await loadDashboard(selectedJobId);
    } catch (scheduleError) {
      setError(scheduleError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="center muted">Loading candidate dashboard...</p>;

  return (
    <div className="stack">
      {error && <p className="alert error">{error}</p>}
      {notice && <p className="alert success">{notice}</p>}

      <section className="card">
        <div className="title-row">
          <h2>Candidate Dashboard</h2>
          <button onClick={() => loadDashboard(selectedJobId)}>Refresh</button>
        </div>
        <p>
          <strong>Name:</strong> {data?.candidate?.name}
        </p>
        <p>
          <strong>Email:</strong> {data?.candidate?.email}
        </p>
        <p>
          <strong>Resume:</strong> {data?.candidate?.resume_path || "Not uploaded"}
        </p>
      </section>

      <section className="card">
        <h3>Select Company / JD</h3>
        {!availableJobs.length && <p className="muted">No jobs available yet.</p>}
        {!!availableJobs.length && (
          <div className="stack-sm">
            <select value={selectedJobId || ""} onChange={(e) => loadDashboard(Number(e.target.value))}>
              {availableJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company_name} | {job.jd_title || job.jd_name}
                </option>
              ))}
            </select>
            {selectedJob && (
              <p className="muted">
                Education: {selectedJob.education_requirement || "None"} | Experience:{" "}
                {selectedJob.experience_requirement || 0} years | Gender:{" "}
                {selectedJob.gender_requirement || "None"}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Upload Resume</h3>
        <div className="inline-row">
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
          />
          <button disabled={busy || !resumeFile || !selectedJobId} onClick={handleUploadResume}>
            {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Latest AI Result</h3>
        {!data?.result && <p className="muted">No result yet for selected JD.</p>}
        {!!data?.result && (
          <div className="stack-sm">
            <p>
              <strong>Score:</strong> {data.result.score}%
            </p>
            <p>
              <strong>Status:</strong> {data.result.shortlisted ? "Shortlisted" : "Rejected"}
            </p>
            <p>
              <strong>Skill Match:</strong> {data.result.explanation?.matched_percentage ?? 0}%
            </p>
            <p>
              <strong>Missing Skills:</strong>{" "}
              {(data.result.explanation?.missing_skills || []).join(", ") || "None"}
            </p>
            {data.result.shortlisted && !data.result.interview_date && (
              <div className="inline-row">
                <input
                  type="datetime-local"
                  value={interviewDate}
                  onChange={(e) => setInterviewDate(e.target.value)}
                />
                <button disabled={busy || !interviewDate} onClick={handleScheduleInterview}>
                  Confirm Interview
                </button>
              </div>
            )}
            {data.result.interview_date && (
              <p>
                <strong>Interview Link:</strong>{" "}
                <a href={data.result.interview_link} target="_blank" rel="noreferrer">
                  Open Interview
                </a>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

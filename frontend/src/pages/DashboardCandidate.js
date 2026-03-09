import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';

function ScoreRing({ value, label, tone = 'brand' }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeValue / 100) * circumference;
  const stroke = tone === 'danger' ? '#dc2626' : tone === 'success' ? '#15803d' : '#0f766e';

  return (
    <div className="ib-score-ring-wrap">
      <svg width="126" height="126" viewBox="0 0 126 126" className="ib-score-ring">
        <circle cx="63" cy="63" r={radius} stroke="#e2e8f0" strokeWidth="11" fill="none" />
        <circle
          cx="63"
          cy="63"
          r={radius}
          stroke={stroke}
          strokeWidth="11"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 63 63)"
        />
      </svg>
      <div className="ib-score-ring-text">
        <div className="ib-score-ring-value">{safeValue}%</div>
        <div className="ib-score-ring-label">{label}</div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, tone = 'brand' }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="ib-score-row">
      <div className="ib-score-row-head">
        <span>{label}</span>
        <strong>{safeValue}%</strong>
      </div>
      <div className="ib-score-track">
        <div className={`ib-score-fill ib-score-${tone}`} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function DashboardCandidate() {
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadedResume, setUploadedResume] = useState('');
  const [result, setResult] = useState(null);
  const [availableJds, setAvailableJds] = useState([]);
  const [selectedJd, setSelectedJd] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [successMessage]);

  const fetchDashboard = async () => {
    try {
      const response = await axios.get('/candidate/dashboard');

      if (response.data.candidate) {
        setCandidateName(response.data.candidate.name || '');
        setUploadedResume(response.data.candidate.resume_path?.split('/').pop() || '');
      }

      if (response.data.result) {
        setResult(response.data.result);
      } else {
        setResult(null);
      }

      const jds = response.data.available_jds || [];
      setAvailableJds(jds);

      if (!selectedJd && jds.length > 0) {
        setSelectedJd(String(jds[0].id));
      }
    } catch (error) {
      console.error('Failed to fetch dashboard', error);
    }
  };

  const handleResumeUpload = async (e) => {
    e.preventDefault();

    if (!selectedJd) {
      alert('Please select a job description');
      return;
    }

    setUploading(true);

    const formData = new FormData(e.target);
    formData.append('job_id', selectedJd);

    try {
      const response = await axios.post('/upload_resume', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        fetchDashboard();
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleInterviewDate = async (e) => {
    e.preventDefault();
    setScheduling(true);

    const formData = new FormData(e.target);

    try {
      const response = await axios.post('/select_interview_date', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        fetchDashboard();
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Scheduling failed');
    } finally {
      setScheduling(false);
    }
  };

  const stage = !result
    ? 'Apply'
    : !result.shortlisted
    ? 'Not Shortlisted'
    : result.shortlisted && !result.interview_date
    ? 'Schedule Interview'
    : 'Interview Scheduled';

  const semanticScore = Number(result?.explanation?.semantic_score || 0);
  const skillScore = Number(result?.explanation?.skill_score || 0);
  const overallScore = Number(result?.score || 0);
  const scoreTone = overallScore >= 60 ? 'success' : 'danger';

  return (
    <>
      <Navbar showLogout />
      <div className="ib-shell">
        <div className="ib-container">
          <section className="ib-card ib-p-24 mb-4">
            <div className="ib-kicker">Candidate Console</div>
            <h2 className="ib-title">Apply, get screened, and move to interview</h2>
            <p className="ib-subtitle mb-0">
              Welcome {candidateName || 'Candidate'}. This dashboard follows the exact interview
              bot journey from resume submission to interview launch.
            </p>
          </section>

          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          <section className="ib-grid ib-grid-3 mb-4">
            <div className="ib-stat">
              <div className="ib-stat-label">Current Stage</div>
              <div className="ib-stat-value">{stage}</div>
            </div>
            <div className="ib-stat">
              <div className="ib-stat-label">Latest Score</div>
              <div className="ib-stat-value">{result ? `${result.score}%` : '-'}</div>
            </div>
            <div className="ib-stat">
              <div className="ib-stat-label">Interview</div>
              <div className="ib-stat-value">{result?.interview_date ? 'Booked' : 'Pending'}</div>
            </div>
          </section>

          <section className="ib-grid ib-grid-2">
            <div className="ib-card ib-p-24">
              <h5 className="mb-3">Step 1: Choose Role and Upload Resume</h5>
              <form onSubmit={handleResumeUpload} encType="multipart/form-data">
                <label className="ib-label">Open Jobs</label>
                <select
                  className="form-select mb-3"
                  value={selectedJd}
                  onChange={(e) => setSelectedJd(e.target.value)}
                  required
                >
                  <option value="">Select a role</option>
                  {availableJds.map((jd) => (
                    <option key={jd.id} value={jd.id}>
                      {jd.company_name} | JD #{jd.id}
                    </option>
                  ))}
                </select>

                <label className="ib-label">Resume File</label>
                <input type="file" name="resume" className="form-control mb-3" required />
                <div className="ib-help">
                  Uploading a new resume replaces your old result and triggers fresh AI scoring.
                </div>

                <button disabled={uploading} className="btn ib-btn-brand btn-primary mt-4 w-100">
                  {uploading ? 'Uploading...' : 'Upload Resume & Run Screening'}
                </button>
              </form>

              {uploadedResume && (
                <div className="alert alert-info mt-3 mb-0">
                  Last uploaded resume: <strong>{uploadedResume}</strong>
                </div>
              )}
            </div>

            <div className="ib-card ib-p-24 ib-card-soft">
              <h5 className="mb-3">Step 2: Result and Next Action</h5>
              {!result && (
                <p className="text-muted mb-0">
                  No screening result yet. Upload resume to begin evaluation.
                </p>
              )}

              {result && (
                <>
                  <div className="ib-status">
                    <strong>AI Screening Score:</strong> {result.score}%
                  </div>

                  {result.shortlisted ? (
                    <>
                      <div className="alert alert-success">
                        Shortlisted. Continue with interview scheduling.
                      </div>

                      {!result.interview_date ? (
                        <form onSubmit={handleInterviewDate}>
                          <input type="hidden" name="result_id" value={result.id} />
                          <label className="ib-label">Pick Interview Date and Time</label>
                          <input
                            type="datetime-local"
                            name="interview_date"
                            className="form-control mb-3"
                            min={new Date().toISOString().slice(0, 16)}
                            required
                          />

                          <button disabled={scheduling} className="btn btn-success w-100">
                            {scheduling ? 'Scheduling...' : 'Confirm Interview'}
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="ib-status mb-2">
                            <strong>Interview Scheduled:</strong> {result.interview_date}
                          </div>
                          <div className="alert alert-secondary mb-0">
                            Interview link is sent to your registered email.
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="alert alert-danger mb-0">
                      Not shortlisted for this role based on current screening.
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {result?.explanation && (
            <section className="ib-card ib-p-24 mt-4">
              <h5 className="mb-3">AI Screening Breakdown & Score Graphs</h5>
              <div className="ib-grid ib-grid-2 mb-3">
                <div className="ib-card ib-card-soft ib-p-24">
                  <h6 className="mb-3">Overall Score</h6>
                  <ScoreRing value={overallScore} label="Final Score" tone={scoreTone} />
                </div>
                <div className="ib-card ib-card-soft ib-p-24">
                  <h6 className="mb-3">Score Components</h6>
                  <ScoreBar label="Semantic Match" value={semanticScore} tone="brand" />
                  <ScoreBar label="Skill Match" value={skillScore} tone="success" />
                  <ScoreBar
                    label="Final Screening"
                    value={overallScore}
                    tone={overallScore >= 60 ? 'success' : 'danger'}
                  />
                </div>
              </div>
              <div className="ib-grid ib-grid-2">
                <div className="ib-status">
                  <strong>Semantic Match:</strong> {result.explanation.semantic_score || 0}%
                </div>
                <div className="ib-status">
                  <strong>Skill Match:</strong> {result.explanation.skill_score || 0}%
                </div>
                <div className="ib-status">
                  <strong>Matched Skills:</strong>{' '}
                  {result.explanation.matched_skills?.join(', ') || 'None'}
                </div>
                <div className="ib-status">
                  <strong>Education Check:</strong>{' '}
                  {result.explanation.education_reason || 'No issue detected'}
                </div>
                <div className="ib-status">
                  <strong>Experience Check:</strong>{' '}
                  {result.explanation.experience_reason || 'No issue detected'}
                </div>
                <div className="ib-status mb-0">
                  <strong>Academic Check:</strong>{' '}
                  {result.explanation.percentage_reason || 'No issue detected'}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default DashboardCandidate;

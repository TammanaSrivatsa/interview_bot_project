import React, { useState, useEffect } from 'react';
import type { AxiosError } from 'axios';
import api from '../lib/api';

type DashboardResult = {
  id: number;
  score: number;
  shortlisted: boolean;
  interview_date?: string | null;
  pipeline_status?: string | null;
  hr_decision?: string | null;
  explanation?: {
    semantic_score?: number;
    skill_score?: number;
    matched_skills?: string[];
    education_reason?: string;
    experience_reason?: string;
    percentage_reason?: string;
  } | null;
};

type JobDescription = {
  id: number;
  company_name: string;
};

function DashboardCandidate() {
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadedResume, setUploadedResume] = useState('');
  const [selectedResumeName, setSelectedResumeName] = useState('');
  const [result, setResult] = useState<DashboardResult | null>(null);
  const [availableJds, setAvailableJds] = useState<JobDescription[]>([]);
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
      const response = await api.get('/candidate/dashboard');

      if (response.data.candidate) {
        setCandidateName(response.data.candidate.name || '');
        setUploadedResume(response.data.candidate.resume_path?.split('/').pop() || '');
      }

      setResult(response.data.result || null);

      const jds = response.data.available_jds || [];
      setAvailableJds(jds);
      if (!selectedJd && jds.length > 0) {
        setSelectedJd(String(jds[0].id));
      }
    } catch (error) {
      console.error('Failed to fetch dashboard', error);
    }
  };

  const handleResumeUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!selectedJd) {
      alert('Please select a job description');
      return;
    }

    setUploading(true);
    const formData = new FormData(e.currentTarget);
    formData.append('job_id', selectedJd);

    try {
      const response = await api.post('/upload_resume', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setSelectedResumeName('');
        fetchDashboard();
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleInterviewDate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setScheduling(true);

    const formData = new FormData(e.currentTarget);

    try {
      const response = await api.post('/select_interview_date', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        fetchDashboard();
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Scheduling failed');
    } finally {
      setScheduling(false);
    }
  };

  const stage = !result
    ? 'Application Pending'
    : (result.pipeline_status || 'screened')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (value) => value.toUpperCase());

  const semanticScore = Number(result?.explanation?.semantic_score || 0);
  const skillScore = Number(result?.explanation?.skill_score || 0);
  const overallScore = Number(result?.score || 0);
  const matchedSkills = result?.explanation?.matched_skills || [];
  const scoreTone = overallScore >= 60 ? 'Strong Match' : 'Needs Work';

  const pipelineItems = [
    { label: 'Engineering', value: 45 },
    { label: 'Design', value: 25 },
    { label: 'Marketing', value: 30 }
  ];

  return (
    <>
      <div className="ib-shell ib-candidate-shell">
        <div className="ib-container ib-panel-stack">
          <section className="ib-candidate-hero">
            <div className="ib-candidate-hero-copy">
              <div className="ib-kicker ib-kicker-light">Candidate Command Center</div>
              <h1 className="ib-candidate-hero-title">Live Candidate Dashboard</h1>
              <p className="ib-candidate-hero-text">
                Welcome back, {candidateName || 'Candidate'}. Track your screening status,
                upload your latest resume, and move from shortlist to interview in one place.
              </p>
            </div>

            <div className="ib-candidate-hero-art">
              <div className="ib-candidate-chart-card">
                <div className="ib-candidate-bars">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="ib-candidate-arrow" />
              </div>
            </div>
          </section>

          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          <section className="ib-grid ib-grid-3">
            <div className="ib-candidate-stat-card">
              <div className="ib-candidate-stat-label">Current Stage</div>
              <div className="ib-candidate-stat-value">{stage}</div>
              <div className="ib-candidate-stat-note">
                {result?.shortlisted ? 'Progressing to interview stage' : 'Waiting for shortlist confirmation'}
              </div>
            </div>

            <div className="ib-candidate-stat-card">
              <div className="ib-candidate-stat-label">Screening Score</div>
              <div className="ib-candidate-stat-value">{result ? `${result.score}/100` : 'Pending'}</div>
              <div className="ib-candidate-stat-note">{scoreTone}</div>
            </div>

            <div className="ib-candidate-stat-card">
              <div className="ib-candidate-stat-label">Next Interview Slot</div>
              <div className="ib-candidate-stat-value">{result?.interview_date || 'Not Booked'}</div>
              <div className="ib-candidate-stat-note">
                {result?.interview_date ? 'Interview confirmed' : 'Choose a slot after shortlist'}
              </div>
            </div>
          </section>

          <section className="ib-candidate-main-grid">
            <div className="ib-candidate-side-stack">
              <section className="ib-candidate-card">
                <div className="ib-candidate-card-head">Quick Screen</div>
                <form onSubmit={handleResumeUpload} encType="multipart/form-data" className="ib-auth-form">
                  <div>
                    <label className="ib-candidate-field-label">Select Target Role</label>
                    <select
                      className="ib-candidate-input"
                      value={selectedJd}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedJd(e.target.value)}
                      required
                    >
                      <option value="">Select a role</option>
                      {availableJds.map((jd) => (
                        <option key={jd.id} value={jd.id}>
                          {jd.company_name} | JD #{jd.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="ib-candidate-upload">
                    <input
                      type="file"
                      name="resume"
                      className="d-none"
                      required
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSelectedResumeName(e.target.files?.[0]?.name || '')
                      }
                    />
                    <span className="ib-candidate-upload-icon">↑</span>
                    <strong>{selectedResumeName || 'Click to upload resume'}</strong>
                    <small>
                      {selectedResumeName ? 'Selected file ready for upload' : 'PDF or DOCX (Max 10MB)'}
                    </small>
                  </label>

                  <button disabled={uploading} className="btn ib-candidate-primary w-100">
                    {uploading ? 'Running Analysis...' : 'Run AI Analysis'}
                  </button>
                </form>

                {uploadedResume && (
                  <div className="ib-candidate-inline-note">
                    Latest upload: <strong>{uploadedResume}</strong>
                  </div>
                )}
              </section>

              <section className="ib-candidate-card">
                <div className="ib-candidate-card-head">Pipeline Distribution</div>
                <div className="ib-candidate-pipeline-list">
                  {pipelineItems.map((item) => (
                    <div key={item.label}>
                      <div className="ib-candidate-pipeline-row">
                        <span>{item.label}</span>
                        <strong>{item.value}%</strong>
                      </div>
                      <div className="ib-candidate-pipeline-track">
                        <div className="ib-candidate-pipeline-fill" style={{ width: `${item.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="ib-candidate-profile-card">
              <div className="ib-candidate-profile-top">
                <div className="ib-candidate-ring">
                  <div className="ib-candidate-ring-inner">
                    <strong>{overallScore || 0}</strong>
                    <span>Score</span>
                  </div>
                </div>

                <div className="ib-candidate-profile-copy">
                  <h2>{candidateName || 'Candidate Profile'}</h2>
                  <p>
                    Candidate for {selectedJd ? 'selected role' : 'screening pipeline'}
                  </p>
                  <div className="ib-candidate-chip-row">
                    <span className="ib-candidate-chip ib-candidate-chip-success">
                      {result?.shortlisted ? 'Strong Match' : 'In Review'}
                    </span>
                    <span className="ib-candidate-chip">AI Recommended</span>
                  </div>
                </div>
              </div>

              <div className="ib-candidate-score-block">
                <div>
                  <div className="ib-candidate-progress-row">
                    <span>Semantic Compatibility</span>
                    <strong>{semanticScore}%</strong>
                  </div>
                  <div className="ib-candidate-pipeline-track">
                    <div className="ib-candidate-pipeline-fill" style={{ width: `${semanticScore}%` }} />
                  </div>
                </div>

                <div>
                  <div className="ib-candidate-progress-row">
                    <span>Technical Skill Mastery</span>
                    <strong>{skillScore}%</strong>
                  </div>
                  <div className="ib-candidate-pipeline-track">
                    <div className="ib-candidate-pipeline-fill" style={{ width: `${skillScore}%` }} />
                  </div>
                </div>
              </div>

              <div className="ib-candidate-skills">
                <div className="ib-candidate-field-label">Matched Skills</div>
                <div className="ib-candidate-chip-row">
                  {matchedSkills.length > 0 ? (
                    matchedSkills.map((skill) => (
                      <span key={skill} className="ib-candidate-chip">
                        {skill}
                      </span>
                    ))
                  ) : (
                    <span className="ib-candidate-chip">Awaiting screening</span>
                  )}
                </div>
              </div>

              <div className="ib-candidate-detail-grid">
                <div className="ib-candidate-detail-card">
                  <div className="ib-candidate-field-label">Education</div>
                  <strong>{result?.explanation?.education_reason || 'No issue detected'}</strong>
                </div>
                <div className="ib-candidate-detail-card">
                  <div className="ib-candidate-field-label">Relevant Experience</div>
                  <strong>{result?.explanation?.experience_reason || 'No issue detected'}</strong>
                </div>
              </div>

              {result?.shortlisted && !result.interview_date && (
                <form onSubmit={handleInterviewDate} className="ib-auth-form ib-candidate-schedule">
                  <input type="hidden" name="result_id" value={result.id} />
                  <div>
                    <label className="ib-candidate-field-label">Pick Interview Slot</label>
                    <input
                      type="datetime-local"
                      name="interview_date"
                      className="ib-candidate-input"
                      min={new Date().toISOString().slice(0, 16)}
                      required
                    />
                  </div>
                  <button disabled={scheduling} className="btn ib-candidate-primary">
                    {scheduling ? 'Scheduling...' : 'Confirm Interview'}
                  </button>
                </form>
              )}
            </section>
          </section>

          <section className="ib-grid ib-grid-2">
            <section className="ib-candidate-insight ib-candidate-insight-positive">
              <div className="ib-candidate-insight-title">AI Positives</div>
              <ul className="ib-plain-list">
                <li>Strong semantic alignment with the selected job description.</li>
                <li>Skill score indicates competitive technical relevance.</li>
                <li>Matched skills: {matchedSkills.length > 0 ? matchedSkills.join(', ') : 'Awaiting screening'}.</li>
              </ul>
            </section>

            <section className="ib-candidate-insight ib-candidate-insight-warning">
              <div className="ib-candidate-insight-title">Points to Probe</div>
              <ul className="ib-plain-list">
                <li>{result?.explanation?.percentage_reason || 'Academic review pending further checks.'}</li>
                <li>{result?.explanation?.experience_reason || 'Experience verification remains role dependent.'}</li>
                <li>{result?.shortlisted ? 'Proceed to interview scheduling for deeper evaluation.' : 'A stronger resume match is needed to unlock interview booking.'}</li>
              </ul>
            </section>
          </section>
        </div>
      </div>
    </>
  );
}

export default DashboardCandidate;

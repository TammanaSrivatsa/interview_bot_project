import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AxiosError } from 'axios';
import api from '../lib/api';

type RecruiterDecision = 'pending' | 'saved' | 'selected' | 'rejected' | 'on_hold';

type JobDescriptionSummary = {
  id: number;
  company_name: string;
  role_name?: string | null;
  jd_text: string;
  skill_scores: Record<string, number>;
  gender_requirement?: string | null;
  education_requirement?: string | null;
  experience_requirement?: number | null;
  role_classification: string;
};

type CandidateEntry = {
  candidate: {
    id: number;
    name: string;
    email: string;
    resume_path: string;
  };
  result: {
    id: number;
    score: number;
    interview_date?: string | null;
    pipeline_status: string;
    hr_decision?: string | null;
    recruiter_notes?: string | null;
    recruiter_feedback?: string | null;
    report_generated_at?: string | null;
  };
  interview_details: {
    status: string;
    scheduled_at?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    duration_seconds: number;
    suspicious_activity: boolean;
    violations: Array<{ reason?: string; time?: string }>;
    timeline: Array<{ event?: string; description?: string; time?: string }>;
    qa_transcript: Array<{
      id: number;
      question: string;
      answer?: string | null;
      score?: number | null;
      score_reason?: string | null;
    }>;
    final_score?: number | null;
    overall_feedback?: string | null;
  };
  candidate_report: {
    summary: {
      screening_score: number;
      interview_score?: number | null;
      overall_recommendation: string;
      pipeline_status: string;
      hr_decision: string;
    };
    candidate_skills: string[];
    missing_required_skills: string[];
    screening_analysis: {
      experience_detected_years: number;
    };
    interview_analysis: {
      questions_asked: number;
      violation_count: number;
      average_question_score?: number | null;
    };
  };
};

type DashboardSummary = {
  total_selected: number;
  cleared_interview: number;
  in_progress: number;
  saved_candidates: number;
  rejected_candidates: number;
  on_hold_candidates: number;
  completed_reports: number;
};

type ReviewDraft = {
  decision: RecruiterDecision;
  notes: string;
  feedback: string;
};

type JdEditDraft = {
  role_name: string;
  education_requirement: string;
  experience_requirement: string;
  gender_requirement: string;
  skill_entries: Array<{ skill: string; score: string }>;
};

const decisionOptions: RecruiterDecision[] = ['pending', 'saved', 'selected', 'rejected', 'on_hold'];

function DashboardHR() {
  const navigate = useNavigate();
  const candidateDeskRef = useRef<HTMLElement | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadedJd, setUploadedJd] = useState('');
  const [selectedJdFileName, setSelectedJdFileName] = useState('');
  const [aiSkills, setAiSkills] = useState<string[]>([]);
  const [shortlistedCandidates, setShortlistedCandidates] = useState<CandidateEntry[]>([]);
  const [visibleDetails, setVisibleDetails] = useState<Record<number, boolean>>({});
  const [latestJd, setLatestJd] = useState<JobDescriptionSummary | null>(null);
  const [availableJds, setAvailableJds] = useState<JobDescriptionSummary[]>([]);
  const [selectedJdId, setSelectedJdId] = useState('');
  const [openJdId, setOpenJdId] = useState<number | null>(null);
  const [editingJdId, setEditingJdId] = useState<number | null>(null);
  const [jdDrafts, setJdDrafts] = useState<Record<number, JdEditDraft>>({});
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, ReviewDraft>>({});
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savingReviewId, setSavingReviewId] = useState<number | null>(null);
  const [savingJdId, setSavingJdId] = useState<number | null>(null);
  const [runningBatchScreening, setRunningBatchScreening] = useState(false);
  const [downloadingSummary, setDownloadingSummary] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (!successMessage) return undefined;
    const timer = setTimeout(() => setSuccessMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const seedReviewDrafts = (entries: CandidateEntry[]) => {
    setReviewDrafts((previous) => {
      const next = { ...previous };
      entries.forEach((entry) => {
        if (!next[entry.result.id]) {
          next[entry.result.id] = {
            decision: (entry.result.hr_decision as RecruiterDecision) || 'pending',
            notes: entry.result.recruiter_notes || '',
            feedback: entry.result.recruiter_feedback || '',
          };
        }
      });
      return next;
    });
  };

  const fetchDashboard = async (jobId = '') => {
    try {
      const response = await api.get('/hr/dashboard', {
        params: jobId ? { job_id: jobId } : {},
      });

      const entries = (response.data.shortlisted_candidates || []) as CandidateEntry[];
      const jobs = (response.data.available_jds || []) as JobDescriptionSummary[];
      setLatestJd(response.data.latest_jd || null);
      setAvailableJds(jobs);
      setShortlistedCandidates(entries);
      setSummary(response.data.summary || null);
      seedReviewDrafts(entries);
      setJdDrafts((previous) => {
        const next = { ...previous };
        jobs.forEach((job) => {
          if (!next[job.id]) {
            next[job.id] = {
              role_name: job.role_name || job.role_classification || '',
              education_requirement: job.education_requirement || '',
              experience_requirement: String(job.experience_requirement ?? 0),
              gender_requirement: job.gender_requirement || '',
              skill_entries: Object.entries(job.skill_scores || {}).map(([skill, score]) => ({
                skill,
                score: String(score),
              })),
            };
          }
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch dashboard', error);
    }
  };

  const handleJdUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploading(true);
    const formData = new FormData(e.currentTarget);

    try {
      const response = await api.post('/upload_jd', formData);
      if (response.data.success) {
        setSuccessMessage('JD uploaded and skills extracted. Review weights before confirming.');
        setUploadedJd(response.data.uploaded_jd);
        setSelectedJdFileName('');
        setAiSkills(Object.keys(response.data.ai_skills || {}));
      }
    } catch (error) {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmJd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setConfirming(true);
    const formData = new FormData(e.currentTarget);

    try {
      const response = await api.post('/confirm_jd', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setAiSkills([]);
        setUploadedJd('');
        setSelectedJdId('');
        await fetchDashboard('');
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  const handleRoleSelection = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const jobId = e.target.value;
    setSelectedJdId(jobId);
    await fetchDashboard(jobId);
  };

  const updateDraft = (resultId: number, patch: Partial<ReviewDraft>) => {
    setReviewDrafts((prev) => ({
      ...prev,
      [resultId]: {
        decision: prev[resultId]?.decision || 'pending',
        notes: prev[resultId]?.notes || '',
        feedback: prev[resultId]?.feedback || '',
        ...patch,
      },
    }));
  };

  const saveReview = async (resultId: number) => {
    const draft = reviewDrafts[resultId];
    if (!draft) return;

    setSavingReviewId(resultId);
    const formData = new FormData();
    formData.append('result_id', String(resultId));
    formData.append('hr_decision', draft.decision);
    formData.append('recruiter_notes', draft.notes);
    formData.append('recruiter_feedback', draft.feedback);

    try {
      const response = await api.post('/hr/candidate/review', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        await fetchDashboard(selectedJdId);
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Failed to update recruiter review');
    } finally {
      setSavingReviewId(null);
    }
  };

  const openReport = (resultId: number) => {
    window.open(`/hr/report/${resultId}`, '_blank', 'noopener,noreferrer');
  };

  const handleLogout = async () => {
    await api.get('/logout');
    navigate('/');
  };

  const toggleDetails = (id: number) => {
    setVisibleDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleJdDetails = (id: number) => {
    setOpenJdId((current) => (current === id ? null : id));
  };

  const activateJd = async (id: number) => {
    setSelectedJdId(String(id));
    await fetchDashboard(String(id));
  };

  const startEditingJd = (job: JobDescriptionSummary) => {
    setEditingJdId(job.id);
    setJdDrafts((prev) => ({
      ...prev,
      [job.id]: {
        role_name: job.role_name || job.role_classification || '',
        education_requirement: job.education_requirement || '',
        experience_requirement: String(job.experience_requirement ?? 0),
        gender_requirement: job.gender_requirement || '',
        skill_entries: Object.entries(job.skill_scores || {}).map(([skill, score]) => ({
          skill,
          score: String(score),
        })),
      },
    }));
  };

  const updateJdDraft = (jobId: number, patch: Partial<JdEditDraft>) => {
    setJdDrafts((prev) => ({
      ...prev,
      [jobId]: {
        role_name: prev[jobId]?.role_name || '',
        education_requirement: prev[jobId]?.education_requirement || '',
        experience_requirement: prev[jobId]?.experience_requirement || '0',
        gender_requirement: prev[jobId]?.gender_requirement || '',
        skill_entries: prev[jobId]?.skill_entries || [],
        ...patch,
      },
    }));
  };

  const updateJdSkillEntry = (jobId: number, index: number, value: string) => {
    const draft = jdDrafts[jobId];
    if (!draft) return;
    const nextEntries = draft.skill_entries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, score: value } : entry
    );
    updateJdDraft(jobId, { skill_entries: nextEntries });
  };

  const saveJdDetails = async (jobId: number) => {
    const draft = jdDrafts[jobId];
    if (!draft) return;

    setSavingJdId(jobId);
    const formData = new FormData();
    formData.append('job_id', String(jobId));
    formData.append('role_name', draft.role_name);
    formData.append('education_requirement', draft.education_requirement);
    formData.append('experience_requirement', draft.experience_requirement);
    formData.append('gender_requirement', draft.gender_requirement);
    draft.skill_entries.forEach((entry) => {
      formData.append('skill_names[]', entry.skill);
      formData.append('skill_scores[]', entry.score);
    });

    try {
      const response = await api.post('/hr/jd/update', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setEditingJdId(null);
        await fetchDashboard(selectedJdId);
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Failed to update JD');
    } finally {
      setSavingJdId(null);
    }
  };

  const activeJobId = selectedJdId || (latestJd ? String(latestJd.id) : '');

  const runBatchScreening = async () => {
    if (!activeJobId) {
      alert('Select an active JD first');
      return;
    }

    setRunningBatchScreening(true);
    const formData = new FormData();
    formData.append('job_id', activeJobId);

    try {
      const response = await api.post('/hr/jd/rematch', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        await fetchDashboard(activeJobId);
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Failed to re-run screening');
    } finally {
      setRunningBatchScreening(false);
    }
  };

  const openMassScheduler = () => {
    candidateDeskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const downloadMonthlyReport = async () => {
    if (!activeJobId) {
      alert('Select an active JD first');
      return;
    }

    setDownloadingSummary(true);
    try {
      const response = await api.get('/hr/report-summary', {
        params: { job_id: activeJobId },
      });
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hr-report-summary-${activeJobId}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Failed to download report summary');
    } finally {
      setDownloadingSummary(false);
    }
  };

  const pipelineLabel = (status?: string | null) =>
    (status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

  const filteredCandidates = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return shortlistedCandidates;

    return shortlistedCandidates.filter((entry) =>
      `${entry.candidate.name} ${entry.candidate.email} ${entry.candidate_report.summary.overall_recommendation}`
        .toLowerCase()
        .includes(query)
    );
  }, [searchValue, shortlistedCandidates]);

  const healthItems = summary
    ? [
        { label: 'Applied', value: Math.max(summary.total_selected + summary.rejected_candidates, 1), tone: 'default' },
        { label: 'AI Screening', value: Math.max(summary.total_selected, 0), tone: 'brand' },
        { label: 'Interviewing', value: Math.max(summary.in_progress, 0), tone: 'success' },
        { label: 'Offered', value: Math.max(summary.cleared_interview, 0), tone: 'warning' }
      ]
    : [];

  const statusChipClass = (status: string) => {
    if (status === 'selected' || status === 'completed') return 'ib-hr-chip-success';
    if (status === 'rejected' || status === 'flagged') return 'ib-hr-chip-danger';
    if (status === 'in progress' || status === 'scheduled') return 'ib-hr-chip-brand';
    return 'ib-hr-chip';
  };

  const statusText = (entry: CandidateEntry) => {
    const decision = entry.result.hr_decision;
    if (decision) return pipelineLabel(decision);
    if (entry.interview_details.suspicious_activity) return 'Flagged';
    return pipelineLabel(entry.result.pipeline_status || entry.interview_details.status);
  };

  return (
    <div className="ib-shell ib-hr-shell">
      <div className="ib-hr-topbar">
        <div className="ib-hr-topbar-brand">
          <span className="ib-hr-topbar-mark">I</span>
          <span>InterviewBot</span>
        </div>
        <div className="ib-hr-topbar-nav">
          <span className="active">Dashboard</span>
          <span>Jobs</span>
          <span>Candidates</span>
          <span>Analytics</span>
        </div>
        <div className="ib-hr-topbar-actions">
          <input
            className="ib-hr-search"
            placeholder="Search talent..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
          />
          <button type="button" className="ib-hr-icon-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="ib-container ib-panel-stack">
        <section className="ib-hr-hero">
          <div className="ib-hr-hero-badge">★</div>
          <div className="ib-hr-hero-copy">
            <h1>Welcome back, Recruiter</h1>
            <p>
              Senior technical recruiter dashboard. You have {summary?.total_selected || 0} active
              candidate matches and {summary?.completed_reports || 0} reports ready for review.
            </p>
          </div>
          <div className="ib-hr-hero-actions">
            <button type="button" className="btn ib-candidate-primary">Post New Job</button>
            <button type="button" className="btn ib-candidate-secondary">Reports</button>
          </div>
        </section>

        {successMessage && <div className="alert alert-success">{successMessage}</div>}

        <section className="ib-grid ib-grid-3 ib-hr-metric-grid">
          <div className="ib-hr-metric-card">
            <div className="ib-hr-metric-title">Total Candidates</div>
            <strong>{summary ? summary.total_selected + summary.rejected_candidates : 0}</strong>
          </div>
          <div className="ib-hr-metric-card">
            <div className="ib-hr-metric-title">Active Roles</div>
            <strong>{availableJds.length}</strong>
          </div>
          <div className="ib-hr-metric-card">
            <div className="ib-hr-metric-title">Interviews Scheduled</div>
            <strong>{summary?.in_progress || 0}</strong>
          </div>
          <div className="ib-hr-metric-card">
            <div className="ib-hr-metric-title">Reports Ready</div>
            <strong>{summary?.completed_reports || 0}</strong>
          </div>
        </section>

        <section className="ib-hr-main-grid">
          <div className="ib-hr-main-column">
            <section className="ib-hr-card" ref={candidateDeskRef}>
              <div className="ib-hr-card-title">Intelligent Job Ingestion</div>
              <form onSubmit={handleJdUpload} encType="multipart/form-data" className="ib-auth-form">
                <div className="ib-grid ib-grid-2">
                  <div>
                    <label className="ib-label">Role Name</label>
                    <input
                      type="text"
                      name="role_name"
                      className="ib-candidate-input"
                      placeholder="Senior Frontend Engineer"
                      required
                    />
                  </div>
                </div>

                <div className="ib-grid ib-grid-2">
                  <div>
                    <label className="ib-label">Minimum Education</label>
                    <select name="education_requirement" className="ib-candidate-input">
                      <option value="">None</option>
                      <option value="bachelor">Bachelor's</option>
                      <option value="master">Master's</option>
                      <option value="phd">PhD</option>
                    </select>
                  </div>
                  <div>
                    <label className="ib-label">Minimum Experience (Years)</label>
                    <input type="number" name="experience_requirement" className="ib-candidate-input" />
                  </div>
                  <div>
                    <label className="ib-label">Gender Requirement</label>
                    <select name="gender_requirement" className="ib-candidate-input">
                      <option value="">None</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </div>
                </div>

                <label className="ib-hr-upload">
                  <input
                    type="file"
                    name="jd_file"
                    className="d-none"
                    required
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setSelectedJdFileName(e.target.files?.[0]?.name || '')
                    }
                  />
                  <span className="ib-candidate-upload-icon">↑</span>
                  <strong>{selectedJdFileName || 'Drop Job Description PDF or Paste Content'}</strong>
                  <small>
                    {selectedJdFileName
                      ? 'Selected JD ready for extraction'
                      : 'InterviewBot will extract required skills and experience levels'}
                  </small>
                </label>

                <div className="ib-hr-action-row">
                  <span className="ib-hr-muted-action">Clear</span>
                  <button disabled={uploading} className="btn ib-candidate-primary">
                    {uploading ? 'Extracting...' : 'Extract Requirements'}
                  </button>
                </div>
              </form>

              {aiSkills.length > 0 && (
                <form onSubmit={handleConfirmJd} className="ib-auth-form">
                  <div className="ib-hr-card-subtitle">Extracted Skills To Confirm</div>
                  <div className="ib-hr-skill-grid">
                    {aiSkills.map((skill) => (
                      <label key={skill} className="ib-hr-skill-chip">
                        <span>{skill}</span>
                        <input type="hidden" name="skill_names[]" value={skill} />
                        <input type="number" name="skill_scores[]" defaultValue={10} min="0" max="100" className="ib-hr-skill-input" />
                      </label>
                    ))}
                  </div>
                  <button disabled={confirming} className="btn ib-candidate-primary">
                    {confirming ? 'Confirming...' : 'Confirm Skills & Run Matching'}
                  </button>
                </form>
              )}

              {uploadedJd && <div className="ib-candidate-inline-note">Pending JD: <strong>{uploadedJd}</strong></div>}
            </section>

            <section className="ib-hr-card">
              <div className="ib-hr-list-head">
                <div className="ib-hr-card-title">Recent Active Pipelines</div>
                <span className="ib-hr-link">View All</span>
              </div>

              {availableJds.length === 0 ? (
                <p className="text-muted mb-0">No active roles yet. Upload a JD to start the pipeline.</p>
              ) : (
                <div className="ib-hr-role-table">
                  {availableJds.map((jd) => {
                    const isActive = selectedJdId === String(jd.id) || (!selectedJdId && latestJd?.id === jd.id);
                    const isEditing = editingJdId === jd.id;
                    const draft = jdDrafts[jd.id];
                    return (
                    <div key={jd.id} className="ib-hr-role-entry">
                      <div className="ib-hr-role-row">
                        <div>
                          <strong>{jd.role_classification || 'General Role'}</strong>
                          <span>{jd.company_name}</span>
                        </div>
                        <div>{Object.keys(jd.skill_scores || {}).length} skills</div>
                        <div>
                          <span className={isActive ? 'ib-hr-chip-success' : 'ib-hr-chip'}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="ib-hr-role-actions">
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => toggleJdDetails(jd.id)}
                          >
                            {openJdId === jd.id ? 'Close' : 'Open'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            onClick={() => (isEditing ? setEditingJdId(null) : startEditingJd(jd))}
                          >
                            {isEditing ? 'Cancel Edit' : 'Edit'}
                          </button>
                          {!isActive && (
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              onClick={() => activateJd(jd.id)}
                            >
                              Set Active
                            </button>
                          )}
                        </div>
                      </div>

                      {openJdId === jd.id && (
                        <div className="ib-hr-jd-detail-panel">
                          {isEditing && draft ? (
                            <>
                              <div className="ib-detail-item">
                                <strong>Role Name</strong>
                                <input
                                  className="ib-candidate-input"
                                  value={draft.role_name}
                                  onChange={(e) => updateJdDraft(jd.id, { role_name: e.target.value })}
                                />
                              </div>
                              <div className="ib-detail-item">
                                <strong>Uploaded JD File</strong>
                                {jd.jd_text}
                              </div>
                              <div className="ib-detail-item">
                                <strong>Minimum Education</strong>
                                <select
                                  className="ib-candidate-input"
                                  value={draft.education_requirement}
                                  onChange={(e) => updateJdDraft(jd.id, { education_requirement: e.target.value })}
                                >
                                  <option value="">None</option>
                                  <option value="bachelor">Bachelor's</option>
                                  <option value="master">Master's</option>
                                  <option value="phd">PhD</option>
                                </select>
                              </div>
                              <div className="ib-detail-item">
                                <strong>Minimum Experience</strong>
                                <input
                                  type="number"
                                  className="ib-candidate-input"
                                  value={draft.experience_requirement}
                                  onChange={(e) => updateJdDraft(jd.id, { experience_requirement: e.target.value })}
                                />
                              </div>
                              <div className="ib-detail-item">
                                <strong>Gender Requirement</strong>
                                <select
                                  className="ib-candidate-input"
                                  value={draft.gender_requirement}
                                  onChange={(e) => updateJdDraft(jd.id, { gender_requirement: e.target.value })}
                                >
                                  <option value="">None</option>
                                  <option value="Male">Male</option>
                                  <option value="Female">Female</option>
                                </select>
                              </div>
                              <div className="ib-detail-item">
                                <strong>Skill Weights</strong>
                                <div className="ib-hr-edit-skill-list">
                                  {draft.skill_entries.map((entry, index) => (
                                    <div key={entry.skill} className="ib-hr-edit-skill-row">
                                      <span>{entry.skill}</span>
                                      <input
                                        type="number"
                                        className="ib-hr-skill-input"
                                        value={entry.score}
                                        onChange={(e) => updateJdSkillEntry(jd.id, index, e.target.value)}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="ib-hr-jd-panel-actions">
                                <button
                                  type="button"
                                  className="btn ib-candidate-primary"
                                  disabled={savingJdId === jd.id}
                                  onClick={() => saveJdDetails(jd.id)}
                                >
                                  {savingJdId === jd.id ? 'Saving...' : 'Save JD Changes'}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="ib-detail-item">
                                <strong>Role Name</strong>
                                {jd.role_name || jd.role_classification}
                              </div>
                              <div className="ib-detail-item">
                                <strong>Uploaded JD File</strong>
                                {jd.jd_text}
                              </div>
                              <div className="ib-detail-item">
                                <strong>Minimum Education</strong>
                                {jd.education_requirement || 'None'}
                              </div>
                              <div className="ib-detail-item">
                                <strong>Minimum Experience</strong>
                                {jd.experience_requirement ?? 0} years
                              </div>
                              <div className="ib-detail-item">
                                <strong>Gender Requirement</strong>
                                {jd.gender_requirement || 'None'}
                              </div>
                              <div className="ib-detail-item">
                                <strong>Skill Weights</strong>
                                {Object.keys(jd.skill_scores || {}).length === 0
                                  ? 'No skills found'
                                  : Object.entries(jd.skill_scores || {})
                                      .map(([skill, score]) => `${skill}: ${score}`)
                                      .join(', ')}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </section>

            <section className="ib-hr-card">
              <div className="ib-hr-card-title">Candidate Review Desk</div>
              {filteredCandidates.length === 0 ? (
                <p className="text-muted mb-0">No shortlisted candidates for the selected role yet.</p>
              ) : (
                <div className="ib-grid">
                  {filteredCandidates.map((entry) => {
                    const review = reviewDrafts[entry.result.id] || { decision: 'pending', notes: '', feedback: '' };
                    const isOpen = !!visibleDetails[entry.result.id];
                    const badgeText = statusText(entry);

                    return (
                      <article className="ib-hr-candidate-card" key={entry.result.id}>
                        <div className="ib-hr-candidate-top">
                          <div>
                            <div className="fw-semibold">{entry.candidate.name}</div>
                            <div className="small text-muted">{entry.candidate.email}</div>
                          </div>
                          <span className={statusChipClass(badgeText.toLowerCase())}>{badgeText}</span>
                        </div>

                        <div className="ib-hr-candidate-metrics">
                          <div>
                            <label>Screening</label>
                            <strong>{entry.result.score}%</strong>
                          </div>
                          <div>
                            <label>Interview</label>
                            <strong>{entry.interview_details.final_score ?? 'Pending'}</strong>
                          </div>
                          <div>
                            <label>Recommendation</label>
                            <strong>{entry.candidate_report.summary.overall_recommendation}</strong>
                          </div>
                        </div>

                        <div className="d-flex gap-2 flex-wrap">
                          <a
                            href={`http://localhost:8000/${entry.candidate.resume_path}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-outline-dark btn-sm"
                          >
                            Resume
                          </a>
                          <button className="btn btn-outline-primary btn-sm" onClick={() => toggleDetails(entry.result.id)}>
                            {isOpen ? 'Hide Details' : 'View Details'}
                          </button>
                          <button className="btn btn-dark btn-sm" onClick={() => openReport(entry.result.id)}>
                            Open Report
                          </button>
                        </div>

                        {isOpen && (
                          <div className="ib-hr-review-grid">
                            <div className="ib-detail-item">
                              <strong>Missing Skills</strong>
                              {entry.candidate_report.missing_required_skills.join(', ') || 'None'}
                            </div>
                            <div className="ib-detail-item">
                              <strong>Experience</strong>
                              {entry.candidate_report.screening_analysis.experience_detected_years || 0} years
                            </div>
                            <div className="ib-detail-item">
                              <strong>Questions Asked</strong>
                              {entry.candidate_report.interview_analysis.questions_asked}
                            </div>
                            <div className="ib-detail-item">
                              <strong>Violations</strong>
                              {entry.candidate_report.interview_analysis.violation_count}
                            </div>
                            <div className="ib-detail-item">
                              <strong>Average Q Score</strong>
                              {entry.candidate_report.interview_analysis.average_question_score ?? 'Pending'}
                            </div>
                            <div className="ib-detail-item">
                              <strong>Feedback</strong>
                              {entry.interview_details.overall_feedback || 'Pending final interview score'}
                            </div>

                            <div className="ib-grid ib-grid-2">
                              <div>
                                <label className="ib-label">Decision</label>
                                <select
                                  className="ib-candidate-input"
                                  value={review.decision}
                                  onChange={(e) => updateDraft(entry.result.id, { decision: e.target.value as RecruiterDecision })}
                                >
                                  {decisionOptions.map((decision) => (
                                    <option key={decision} value={decision}>
                                      {pipelineLabel(decision)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="ib-label">Final Feedback</label>
                                <input
                                  className="ib-candidate-input"
                                  value={review.feedback}
                                  onChange={(e) => updateDraft(entry.result.id, { feedback: e.target.value })}
                                  placeholder="Short final recommendation"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="ib-label">Recruiter Notes</label>
                              <textarea
                                className="ib-candidate-input ib-hr-notes"
                                value={review.notes}
                                onChange={(e) => updateDraft(entry.result.id, { notes: e.target.value })}
                                placeholder="Add hiring manager notes or follow-up actions"
                              />
                            </div>

                            <button
                              className="btn ib-candidate-primary"
                              disabled={savingReviewId === entry.result.id}
                              onClick={() => saveReview(entry.result.id)}
                            >
                              {savingReviewId === entry.result.id ? 'Saving...' : 'Save Recruiter Review'}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className="ib-hr-side-column">
            <section className="ib-hr-card">
              <div className="ib-hr-card-title">Pipeline Health</div>
              <div className="ib-candidate-pipeline-list">
                {healthItems.map((item) => {
                  const max = Math.max(healthItems[0]?.value || 1, 1);
                  const width = Math.max(8, (item.value / max) * 100);
                  return (
                    <div key={item.label}>
                      <div className="ib-candidate-pipeline-row">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                      <div className="ib-candidate-pipeline-track">
                        <div className={`ib-candidate-pipeline-fill ${item.tone === 'warning' ? 'ib-hr-fill-warning' : item.tone === 'success' ? 'ib-hr-fill-success' : ''}`} style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="ib-hr-insight-box">
                <div className="ib-hr-card-subtitle">AI Insight</div>
                <p>
                  Pipeline for "{latestJd?.role_classification || 'selected role'}" is moving
                  faster than baseline this month.
                </p>
              </div>
            </section>

            <section className="ib-hr-card">
              <div className="ib-hr-card-title">Role Focus</div>
              <div>
                <label className="ib-label">Active Role</label>
                <select className="ib-candidate-input" value={selectedJdId} onChange={handleRoleSelection}>
                  <option value="">Latest Role</option>
                  {availableJds.map((jd) => (
                    <option key={jd.id} value={jd.id}>
                      {(jd.role_name || jd.role_classification)} - {jd.jd_text}
                    </option>
                  ))}
                </select>
              </div>

              {latestJd ? (
                <div className="ib-hr-focus-card">
                  <div className="ib-detail-item">
                    <strong>Role Name</strong>
                    {latestJd.role_name || latestJd.role_classification}
                  </div>
                  <div className="ib-detail-item">
                    <strong>Company</strong>
                    {latestJd.company_name}
                  </div>
                  <div className="ib-detail-item">
                    <strong>JD File</strong>
                    {latestJd.jd_text}
                  </div>
                  <div className="ib-detail-item">
                    <strong>Tracked Skills</strong>
                    {Object.keys(latestJd.skill_scores || {}).length}
                  </div>
                </div>
              ) : (
                <p className="text-muted mb-0">No active role selected.</p>
              )}
            </section>

            <section className="ib-hr-card">
              <div className="ib-hr-card-title">Rapid Actions</div>
              <div className="ib-hr-action-list">
                <div className="ib-hr-quick-action">
                  <strong>Batch AI Screening</strong>
                  <span>Process pending resumes against the active role.</span>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm mt-3"
                    disabled={runningBatchScreening}
                    onClick={runBatchScreening}
                  >
                    {runningBatchScreening ? 'Running...' : 'Run Now'}
                  </button>
                </div>
                <div className="ib-hr-quick-action">
                  <strong>Mass Scheduler</strong>
                  <span>Sync interview calendars after shortlist confirmation.</span>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm mt-3"
                    onClick={openMassScheduler}
                  >
                    Open Candidate Desk
                  </button>
                </div>
                <div className="ib-hr-quick-action">
                  <strong>Monthly HR Report</strong>
                  <span>Download hiring analytics and outcome summaries.</span>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm mt-3"
                    disabled={downloadingSummary}
                    onClick={downloadMonthlyReport}
                  >
                    {downloadingSummary ? 'Preparing...' : 'Download JSON'}
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  );
}

export default DashboardHR;

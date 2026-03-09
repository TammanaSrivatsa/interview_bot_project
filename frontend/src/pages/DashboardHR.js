import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';

function DashboardHR() {
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadedJd, setUploadedJd] = useState('');
  const [aiSkills, setAiSkills] = useState([]);
  const [shortlistedCandidates, setShortlistedCandidates] = useState([]);
  const [visibleDetails, setVisibleDetails] = useState({});
  const [latestJd, setLatestJd] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
      const response = await axios.get('/hr/dashboard');
      setLatestJd(response.data.latest_jd || null);
      setShortlistedCandidates(response.data.shortlisted_candidates || []);
    } catch (error) {
      console.error('Failed to fetch dashboard', error);
    }
  };

  const handleJdUpload = async (e) => {
    e.preventDefault();
    setUploading(true);

    const formData = new FormData(e.target);

    try {
      const response = await axios.post('/upload_jd', formData);
      if (response.data.success) {
        setSuccessMessage('JD uploaded and skills extracted. Review weights before confirming.');
        setUploadedJd(response.data.uploaded_jd);
        setAiSkills(Object.keys(response.data.ai_skills || {}));
      }
    } catch (error) {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmJd = async (e) => {
    e.preventDefault();
    setConfirming(true);

    const formData = new FormData(e.target);

    try {
      const response = await axios.post('/confirm_jd', formData);
      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setAiSkills([]);
        setUploadedJd('');
        fetchDashboard();
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  const toggleDetails = (id) => {
    setVisibleDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const statusChip = (entry) => {
    const details = entry.interview_details;

    if (details?.abandoned || details?.suspicious_activity) {
      return <span className="ib-chip ib-chip-danger">Flagged</span>;
    }

    if (details?.completed) {
      return <span className="ib-chip ib-chip-success">Completed</span>;
    }

    if (entry.result.interview_date) {
      return <span className="ib-chip ib-chip-brand">Scheduled</span>;
    }

    return <span className="ib-chip">Awaiting Candidate</span>;
  };

  return (
    <>
      <Navbar showLogout />
      <div className="ib-shell">
        <div className="ib-container">
          <section className="ib-card ib-p-24 mb-4">
            <div className="ib-kicker">HR Console</div>
            <h2 className="ib-title">Create role, confirm AI scoring, monitor interview pipeline</h2>
            <p className="ib-subtitle mb-0">
              This is the live recruiter workflow: JD upload, skill weight confirmation, then
              shortlist and interview status tracking.
            </p>
          </section>

          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          <section className="ib-grid ib-grid-2 mb-4">
            <div className="ib-card ib-p-24">
              <h5 className="mb-3">Step 1: Upload Job Description</h5>
              <form onSubmit={handleJdUpload} encType="multipart/form-data">
                <label className="ib-label">Company Name</label>
                <input type="text" name="company_name" className="form-control mb-3" required />

                <label className="ib-label">JD PDF / DOC</label>
                <input type="file" name="jd_file" className="form-control mb-3" required />

                <label className="ib-label">Minimum Education</label>
                <select name="education_requirement" className="form-select mb-3">
                  <option value="">None</option>
                  <option value="bachelor">Bachelor's</option>
                  <option value="master">Master's</option>
                  <option value="phd">PhD</option>
                </select>

                <label className="ib-label">Minimum Experience (Years)</label>
                <input type="number" name="experience_requirement" className="form-control mb-3" />

                <label className="ib-label">Gender Requirement (Optional)</label>
                <select name="gender_requirement" className="form-select mb-4">
                  <option value="">None</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>

                <button disabled={uploading} className="btn ib-btn-brand btn-primary w-100">
                  {uploading ? 'Uploading...' : 'Upload JD & Extract Skills'}
                </button>
              </form>
            </div>

            <div className="ib-card ib-p-24 ib-card-soft">
              <h5 className="mb-3">Latest Active Role</h5>
              {latestJd ? (
                <>
                  <div className="ib-status">
                    <strong>Company:</strong> {latestJd.company_name}
                  </div>
                  <div className="ib-status">
                    <strong>JD File:</strong> <span className="ib-mono">{latestJd.jd_text}</span>
                  </div>
                  <div className="ib-status mb-0">
                    <strong>Tracked Skills:</strong> {Object.keys(latestJd.skill_scores || {}).length}
                  </div>
                </>
              ) : (
                <p className="text-muted mb-0">No active JD yet. Upload and confirm one to start screening.</p>
              )}

              {uploadedJd && (
                <div className="alert alert-info mt-3 mb-0">
                  Pending confirmation for file: <strong>{uploadedJd}</strong>
                </div>
              )}
            </div>
          </section>

          {aiSkills.length > 0 && (
            <section className="ib-card ib-p-24 mb-4">
              <h5 className="mb-1">Step 2: Confirm AI-Extracted Skill Weights</h5>
              <p className="text-muted mb-3">
                Weight each skill based on role criticality, then run matching.
              </p>
              <form onSubmit={handleConfirmJd}>
                <div className="ib-grid ib-grid-3">
                  {aiSkills.map((skill, index) => (
                    <div key={index}>
                      <label className="ib-label text-capitalize">{skill}</label>
                      <input type="hidden" name="skill_names[]" value={skill} />
                      <input
                        type="number"
                        name="skill_scores[]"
                        className="form-control"
                        defaultValue={10}
                        min="0"
                        max="100"
                      />
                    </div>
                  ))}
                </div>

                <button disabled={confirming} className="btn btn-success w-100 mt-4">
                  {confirming ? 'Confirming...' : 'Confirm JD & Run AI Matching'}
                </button>
              </form>
            </section>
          )}

          <section className="ib-card ib-p-24">
            <h5 className="mb-3">Shortlisted Candidate Pipeline</h5>
            {shortlistedCandidates.length === 0 ? (
              <p className="text-muted mb-0">No shortlisted candidates for the latest role yet.</p>
            ) : (
              <>
              <div className="table-responsive d-none d-lg-block">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Score</th>
                      <th>Interview Time</th>
                      <th>Status</th>
                      <th>Resume</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortlistedCandidates.map((entry) => {
                      const details = entry.interview_details;
                      const report = entry.candidate_report || {};
                      const screening = report.screening_analysis || {};
                      const interview = report.interview_analysis || {};

                      return (
                        <React.Fragment key={entry.result.id}>
                          <tr>
                            <td>
                              <div className="fw-semibold">{entry.candidate.name}</div>
                              <div className="text-muted small">{entry.candidate.email}</div>
                            </td>
                            <td>{entry.result.score}%</td>
                            <td>{entry.result.interview_date || details?.scheduled_at || 'Not Scheduled'}</td>
                            <td>{statusChip(entry)}</td>
                            <td>
                              <a
                                href={`http://localhost:8000/${entry.candidate.resume_path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-outline-dark btn-sm"
                              >
                                Resume
                              </a>
                            </td>
                            <td>
                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => toggleDetails(entry.result.id)}
                              >
                                {visibleDetails[entry.result.id] ? 'Hide' : 'View'}
                              </button>
                            </td>
                          </tr>

                          {visibleDetails[entry.result.id] && (
                            <tr>
                              <td colSpan="6">
                                <div className="ib-card ib-card-soft ib-p-24">
                                  <h6 className="mb-2">Complete Candidate Interview Report</h6>

                                  <div className="ib-grid ib-grid-2">
                                    <div className="ib-status">
                                      <strong>Candidate Skills:</strong>{" "}
                                      {report.candidate_skills?.join(", ") || "Not detected"}
                                    </div>
                                    <div className="ib-status">
                                      <strong>Missing Required Skills:</strong>{" "}
                                      {report.missing_required_skills?.join(", ") || "None"}
                                    </div>
                                    <div className="ib-status">
                                      <strong>10th Percentage:</strong>{" "}
                                      {report.academic_percentages?.tenth || "N/A"}
                                    </div>
                                    <div className="ib-status">
                                      <strong>Intermediate Percentage:</strong>{" "}
                                      {report.academic_percentages?.intermediate || "N/A"}
                                    </div>
                                    <div className="ib-status">
                                      <strong>Engineering Percentage:</strong>{" "}
                                      {report.academic_percentages?.engineering || "N/A"}
                                    </div>
                                    <div className="ib-status">
                                      <strong>Experience Detected:</strong>{" "}
                                      {screening.experience_detected_years || 0} years
                                    </div>
                                  </div>

                                  <h6 className="mt-3">Screening Analysis</h6>
                                  <ul className="small mb-3">
                                    <li><strong>Overall Score:</strong> {screening.overall_score || 0}%</li>
                                    <li><strong>Semantic Score:</strong> {screening.semantic_score || 0}%</li>
                                    <li><strong>Skill Score:</strong> {screening.skill_score || 0}%</li>
                                    <li><strong>Education Check:</strong> {screening.education_check || "N/A"}</li>
                                    <li><strong>Experience Check:</strong> {screening.experience_check || "N/A"}</li>
                                    <li><strong>Academic Check:</strong> {screening.academic_check || "N/A"}</li>
                                  </ul>

                                  <h6 className="mt-3">Interview Process Analysis</h6>
                                  <ul className="small mb-3">
                                    <li><strong>Status:</strong> {interview.status || details?.status || "not_started"}</li>
                                    <li><strong>Started At:</strong> {interview.started_at || details?.started_at || "N/A"}</li>
                                    <li><strong>Ended At:</strong> {interview.ended_at || details?.ended_at || "N/A"}</li>
                                    <li>
                                      <strong>Total Duration:</strong>{" "}
                                      {typeof interview.duration_seconds === "number"
                                        ? `${Math.floor(interview.duration_seconds / 60)}m ${interview.duration_seconds % 60}s`
                                        : "N/A"}
                                    </li>
                                    <li><strong>Questions Asked:</strong> {interview.questions_asked || 0}</li>
                                    <li><strong>Questions Answered:</strong> {interview.questions_answered || 0}</li>
                                    <li><strong>Questions Unanswered:</strong> {interview.questions_unanswered || 0}</li>
                                    <li><strong>Average Answer Length:</strong> {interview.avg_answer_words || 0} words</li>
                                    <li><strong>Suspicious Activity:</strong> {interview.suspicious_activity ? "Yes" : "No"}</li>
                                    <li><strong>Violation Count:</strong> {interview.violation_count || 0}</li>
                                  </ul>

                                  <h6 className="mt-3">What Candidate Was Doing (Behavior)</h6>
                                  {details?.behavior_summary && Object.keys(details.behavior_summary).length > 0 ? (
                                    <pre className="small bg-white border rounded p-2">
                                      {JSON.stringify(details.behavior_summary, null, 2)}
                                    </pre>
                                  ) : (
                                    <p className="small text-muted mb-3">No behavior summary available.</p>
                                  )}

                                  <h6 className="mt-3">Suspicious Activities</h6>
                                  {details?.violations?.length > 0 ? (
                                    <ul className="small text-danger mb-3">
                                      {details.violations.map((v, i) => (
                                        <li key={i}>
                                          {(v.reason || "Violation")} — {v.time || "Unknown time"}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="small text-muted mb-3">No suspicious activities recorded.</p>
                                  )}

                                  <h6 className="mt-3">Questions Asked by Bot and Candidate Answers</h6>
                                  {(details?.qa_transcript?.length > 0 || details?.qa_logs?.length > 0) ? (
                                    <div className="small">
                                      {(details.qa_transcript || details.qa_logs).map((qa, index) => (
                                        <div key={index} className="mb-3">
                                          <div><strong>Q{index + 1}:</strong> {qa.question || qa.question_text}</div>
                                          <div><strong>A{index + 1}:</strong> {qa.answer || "No answer recorded"}</div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="small text-muted mb-3">No Q/A transcript available.</p>
                                  )}

                                  <h6 className="mt-3">Interview Timeline</h6>
                                  {details?.timeline?.length > 0 ? (
                                    <ul className="small text-muted">
                                      {details.timeline.map((event, i) => (
                                        <li key={i}>
                                          {event.time} — {event.event || event.description}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="small text-muted mb-0">No timeline events recorded.</p>
                                  )}

                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="d-lg-none">
                {shortlistedCandidates.map((entry) => {
                  const details = entry.interview_details;
                  const report = entry.candidate_report || {};
                  const screening = report.screening_analysis || {};
                  const interview = report.interview_analysis || {};
                  const isOpen = !!visibleDetails[entry.result.id];

                  return (
                    <div className="ib-card ib-card-soft ib-p-24 mb-3" key={entry.result.id}>
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <div className="fw-semibold">{entry.candidate.name}</div>
                          <div className="small text-muted">{entry.candidate.email}</div>
                        </div>
                        {statusChip(entry)}
                      </div>
                      <div className="small mt-2">
                        <div><strong>Score:</strong> {entry.result.score}%</div>
                        <div><strong>Interview:</strong> {entry.result.interview_date || details?.scheduled_at || 'Not Scheduled'}</div>
                      </div>
                      <div className="d-flex gap-2 mt-3">
                        <a
                          href={`http://localhost:8000/${entry.candidate.resume_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-dark btn-sm"
                        >
                          Resume
                        </a>
                        <button
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => toggleDetails(entry.result.id)}
                        >
                          {isOpen ? 'Hide Report' : 'View Report'}
                        </button>
                      </div>

                      {isOpen && (
                        <div className="mt-3">
                          <div className="small text-muted mb-2">
                            <strong>Status:</strong> {details?.status || 'not_started'} <br />
                            <strong>Started:</strong> {details?.started_at || 'N/A'} <br />
                            <strong>Ended:</strong> {details?.ended_at || 'N/A'}
                          </div>
                          <div className="small mb-2">
                            <strong>Skills:</strong> {report.candidate_skills?.join(', ') || 'Not detected'}
                          </div>
                          <div className="small mb-2">
                            <strong>10th/Inter/Eng:</strong> {report.academic_percentages?.tenth || 'N/A'} / {report.academic_percentages?.intermediate || 'N/A'} / {report.academic_percentages?.engineering || 'N/A'}
                          </div>
                          <div className="small mb-2">
                            <strong>Score:</strong> {screening.overall_score || 0}% | <strong>Violations:</strong> {interview.violation_count || 0}
                          </div>
                          <div className="small mb-2">
                            <strong>Q/A Count:</strong> {interview.questions_asked || details?.qa_transcript?.length || 0}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default DashboardHR;

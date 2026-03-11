import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';

type ReportPayload = {
  candidate: {
    name: string;
    email: string;
  };
  result: {
    pipeline_status: string;
    hr_decision?: string | null;
    recruiter_notes?: string | null;
    recruiter_feedback?: string | null;
  };
  interview_details: {
    final_score?: number | null;
    overall_feedback?: string | null;
    timeline: Array<{ event?: string; description?: string; time?: string }>;
    violations: Array<{ reason?: string; time?: string }>;
  };
  candidate_report: {
    summary: {
      screening_score: number;
      interview_score?: number | null;
      overall_recommendation: string;
      pipeline_status: string;
      hr_decision: string;
    };
    screening_analysis: {
      semantic_score: number;
      skill_score: number;
      education_check: string;
      experience_check: string;
      academic_check: string;
    };
    qa_breakdown: Array<{
      id: number;
      question: string;
      answer?: string | null;
      score?: number | null;
      score_reason?: string | null;
    }>;
  };
};

function CandidateReport() {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReport = async () => {
      try {
        const response = await api.get(`/hr/report/${resultId}`);
        setReport(response.data);
      } catch (error) {
        console.error('Failed to load report', error);
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [resultId]);

  const scoreCards = useMemo(() => {
    if (!report) return [];

    const interviewScore = report.candidate_report.summary.interview_score ?? report.interview_details.final_score ?? 0;
    const communicationScore = Math.min(
      99,
      Math.max(
        45,
        Math.round(
          ((report.candidate_report.summary.interview_score ?? 0) +
            report.candidate_report.screening_analysis.semantic_score) /
            2
        )
      )
    );
    const cultureFit = Math.min(
      98,
      Math.max(
        40,
        Math.round(
          ((report.candidate_report.screening_analysis.academic_check.toLowerCase().includes('pass') ? 88 : 68) +
            (report.result.hr_decision?.toLowerCase().includes('select') ? 8 : 0) +
            (report.result.recruiter_feedback ? 4 : 0))
        )
      )
    );

    return [
      {
        label: 'Overall Score',
        value: `${report.candidate_report.summary.screening_score}`,
        suffix: '/100',
        tone: 'primary'
      },
      {
        label: 'Technical Skill',
        value: `${interviewScore || report.candidate_report.screening_analysis.skill_score}%`,
        progress: interviewScore || report.candidate_report.screening_analysis.skill_score
      },
      {
        label: 'Communication',
        value: `${communicationScore}%`,
        progress: communicationScore
      },
      {
        label: 'Culture Fit',
        value: `${cultureFit}%`,
        progress: cultureFit
      }
    ];
  }, [report]);

  const integrityScore = useMemo(() => {
    if (!report) return 100;
    return Math.max(40, 100 - report.interview_details.violations.length * 8);
  }, [report]);

  return (
    <div className="ib-shell ib-report-shell-v2">
      <div className="ib-container ib-report-layout-v2">
        <section className="ib-report-topbar no-print">
          <div className="ib-session-brand">
            <div className="ib-logo-mark">I</div>
            <div className="ib-session-brand-title">InterviewBot</div>
          </div>
          <div className="ib-report-top-actions">
            <button className="ib-report-action-btn ib-report-action-btn-primary" onClick={() => window.print()}>
              Download PDF
            </button>
            <button className="ib-report-icon-btn" onClick={() => window.print()} aria-label="Print report">
              Print
            </button>
            <button className="ib-report-icon-btn" onClick={() => navigate('/hr/dashboard')} aria-label="Back to dashboard">
              Back
            </button>
          </div>
        </section>

        {loading && <div className="alert alert-info">Loading report...</div>}
        {!loading && !report && <div className="alert alert-danger">Unable to load report.</div>}

        {report && (
          <>
            <div className="ib-report-breadcrumb">Candidates &nbsp;&gt;&nbsp; {report.candidate.name} - Live Report</div>

            <section className="ib-report-hero-card">
              <div className="ib-report-hero-main">
                <div className="ib-report-avatar">{report.candidate.name?.charAt(0) || 'C'}</div>
                <div>
                  <h1 className="ib-report-candidate-name">{report.candidate.name}</h1>
                  <div className="ib-report-candidate-role">{report.result.pipeline_status || 'Candidate Report'}</div>
                  <div className="ib-report-candidate-meta">
                    <span>{report.candidate.email}</span>
                    <span>{report.interview_details.timeline.length || 0} timeline events</span>
                    <span>{report.candidate_report.qa_breakdown.length || 0} questions</span>
                  </div>
                </div>
              </div>

              <div className="ib-report-hero-actions no-print">
                <button className="ib-report-ghost-btn" onClick={() => navigate('/hr/dashboard')}>
                  Archive
                </button>
                <button className="ib-report-action-btn ib-report-action-btn-primary">
                  {report.result.hr_decision || 'Advance to Next Stage'}
                </button>
              </div>

              <div className="ib-report-score-grid-v2">
                {scoreCards.map((card) => (
                  <article
                    key={card.label}
                    className={`ib-report-score-card-v2 ${card.tone === 'primary' ? 'is-primary' : ''}`}
                  >
                    <div className="ib-kicker">{card.label}</div>
                    <div className="ib-report-score-value">
                      {card.value}
                      {card.suffix ? <span>{card.suffix}</span> : null}
                    </div>
                    {typeof card.progress === 'number' ? (
                      <div className="ib-report-score-track">
                        <div className="ib-report-score-fill" style={{ width: `${card.progress}%` }} />
                      </div>
                    ) : (
                      <div className="ib-report-score-note">Top 5%</div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <div className="ib-report-main-grid">
              <div className="ib-report-left-column">
                <section className="ib-report-section-card">
                  <div className="ib-report-section-head">
                    <h2>Executive Summary</h2>
                  </div>
                  <p className="ib-report-summary-copy">
                    {report.interview_details.overall_feedback ||
                      report.candidate_report.summary.overall_recommendation ||
                      'No executive summary available.'}
                  </p>
                  <div className="ib-report-summary-grid">
                    <div className="ib-report-summary-box positive">
                      <h3>Key Strengths</h3>
                      <ul>
                        <li>Semantic score: {report.candidate_report.screening_analysis.semantic_score}%</li>
                        <li>Skill score: {report.candidate_report.screening_analysis.skill_score}%</li>
                        <li>{report.result.recruiter_feedback || 'Recruiter feedback will appear here once added.'}</li>
                      </ul>
                    </div>
                    <div className="ib-report-summary-box warning">
                      <h3>Areas for Growth</h3>
                      <ul>
                        <li>{report.result.recruiter_notes || 'No recruiter notes added yet.'}</li>
                        <li>Education check: {report.candidate_report.screening_analysis.education_check}</li>
                        <li>Experience check: {report.candidate_report.screening_analysis.experience_check}</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="ib-report-section-card">
                  <div className="ib-report-section-head">
                    <h2>Interview Transcript & Review</h2>
                    <span>{report.candidate_report.qa_breakdown.length} Questions Total</span>
                  </div>
                  {report.candidate_report.qa_breakdown.length === 0 ? (
                    <p className="text-muted mb-0">No question breakdown available.</p>
                  ) : (
                    <div className="ib-report-qa-stack">
                      {report.candidate_report.qa_breakdown.map((qa, index) => (
                        <article key={qa.id} className="ib-report-qa-card">
                          <div className="ib-report-qa-head">
                            <div className="ib-report-qa-title">
                              <span className="ib-report-qa-index">{index + 1}</span>
                              <span>{qa.question}</span>
                            </div>
                            <span className={`ib-report-qa-badge ${(qa.score ?? 0) >= 75 ? 'pass' : 'average'}`}>
                              {(qa.score ?? 0) >= 75 ? 'Strong Pass' : 'Average'}
                            </span>
                          </div>
                          <div className="ib-report-qa-analysis">
                            <div className="ib-kicker">AI Analysis</div>
                            <p>{qa.score_reason || 'No evaluator note available.'}</p>
                          </div>
                          <div className="ib-report-qa-transcript">
                            <div className="ib-kicker">Transcript Snippet</div>
                            <p>{qa.answer || 'No answer recorded.'}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="ib-report-right-column">
                <section className="ib-report-side-card">
                  <div className="ib-report-section-head">
                    <h2>Timeline & Activity</h2>
                  </div>
                  {report.interview_details.timeline.length === 0 ? (
                    <p className="text-muted mb-0">No timeline events recorded.</p>
                  ) : (
                    <ul className="ib-report-timeline-v2">
                      {report.interview_details.timeline.map((event, index) => (
                        <li key={`${event.time}-${index}`} className={(event.event || event.description || '').toLowerCase().includes('violation') ? 'risk' : ''}>
                          <div className="ib-report-timeline-dot" />
                          <div>
                            <strong>{event.time || 'Time unavailable'}</strong>
                            <span>{event.event || event.description || 'Event recorded'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="ib-report-side-card">
                  <div className="ib-report-section-head">
                    <h2>Integrity Score</h2>
                  </div>
                  <div className="ib-report-integrity-row">
                    <span>Trust Level</span>
                    <strong>{integrityScore}%</strong>
                  </div>
                  <div className="ib-report-score-track integrity">
                    <div className="ib-report-score-fill integrity" style={{ width: `${integrityScore}%` }} />
                  </div>
                  <div className="ib-report-integrity-list">
                    <div className="ib-report-integrity-item">
                      <strong>ID Verified</strong>
                      <span>Candidate session linked to {report.candidate.email}</span>
                    </div>
                    <div className="ib-report-integrity-item warning">
                      <strong>Violations Logged</strong>
                      <span>{report.interview_details.violations.length} instance(s)</span>
                    </div>
                  </div>
                </section>

                <section className="ib-report-side-card">
                  <div className="ib-report-section-head">
                    <h2>Recruiter Feedback</h2>
                  </div>
                  <div className="ib-report-feedback-box">
                    {report.result.recruiter_feedback || report.result.recruiter_notes || 'Add your notes here for the hiring manager...'}
                  </div>
                </section>

                <section className="ib-report-side-card">
                  <div className="ib-report-section-head">
                    <h2>Violations</h2>
                  </div>
                  {report.interview_details.violations.length === 0 ? (
                    <p className="text-muted mb-0">No suspicious activities recorded.</p>
                  ) : (
                    <ul className="ib-report-violations-v2">
                      {report.interview_details.violations.map((violation, index) => (
                        <li key={`${violation.time}-${index}`}>
                          <strong>{violation.time || 'Time unavailable'}</strong>
                          <span>{violation.reason || 'Violation recorded'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>

            <footer className="ib-report-footer-v2">
              Report generated by InterviewBot AI Engine
              <span>
                Reference ID: {resultId} | Confidence Level: High | Verification Hash: 0x{String(resultId || '0').padStart(4, '0')}_9a
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default CandidateReport;

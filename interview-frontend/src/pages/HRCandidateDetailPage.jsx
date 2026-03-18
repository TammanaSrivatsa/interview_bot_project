import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Download,
  Mail,
  Sparkles,
  Target,
  XCircle,
  Zap,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import { hrApi } from "../services/api";

function downloadHref(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getStatusLabel(status) {
  if (!status) return "Unknown";
  if (typeof status === "string") return status;
  return status.label || status.value || "Unknown";
}

export default function HRCandidateDetailPage() {
  const { candidateUid } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTabId, setActiveTabId] = useState("resume");

  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [message, setMessage] = useState("");

  const [skillGapData, setSkillGapData] = useState(null);
  const [loadingSkillGap, setLoadingSkillGap] = useState(false);

  const loadCandidate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await hrApi.candidateDetail(candidateUid);
      setData(response);
      setMessage("");
    } catch (loadError) {
      setError(loadError.message || "Failed to load candidate details.");
    } finally {
      setLoading(false);
    }
  }, [candidateUid]);

  useEffect(() => {
    loadCandidate();
  }, [loadCandidate]);

  const candidate = data?.candidate || null;
  const latestApplication = data?.applications?.[0] || null;

  useEffect(() => {
    async function loadSkillGap() {
      if (!candidateUid) return;

      setLoadingSkillGap(true);
      try {
        const jobId = latestApplication?.job?.id || 1;
        const response = await hrApi.skillGap(candidateUid, jobId);
        setSkillGapData(response?.skill_gap || null);
      } catch (skillGapError) {
        console.error("Failed to load skill gap:", skillGapError);
        setSkillGapData(null);
      } finally {
        setLoadingSkillGap(false);
      }
    }

    if (data?.candidate) {
      loadSkillGap();
    }
  }, [candidateUid, latestApplication, data]);

  async function handleGenerateQuestions() {
    if (!data?.candidate?.id) return;

    setGeneratingQuestions(true);
    setError("");
    setMessage("");

    try {
      const response = await hrApi.generateQuestions(data.candidate.id);
      setMessage(`Generated ${response.total_questions} questions for this candidate.`);
      await loadCandidate();
    } catch (actionError) {
      setError(actionError.message || "Failed to generate questions.");
    } finally {
      setGeneratingQuestions(false);
    }
  }

  const tabs = [
    { id: "resume", label: "Resume Analysis", icon: Briefcase },
    { id: "applications", label: "Applications", icon: Calendar },
    { id: "questions", label: "Question Set", icon: Target },
    { id: "notes", label: "Advice", icon: AlertCircle },
  ];

  if (loading) {
    return <p className="center muted">Loading candidate detail...</p>;
  }

  if (error && !data) {
    return <p className="alert error">{error}</p>;
  }

  if (!candidate) {
    return <p className="muted">Candidate not found.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          to="/hr/candidates"
          className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 transition-colors font-medium"
        >
          <ArrowLeft size={20} />
          <span>Back to Candidates</span>
        </Link>

        <div className="flex items-center gap-3">
          {candidate.resume_path ? (
            <a
              href={downloadHref(candidate.resume_path)}
              target="_blank"
              rel="noreferrer"
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center space-x-2"
            >
              <Download size={20} />
              <span>Open Resume</span>
            </a>
          ) : null}

          <button
            type="button"
            onClick={handleGenerateQuestions}
            disabled={generatingQuestions}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-200 dark:shadow-none disabled:opacity-60"
          >
            {generatingQuestions ? "Generating..." : "Generate Questions"}
          </button>
        </div>
      </div>

      {error ? <p className="alert error">{error}</p> : null}

      {message ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3">
          {message}
        </p>
      ) : null}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-700" />

        <div className="px-8 pb-8">
          <div className="relative flex flex-col md:flex-row md:items-end -mt-12 md:space-x-8">
            <div className="w-32 h-32 rounded-3xl border-4 border-white dark:border-slate-900 overflow-hidden shadow-lg bg-slate-100">
              {candidate.avatar ? (
                <img
                  src={candidate.avatar}
                  alt={candidate.name || "Candidate"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                  No Image
                </div>
              )}
            </div>

            <div className="flex-1 mt-6 md:mt-0 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center space-x-3">
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">
                    {candidate.name}
                  </h1>
                  <StatusBadge status={candidate.finalDecision} />
                </div>

                <p className="text-lg text-slate-500 dark:text-slate-400 mt-1">
                  {candidate.role || "Role not available"} | {candidate.candidate_uid || candidateUid}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 text-sm font-medium">
                  <Mail size={16} className="mr-2" />
                  {candidate.email || "No email"}
                </div>

                <div className="flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 text-sm font-medium">
                  <Calendar size={16} className="mr-2" />
                  {candidate.created_at
                    ? new Date(candidate.created_at).toLocaleDateString()
                    : "Unknown date"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex p-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center space-x-2 px-6 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
              activeTabId === tab.id
                ? "bg-blue-600 text-white shadow-lg shadow-blue-100 dark:shadow-none"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            <tab.icon size={18} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {activeTabId === "resume" ? (
            <>
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
                    <Zap className="text-yellow-500 mr-2" size={24} />
                    Resume Match Analysis
                  </h3>

                  <div className="text-right">
                    <span className="text-4xl font-black text-blue-600">
                      {Math.round(Number(candidate.resumeScore || 0))}%
                    </span>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                      Overall Match
                    </p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Matched Skills
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {candidate.matchedSkills?.length ? (
                        candidate.matchedSkills.map((skill) => (
                          <span
                            key={skill}
                            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold border border-emerald-100 dark:border-emerald-800/50"
                          >
                            {skill}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          No matched skills reported.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Missing Skills
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {candidate.missingSkills?.length ? (
                        candidate.missingSkills.map((skill) => (
                          <span
                            key={skill}
                            className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-xs font-bold border border-red-100 dark:border-red-800/50"
                          >
                            {skill}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          No major gaps reported.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center">
                    <CheckCircle2 className="text-emerald-500 mr-2" size={20} />
                    Strengths
                  </h4>

                  <ul className="space-y-4">
                    {(candidate.strengths || []).map((strength) => (
                      <li
                        key={strength}
                        className="flex items-start text-sm text-slate-600 dark:text-slate-300"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 mr-3 flex-shrink-0" />
                        {strength}
                      </li>
                    ))}

                    {!candidate.strengths?.length ? (
                      <li className="text-sm text-slate-500 dark:text-slate-400">
                        No strengths captured yet.
                      </li>
                    ) : null}
                  </ul>
                </div>

                <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center">
                    <XCircle className="text-red-500 mr-2" size={20} />
                    Rewrite Tips
                  </h4>

                  <ul className="space-y-4">
                    {(candidate.rewriteTips || []).map((tip) => (
                      <li
                        key={tip}
                        className="flex items-start text-sm text-slate-600 dark:text-slate-300"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-2 mr-3 flex-shrink-0" />
                        {tip}
                      </li>
                    ))}

                    {!candidate.rewriteTips?.length ? (
                      <li className="text-sm text-slate-500 dark:text-slate-400">
                        No rewrite advice available yet.
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>

              {loadingSkillGap ? (
                <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Loading skill gap analysis...
                  </p>
                </div>
              ) : null}

              {skillGapData ? (
                <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
                      <TrendingUp className="text-blue-600 mr-2" size={24} />
                      Skill Gap Analysis
                    </h3>

                    <div className="text-right">
                      <span className="text-4xl font-black text-green-600">
                        {skillGapData.match_percentage || 0}%
                      </span>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                        Match Score
                      </p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center">
                        <CheckCircle2 className="text-emerald-500 mr-2" size={18} />
                        Matched Skills
                      </h4>

                      <div className="flex flex-wrap gap-2">
                        {(skillGapData.matched_skills || []).map((skill) => (
                          <span
                            key={skill}
                            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold border border-emerald-100 dark:border-emerald-800/50"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center">
                        <XCircle className="text-red-500 mr-2" size={18} />
                        Missing Skills
                      </h4>

                      <div className="flex flex-wrap gap-2">
                        {(skillGapData.missing_skills || []).map((skill) => (
                          <span
                            key={skill}
                            className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-xs font-bold border border-red-100 dark:border-red-800/50"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {skillGapData.recommendations?.length ? (
                    <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 flex items-center">
                        <TrendingDown className="text-blue-600 mr-2" size={18} />
                        Recommendations
                      </h4>

                      <ul className="space-y-3">
                        {skillGapData.recommendations.map((rec, idx) => (
                          <li
                            key={idx}
                            className="flex items-start text-sm text-slate-600 dark:text-slate-300"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 mr-3 flex-shrink-0" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {activeTabId === "applications" ? (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                Applications
              </h3>

              <div className="space-y-4">
                {(data.applications || []).length ? (
                  data.applications.map((application) => (
                    <div
                      key={application.result_id || application.application_id}
                      className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <p className="text-lg font-bold text-slate-900 dark:text-white">
                            {application.job?.title || "Selected role"}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {application.application_id || "N/A"} | Score{" "}
                            {Math.round(Number(application.resumeScore || 0))}%
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <StatusBadge status={application.status} />
                          <StatusBadge status={application.finalDecision} />
                        </div>
                      </div>

                      <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm text-slate-600 dark:text-slate-300">
                        <p>
                          Interview date:{" "}
                          {application.interview_date
                            ? new Date(application.interview_date).toLocaleString()
                            : "Not scheduled"}
                        </p>
                        <p>
                          Interview link: {application.interview_link ? "Available" : "Not created"}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No applications available.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {activeTabId === "questions" ? (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                  Generated Question Set
                </h3>

                <button
                  type="button"
                  onClick={handleGenerateQuestions}
                  disabled={generatingQuestions}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-60"
                >
                  {generatingQuestions ? "Generating..." : "Regenerate"}
                </button>
              </div>

              {(data.generated_questions || []).length ? (
                <div className="space-y-4">
                  {data.generated_questions.map((question) => (
                    <div
                      key={`${question.index}-${question.text}`}
                      className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800"
                    >
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2">
                        Question {question.index} | {question.type} | {question.difficulty}
                      </p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {question.text}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Topic: {question.topic}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No questions stored yet. Use Generate Questions to create them from the
                  resume and selected JD.
                </p>
              )}
            </div>
          ) : null}

          {activeTabId === "notes" ? (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center">
                <Sparkles className="text-blue-600 mr-2" size={22} />
                Resume Advice
              </h3>

              <div className="space-y-4">
                {(data.resume_advice?.next_steps || []).length ? (
                  data.resume_advice.next_steps.map((item) => (
                    <div
                      key={item}
                      className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300"
                    >
                      {item}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No resume advice available yet.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6">
              Decision Card
            </h4>

            <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50 mb-6">
              <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-2">
                Current Recommendation
              </p>
              <h5 className="text-2xl font-black text-blue-800 dark:text-blue-300">
                {getStatusLabel(candidate.finalDecision)}
              </h5>
              <p className="text-sm text-blue-700 dark:text-blue-400/80 mt-3 leading-relaxed">
                Latest application score:{" "}
                {Math.round(Number(candidate.finalAIScore || candidate.resumeScore || 0))}% for{" "}
                {latestApplication?.job?.title || "the selected role"}.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-sm text-slate-500 dark:text-slate-400">Resume</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {Math.round(Number(candidate.resumeScore || 0))}%
                </span>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-sm text-slate-500 dark:text-slate-400">Semantic</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {Math.round(Number(candidate.semanticScore || 0))}%
                </span>
              </div>

              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">Interview</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {candidate.interviewScore === null || candidate.interviewScore === undefined
                    ? "N/A"
                    : `${Math.round(Number(candidate.interviewScore))}%`}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6">
              Timeline
            </h4>

            <div className="space-y-6">
              {(data.applications || []).length ? (
                data.applications.map((application, index) => (
                  <div
                    key={application.result_id || application.application_id || index}
                    className="relative pl-6 pb-6 border-l-2 border-slate-100 dark:border-slate-800 last:pb-0"
                  >
                    <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-blue-500 border-2 border-white dark:border-slate-900" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {index === 0 ? "Latest application" : `Application ${index + 1}`}
                    </p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {application.job?.title || "Selected role"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {getStatusLabel(application.status)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No timeline data available.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

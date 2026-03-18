import { useEffect, useMemo, useState } from "react";
import { Upload, CheckCircle2, AlertCircle, ArrowRight, Play, FileSearch, Clock, Calendar, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import StepChecklist from "../components/StepChecklist";
import { candidateApi } from "../services/api";
import { cn } from "../utils/utils";

function routeFromInterviewLink(interviewLink) {
  if (!interviewLink) return "";
  try { return new URL(interviewLink).pathname; } catch { return interviewLink; }
}

// ── Skill Match Table ────────────────────────────────────────────────────────
function SkillMatchTable({ explanation, selectedJd }) {
  const weights = selectedJd?.weights_json || {};
  const matchedSet = new Set((explanation?.matched_skills || []).map((s) => s.toLowerCase()));
  const missingSet = new Set((explanation?.missing_skills || []).map((s) => s.toLowerCase()));

  const allSkills = Object.keys(weights).length > 0
    ? Object.entries(weights).map(([skill, weight]) => ({
        skill,
        weight: Number(weight),
        found: matchedSet.has(skill.toLowerCase()),
      }))
    : [
        ...(explanation?.matched_skills || []).map((s) => ({ skill: s, weight: "—", found: true })),
        ...(explanation?.missing_skills || []).map((s) => ({ skill: s, weight: "—", found: false })),
      ];

  if (!allSkills.length) return null;

  const overallScore = Math.round(Number(explanation?.final_resume_score || explanation?.weighted_skill_score || 0));
  const matchedCount = allSkills.filter((s) => s.found).length;

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Skill</th>
            <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">JD Weight</th>
            <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Found in Resume</th>
            <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Match</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {allSkills.map(({ skill, weight, found }) => (
            <tr key={skill} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td className="px-4 py-3 font-medium text-slate-900 dark:text-white capitalize">{skill}</td>
              <td className="px-4 py-3 text-center">
                {weight !== "—" ? (
                  <span className="inline-block w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">
                    {weight}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-center text-sm text-slate-600 dark:text-slate-300">
                {found ? "Yes" : "No"}
              </td>
              <td className="px-4 py-3 text-center">
                {found ? (
                  <CheckCircle2 size={18} className="text-emerald-500 mx-auto" />
                ) : (
                  <AlertCircle size={18} className="text-red-400 mx-auto" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-t-2 border-slate-200 dark:border-slate-700">
            <td className="px-4 py-3 font-bold text-slate-900 dark:text-white" colSpan={2}>
              Overall Score — {matchedCount} / {allSkills.length} skills matched
            </td>
            <td className="px-4 py-3 text-center font-black text-lg text-blue-600 dark:text-blue-400" colSpan={2}>
              {overallScore} / 100
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function CandidateDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [message, setMessage] = useState("");

  const selectedJd = useMemo(() => {
    return (dashboard?.available_jds || []).find((jd) => jd.id === dashboard?.selected_jd_id) || null;
  }, [dashboard]);

  const result = dashboard?.result || null;
  const explanation = result?.explanation || {};
  const resumeAdvice = dashboard?.resume_advice || null;
  const interviewRoute = routeFromInterviewLink(result?.interview_link);
  const interviewReady = Boolean(result?.interview_ready && interviewRoute);
  const interviewCompleted = Boolean(result?.interview_completed);
  const finalDecision = result?.final_decision || null;
  const canScheduleInterview = Boolean(result?.shortlisted) && !interviewCompleted && !finalDecision;
  const showStartInterview = interviewReady && !interviewCompleted && !finalDecision;
  const interviewSessionStatus = String(result?.interview_session_status || "").toLowerCase();

  async function loadDashboard(jobId) {
    setLoading(true);
    setError("");
    try {
      const response = await candidateApi.dashboard(jobId);
      setDashboard(response);
      setMessage("");
      if (response?.result?.interview_date) setScheduleDate(String(response.result.interview_date).slice(0, 16));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadDashboard(); }, []);

  async function handleSelectJd(e) {
    const jdId = Number(e.target.value);
    try { await candidateApi.selectJd(jdId); await loadDashboard(jdId); }
    catch (e) { setError(e.message); }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !dashboard?.selected_jd_id) return;
    setUploading(true); setError(""); setMessage("");
    try {
      const response = await candidateApi.uploadResume(file, dashboard.selected_jd_id);
      setDashboard(response);
      setMessage("Resume uploaded and scored successfully.");
    } catch (e) { setError(e.message); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function handleScheduleInterview() {
    if (!result?.id || !scheduleDate) { setError("Pick a date first."); return; }
    setScheduling(true); setError(""); setMessage("");
    try {
      const response = await candidateApi.scheduleInterview(result.id, scheduleDate);
      setDashboard((c) => c ? { ...c, result: response.result } : c);
      setMessage(response.message || "Interview scheduled.");
    } catch (e) { setError(e.message); }
    finally { setScheduling(false); }
  }

  const steps = [
    { title: "Account ready", description: "Profile active", completed: true },
    { title: "JD selected", description: selectedJd ? selectedJd.title : "Select a role to apply", completed: Boolean(selectedJd) },
    { title: "Resume uploaded", description: dashboard?.candidate?.resume_path ? "Resume stored" : "Upload your resume", completed: Boolean(dashboard?.candidate?.resume_path) },
    { title: "AI screening", description: result ? "Resume scored against JD" : "Pending", completed: Boolean(result) },
    { title: "Interview stage", description: interviewCompleted ? "Interview submitted" : interviewReady ? "Ready to start" : "Pending scheduling", completed: Boolean(interviewReady || interviewCompleted || finalDecision) },
  ];

  if (loading) return <p className="center muted">Loading workspace...</p>;
  if (error && !dashboard) return <p className="alert error">{error}</p>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">Candidate Workspace</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Select a JD, upload your resume, and track your application.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => loadDashboard(dashboard?.selected_jd_id)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center space-x-2">
            <RefreshCw size={16} /><span>Refresh</span>
          </button>
          {showStartInterview && (
            <Link to={interviewRoute}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-200 dark:shadow-none flex items-center space-x-2">
              <span>{interviewSessionStatus === "in_progress" ? "Resume Interview" : "Start Interview"}</span>
              <ArrowRight size={18} />
            </Link>
          )}
        </div>
      </div>

      {error && <p className="alert error">{error}</p>}
      {message && <p className="alert success">{message}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">

          {/* JD select + resume upload card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Apply for Role</h2>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Select a JD then upload your resume.</p>
              </div>
              <select value={dashboard?.selected_jd_id || ""} onChange={handleSelectJd}
                className="w-full md:w-80 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white">
                <option value="" disabled>Select a JD</option>
                {(dashboard?.available_jds || []).map((jd) => (
                  <option key={jd.id} value={jd.id}>{jd.title}</option>
                ))}
              </select>
            </div>

            <div className="p-8">
              <label className={cn(
                "relative flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-10 transition-all cursor-pointer group",
                uploading ? "border-blue-400 bg-blue-50/30" : "border-slate-200 dark:border-slate-800 hover:border-blue-400 hover:bg-blue-50/30"
              )}>
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading || !dashboard?.selected_jd_id} />
                {uploading ? (
                  <div className="text-center">
                    <Clock size={32} className="text-blue-600 animate-spin mx-auto mb-3" />
                    <h4 className="text-lg font-bold text-slate-900 dark:text-white">Uploading and scoring...</h4>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload size={32} className="text-slate-400 group-hover:text-blue-600 mx-auto mb-3 transition-colors" />
                    <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                      {dashboard?.selected_jd_id ? "Click to upload resume" : "Select a JD first"}
                    </h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">PDF, DOCX, or TXT</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* ── JD vs Resume result TABLE ── */}
          {result && (
            <div className="space-y-8">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
                    <FileSearch className="text-blue-600 mr-3" size={24} />
                    Resume vs JD — Skill Match
                  </h3>
                  <StatusBadge status={result.shortlisted ? "Shortlisted" : "Rejected"} className="text-sm px-4 py-1.5" />
                </div>

                <SkillMatchTable explanation={explanation} selectedJd={selectedJd} />

                {/* Screening reasons */}
                {Array.isArray(explanation?.reasons) && explanation.reasons.length > 0 && (
                  <div className="mt-6 p-5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">Why this score</h4>
                    <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {explanation.reasons.map((r) => (
                        <li key={r} className="flex items-start">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 mr-3 flex-shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Resume advice */}
              {resumeAdvice && (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h4 className="text-base font-bold text-slate-900 dark:text-white mb-4 flex items-center">
                      <CheckCircle2 className="text-emerald-500 mr-2" size={18} />Strengths
                    </h4>
                    <ul className="space-y-3">
                      {(resumeAdvice.strengths || []).map((item) => (
                        <li key={item} className="flex items-start text-sm text-slate-600 dark:text-slate-300">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 mr-3 flex-shrink-0" />{item}
                        </li>
                      ))}
                      {!resumeAdvice.strengths?.length && <li className="text-sm text-slate-500">Upload resume to see advice.</li>}
                    </ul>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h4 className="text-base font-bold text-slate-900 dark:text-white mb-4 flex items-center">
                      <AlertCircle className="text-amber-500 mr-2" size={18} />Rewrite Tips
                    </h4>
                    <ul className="space-y-3">
                      {(resumeAdvice.rewrite_tips || []).map((item) => (
                        <li key={item} className="flex items-start text-sm text-slate-600 dark:text-slate-300">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 mr-3 flex-shrink-0" />{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Schedule interview */}
              {result.shortlisted && !interviewCompleted && !finalDecision && (
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 rounded-3xl text-white">
                  <h3 className="text-xl font-bold font-display mb-2">Schedule Your Interview</h3>
                  <p className="text-blue-100 mb-6">Pick a date and time to unlock your interview link.</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-700 w-4 h-4" />
                      <input type="datetime-local" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                        disabled={scheduling}
                        className="pl-10 pr-4 py-3 rounded-2xl text-slate-900 bg-white outline-none min-w-[250px]" />
                    </div>
                    <button onClick={handleScheduleInterview} disabled={scheduling}
                      className="px-8 py-3 rounded-2xl bg-white text-blue-600 font-black hover:scale-[1.01] transition-all shadow-xl disabled:opacity-60">
                      {scheduling ? "Scheduling..." : result.interview_date ? "Reschedule" : "Schedule Interview"}
                    </button>
                  </div>
                  {result.interview_date && (
                    <p className="mt-4 text-sm text-blue-100">
                      Scheduled for: <span className="font-bold">{new Date(result.interview_date).toLocaleString()}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6">Application Progress</h4>
            <StepChecklist steps={steps} />
          </div>
          {result && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4">Score Breakdown</h4>
              <div className="space-y-3 text-sm">
                {[
                  ["Skill match", explanation?.weighted_skill_score],
                  ["Semantic fit", explanation?.semantic_score],
                  ["Experience", explanation?.experience_score],
                  ["Education", explanation?.education_score],
                ].map(([label, val]) => val != null ? (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{label}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{Math.round(Number(val))}%</span>
                  </div>
                ) : null)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

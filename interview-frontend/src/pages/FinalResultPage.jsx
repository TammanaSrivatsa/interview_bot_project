import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  Clock3,
  FileSearch,
  MessageCircle,
  Trophy,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import { candidateApi } from "../services/api";

function stageStatus(result) {
  if (!result) {
    return { label: "No Result Yet", tone: "secondary" };
  }
  if (result.final_decision === "selected") {
    return { label: "Selected", tone: "success" };
  }
  if (result.final_decision === "rejected") {
    return { label: "Not Selected", tone: "danger" };
  }
  if (result.interview_completed) {
    return { label: "Awaiting HR Review", tone: "primary" };
  }
  if (result.interview_session_status === "in_progress") {
    return { label: "Interview In Progress", tone: "primary" };
  }
  if (result.interview_ready) {
    return { label: "Interview Ready", tone: "success" };
  }
  if (result.shortlisted) {
    return { label: "Resume Shortlisted", tone: "success" };
  }
  return { label: "Screening Rejected", tone: "danger" };
}

export default function FinalResultPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await candidateApi.dashboard();
        setDashboard(response);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const result = dashboard?.result || null;
  const explanation = result?.explanation || {};
  const selectedJd =
    dashboard?.available_jds?.find((jd) => jd.id === dashboard?.selected_jd_id) || null;
  const finalReview = result?.final_review || null;
  const finalDecision = result?.final_decision || null;
  const resumeScore = Math.round(
    Number(
      explanation?.final_resume_score != null
        ? explanation.final_resume_score
        : result?.score || 0
    )
  );
  const finalReviewScore =
    finalReview?.final_score != null ? Math.round(Number(finalReview.final_score)) : null;
  const primaryScore = finalReviewScore ?? resumeScore;
  const primaryScoreLabel = finalReviewScore != null ? "Final Score" : "Resume Score";
  const status = stageStatus(result);

  let heroTitle = "Application Status";
  let heroDescription =
    "Track resume screening, interview progress, and the final HR review in one place.";
  if (finalDecision === "selected") {
    heroTitle = "Final Outcome Available";
    heroDescription =
      finalReview?.notes ||
      "HR has completed the review and marked your application as selected.";
  } else if (finalDecision === "rejected") {
    heroTitle = "Final Outcome Available";
    heroDescription =
      finalReview?.notes ||
      "HR has completed the review and marked your application as not selected.";
  } else if (result?.interview_completed) {
    heroTitle = "Interview Submitted";
    heroDescription =
      "Your interview is complete. The recruitment team is reviewing your answers and final notes.";
  } else if (result?.interview_session_status === "in_progress") {
    heroTitle = "Interview In Progress";
    heroDescription =
      "Your live interview session is active. Return to the candidate dashboard to resume it.";
  } else if (result?.shortlisted) {
    heroTitle = "Resume Screening Complete";
    heroDescription =
      "Your resume passed screening. Schedule or start the interview from the candidate dashboard.";
  } else if (result) {
    heroTitle = "Resume Screening Result";
    heroDescription =
      explanation?.academic_cutoff_reason ||
      (Array.isArray(explanation?.reasons) && explanation.reasons.length
        ? explanation.reasons[0]
        : "Your latest resume submission did not meet the current screening requirements.");
  }

  const screeningSummary = result
    ? result.shortlisted
      ? "Resume cleared the screening stage."
      : "Resume did not clear the screening stage."
    : "No screening result is available yet.";

  const interviewSummary = finalDecision
    ? `Final decision recorded: ${finalDecision === "selected" ? "selected" : "not selected"}.`
    : result?.interview_completed
      ? "Interview submitted and awaiting HR review."
      : result?.interview_session_status === "in_progress"
        ? "Interview session is still in progress."
        : result?.interview_ready
          ? "Interview is unlocked and ready to start."
          : result?.interview_scheduled
            ? "Interview is scheduled."
            : "Interview has not started yet.";

  const finalReviewSummary = finalReview
    ? finalReview.notes ||
      (finalReviewScore != null
        ? `HR provided a final review score of ${finalReviewScore}%.`
        : "HR review data is available.")
    : "Final HR review is not available yet.";

  if (loading) {
    return <p className="center muted">Loading application status...</p>;
  }

  if (error && !dashboard) {
    return <p className="alert error">{error}</p>;
  }

  return (
    <div className="space-y-8 pb-12">
      {error ? <p className="alert error">{error}</p> : null}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link
            to="/candidate"
            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all border border-slate-100 dark:border-slate-800"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">
              Application Status
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Resume screening, interview progress, and final HR review.
            </p>
          </div>
        </div>
        <StatusBadge status={status} className="text-sm px-5 py-2" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm p-10 flex flex-col items-center text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              {finalDecision === "selected" ? <Trophy size={200} /> : <FileSearch size={200} />}
            </div>

            <div className="w-48 h-48 rounded-full border-[12px] border-slate-100 dark:border-slate-800 flex items-center justify-center relative mb-8">
              <svg className="absolute inset-0 w-full h-full -rotate-90">
                <circle
                  cx="50%"
                  cy="50%"
                  r="45%"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  className="text-blue-600"
                  strokeDasharray={`${primaryScore * 2.83} 283`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="text-center">
                <span className="text-6xl font-black text-slate-900 dark:text-white">
                  {primaryScore}
                </span>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                  {primaryScoreLabel}
                </p>
              </div>
            </div>

            <div className="max-w-xl">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                {heroTitle}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                {heroDescription}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
              <CheckCircle2 className="text-blue-600 mb-4" size={24} />
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                Resume Screening
              </h4>
              <p className="text-3xl font-black text-slate-900 dark:text-white">
                {resumeScore}%
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                {screeningSummary}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
              <Clock3 className="text-blue-600 mb-4" size={24} />
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                Interview Stage
              </h4>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {result?.interview_completed
                  ? "Submitted"
                  : result?.interview_session_status === "in_progress"
                    ? "In Progress"
                    : result?.interview_ready
                      ? "Ready"
                      : result?.interview_scheduled
                        ? "Scheduled"
                        : "Pending"}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                {interviewSummary}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
              {finalDecision === "selected" ? (
                <Trophy className="text-emerald-600 mb-4" size={24} />
              ) : finalDecision === "rejected" ? (
                <XCircle className="text-red-600 mb-4" size={24} />
              ) : (
                <MessageCircle className="text-blue-600 mb-4" size={24} />
              )}
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                Final HR Review
              </h4>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {finalReviewScore != null
                  ? `${finalReviewScore}%`
                  : finalDecision === "selected"
                    ? "Selected"
                    : finalDecision === "rejected"
                      ? "Not Selected"
                      : "Pending"}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                {finalReviewSummary}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center font-display">
              <FileSearch className="text-blue-600 mr-2" size={24} />
              Screening Snapshot
            </h3>

            <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 mb-6">
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Resume decision: {result?.shortlisted ? "Shortlisted" : "Rejected"}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                {Array.isArray(explanation?.reasons) && explanation.reasons.length
                  ? explanation.reasons[0]
                  : "Resume screening notes are not available yet."}
              </p>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Top Matched Skills
              </h4>
              <div className="flex flex-wrap gap-2">
                {(explanation?.matched_skills || []).slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="px-4 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold border border-slate-100 dark:border-slate-700"
                  >
                    {tag}
                  </span>
                ))}
                {!explanation?.matched_skills?.length ? (
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    No matched skills captured yet.
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center font-display">
              <MessageCircle className="text-blue-600 mr-2" size={24} />
              Interview and Final Review
            </h3>

            {!result?.interview_completed && !finalDecision ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Interview review will appear here after the interview is submitted and HR finalizes
                the application.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    Current review status
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                    {finalReviewSummary}
                  </p>
                </div>

                {finalReview ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Behavioral Score
                      </p>
                      <p className="text-2xl font-black text-slate-900 dark:text-white mt-3">
                        {finalReview.behavioral_score != null
                          ? `${Math.round(Number(finalReview.behavioral_score))}%`
                          : "Pending"}
                      </p>
                    </div>
                    <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Communication Score
                      </p>
                      <p className="text-2xl font-black text-slate-900 dark:text-white mt-3">
                        {finalReview.communication_score != null
                          ? `${Math.round(Number(finalReview.communication_score))}%`
                          : "Pending"}
                      </p>
                    </div>
                  </div>
                ) : null}

                {finalReview?.red_flags ? (
                  <div className="p-5 bg-red-50 dark:bg-red-950/20 rounded-2xl border border-red-100 dark:border-red-900/50">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-widest">
                      HR Red Flags
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300 mt-3 leading-relaxed">
                      {finalReview.red_flags}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-8">
              Role Insights
            </h4>
            <div className="flex items-center space-x-4 mb-8">
              <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Briefcase size={28} />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                  {selectedJd?.title || "Selected JD"}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                  Candidate workflow
                </p>
              </div>
            </div>

            <div className="space-y-5 text-sm text-slate-600 dark:text-slate-300">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Qualify Score
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {selectedJd?.qualify_score ?? 0}%
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Minimum Academic
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {Number(selectedJd?.min_academic_percent || 0)}%
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Academic Cutoff
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {Number(explanation?.min_academic_percent_required || 0) > 0
                    ? explanation?.academic_cutoff_met
                      ? "Passed"
                      : "Not met"
                    : "Not configured"}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Interview Date
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {result?.interview_date
                    ? new Date(result.interview_date).toLocaleString()
                    : "Not scheduled"}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-indigo-600 p-8 rounded-[40px] text-white shadow-xl shadow-indigo-100 dark:shadow-none">
            <Trophy className="mb-6 opacity-80" size={40} />
            <h3 className="text-xl font-bold font-display leading-tight mb-4">
              What to do next
            </h3>
            <p className="text-indigo-100 text-sm leading-relaxed mb-6">
              {finalDecision === "selected"
                ? "Watch for the recruiter follow-up and any joining or next-round instructions."
                : finalDecision === "rejected"
                  ? "Use the screening notes and missing skills list to improve the next application."
                  : result?.interview_completed
                    ? "Wait for the recruiter to finish the final review. This page will update when the decision is stored."
                    : result?.shortlisted
                      ? "Return to the candidate dashboard to schedule or continue the interview."
                      : "Return to the candidate dashboard, improve the resume, and resubmit for screening."}
            </p>
            <Link
              to="/candidate"
              className="block w-full bg-white text-indigo-600 py-4 rounded-2xl font-black text-sm hover:scale-[1.02] transition-all shadow-lg text-center"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

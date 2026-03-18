import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import MetricCard from "../components/MetricCard";
import StatusBadge from "../components/StatusBadge";
import { hrApi } from "../services/api";
import { cn } from "../utils/utils";

export default function ResumeAnalysisPage() {
  const { candidateUid } = useParams();
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCandidate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await hrApi.candidateDetail(candidateUid);
      setCandidate(response?.candidate || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [candidateUid]);

  useEffect(() => {
    loadCandidate();
  }, [loadCandidate]);

  if (loading) {
    return <p className="center muted py-12">Loading resume analysis...</p>;
  }

  if (error && !candidate) {
    return <p className="alert error">{error}</p>;
  }

  if (!candidate) {
    return <p className="muted">Candidate not found.</p>;
  }

  const metrics = [
    {
      name: "Semantic Score",
      score: candidate.semanticScore || 0,
      description: "Content relevance and job fit",
      type: "score",
    },
    {
      name: "Resume Score",
      score: candidate.resumeScore || 0,
      description: "Overall resume quality",
      type: "score",
    },
    {
      name: "Skill Match Score",
      score: candidate.skillMatchScore || 0,
      description: "Required skills coverage",
      type: "score",
    },
    {
      name: "Experience Match Score",
      score: candidate.experienceMatchScore || candidate.resumeScore || 0,
      description: "Years of experience fit",
      type: "score",
    },
    {
      name: "Education Match Score",
      score: candidate.educationMatchScore || candidate.resumeScore || 0,
      description: "Educational background fit",
      type: "score",
    },
    {
      name: "Domain Fit Score",
      score: candidate.domainFitScore || candidate.skillMatchScore || 0,
      description: "Industry and domain expertise",
      type: "score",
    },
    {
      name: "Communication Score",
      score: candidate.communicationScore || 0,
      description: "Communication skills clarity",
      type: "score",
    },
    {
      name: "Confidence Score",
      score: candidate.confidenceScore || 0,
      description: "Overall confidence level",
      type: "score",
    },
    {
      name: "Interview Score",
      score: candidate.interviewScore || 0,
      description: "Interview performance",
      type: "score",
    },
    {
      name: "Final AI Score",
      score: candidate.finalAIScore || 0,
      description: "Composite final score",
      type: "final",
    },
    {
      name: "Final Decision",
      value: candidate.finalDecision?.label || "Pending",
      description: "AI recommendation",
      type: "decision",
    },
    {
      name: "Resume Status",
      value: candidate.resumeStatus || "Pending",
      description: "Analysis status",
      type: "status",
    },
  ];

  const scoreMetrics = metrics.filter((m) => m.type === "score");
  const summaryMetrics = [
    {
      title: "Resume Score",
      value: `${candidate.resumeScore || 0}%`,
      color: "blue",
      icon: TrendingUp,
    },
    {
      title: "Semantic Score",
      value: `${candidate.semanticScore || 0}%`,
      color: "purple",
      icon: TrendingUp,
    },
    {
      title: "Final AI Score",
      value: `${candidate.finalAIScore || 0}%`,
      color: "green",
      icon: TrendingUp,
    },
    {
      title: "Decision",
      value: candidate.finalDecision?.label || "Pending",
      color: candidate.finalDecision?.tone === "success" ? "green" : "yellow",
      icon: CheckCircle2,
    },
  ];

  const getScoreColor = (score) => {
    if (score >= 80) return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400";
    if (score >= 60) return "text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400";
    if (score >= 40) return "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400";
    return "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400";
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          to={`/hr/candidates/${candidateUid}`}
          className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 transition-colors font-medium"
        >
          <ArrowLeft size={20} />
          <span>Back to Candidate</span>
        </Link>
        <StatusBadge status={candidate.finalDecision} />
      </div>

      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">Resume Analysis Results</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">{candidate.name} • {candidate.email}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryMetrics.map((metric) => (
          <MetricCard key={metric.title} title={metric.title} value={metric.value} color={metric.color} icon={metric.icon} />
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Evaluation Metrics</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Detailed breakdown of all assessment scores</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800">
                <th className="px-8 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Metric</th>
                <th className="px-8 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Score</th>
                <th className="px-8 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Status / Remark</th>
                <th className="px-8 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Performance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {scoreMetrics.map((metric) => {
                const score = metric.score || 0;
                const status = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs Improvement";
                const statusColor = score >= 80 ? "success" : score >= 60 ? "primary" : "warning";
                return (
                  <tr key={metric.name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-all">
                    <td className="px-8 py-5">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{metric.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{metric.description}</p>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className={cn("px-4 py-2 rounded-lg font-bold inline-block", getScoreColor(score))}>
                        {score}%
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm text-slate-600 dark:text-slate-300">
                        <StatusBadge status={{ label: status, tone: statusColor }} />
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="w-32 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${score}%`,
                            backgroundColor:
                              score >= 80
                                ? "#10b981"
                                : score >= 60
                                  ? "#3b82f6"
                                  : score >= 40
                                    ? "#eab308"
                                    : "#ef4444",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}

              <tr className="bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-50/75 dark:hover:bg-slate-800/50 transition-all border-t-2 border-slate-200 dark:border-slate-700">
                <td className="px-8 py-5">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">Final Decision</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">AI screening recommendation</p>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <div className={cn("px-4 py-2 rounded-lg font-bold inline-block", getScoreColor(candidate.finalAIScore || 0))}>
                    {candidate.finalAIScore || 0}%
                  </div>
                </td>
                <td className="px-8 py-5">
                  <StatusBadge status={candidate.finalDecision} />
                </td>
                <td className="px-8 py-5">
                  <div
                    className={cn(
                      "inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-bold",
                      candidate.finalDecision?.key === "selected" || candidate.finalDecision?.key === "shortlisted"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : candidate.finalDecision?.key === "rejected"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    )}
                  >
                    {candidate.finalDecision?.key === "selected" || candidate.finalDecision?.key === "shortlisted" ? (
                      <CheckCircle2 size={16} />
                    ) : candidate.finalDecision?.key === "rejected" ? (
                      <AlertCircle size={16} />
                    ) : null}
                    <span>{candidate.finalDecision?.label || "Pending Review"}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-8">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center space-x-2">
            <CheckCircle2 className="text-emerald-600" size={24} />
            <span>Resume Status</span>
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <span className="text-slate-700 dark:text-slate-300 font-medium">Analysis Status</span>
              <span className="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold text-sm">
                {candidate.resumeStatus || "Completed"}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <span className="text-slate-700 dark:text-slate-300 font-medium">Interview Status</span>
              <StatusBadge status={{ label: candidate.interviewStatus?.label || "Not Started" }} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-8">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center space-x-2">
            <TrendingUp className="text-blue-600" size={24} />
            <span>Application Info</span>
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <span className="text-slate-700 dark:text-slate-300 font-medium">Applied JD</span>
              <span className="text-slate-900 dark:text-white font-bold">{candidate.role || "–"}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <span className="text-slate-700 dark:text-slate-300 font-medium">Final Decision</span>
              <StatusBadge status={candidate.finalDecision} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

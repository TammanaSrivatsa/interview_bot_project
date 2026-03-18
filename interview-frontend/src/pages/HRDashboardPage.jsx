import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserCheck,
  UserX,
  Calendar,
  CheckCircle2,
  Search,
  Filter,
  Plus,
} from "lucide-react";
import MetricCard from "../components/MetricCard";
import CandidateTable from "../components/CandidateTable";
import { hrApi } from "../services/api";

export default function HRDashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [candidatesData, setCandidatesData] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState("");

  const overview = dashboard?.analytics?.overview || {};
  const pipeline = dashboard?.analytics?.pipeline || [];
  const scheduledCount = pipeline.find((item) => item.key === "interview_scheduled")?.count || 0;
  const completedCount = pipeline.find((item) => item.key === "completed")?.count || 0;
  const shortlistedCount = pipeline.find((item) => item.key === "shortlisted")?.count || 0;
  const rejectedCount = pipeline.find((item) => item.key === "rejected")?.count || 0;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await hrApi.dashboard();
      setDashboard(response);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    setTableLoading(true);
    setError("");
    try {
      const response = await hrApi.listCandidates({
        q: searchTerm,
        status: statusFilter,
        page: 1,
      });
      setCandidatesData(response);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setTableLoading(false);
    }
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  async function handleDeleteCandidate(candidate) {
    try {
      await hrApi.deleteCandidate(candidate.uid || candidate.candidate_uid);
      await loadCandidates();
      await loadDashboard();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function handleScheduleCandidate(candidate) {
    navigate(`/hr/candidates/${candidate.uid || candidate.candidate_uid}`);
  }

  if (loading && !dashboard) {
    return <p className="center muted">Loading HR dashboard...</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">HR Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Monitor live pipeline metrics and review the latest candidates.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/hr/candidates")}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all shadow-lg shadow-blue-200 dark:shadow-none"
        >
          <Plus size={20} />
          <span>Manage Candidates</span>
        </button>
      </div>

      {error ? <p className="alert error">{error}</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard title="Total Applications" value={overview.total_applications || 0} icon={Users} color="blue" />
        <MetricCard title="Shortlisted" value={shortlistedCount} icon={UserCheck} color="green" />
        <MetricCard title="Rejected" value={rejectedCount} icon={UserX} color="red" />
        <MetricCard title="Interviews Scheduled" value={scheduledCount} icon={Calendar} color="purple" />
        <MetricCard title="Interviews Completed" value={completedCount} icon={CheckCircle2} color="yellow" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Recent Candidates</h2>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search candidates..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <div className="relative w-full sm:w-48">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <select
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none dark:text-white"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="applied">Applied</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="interview_scheduled">Interview Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
          </div>

          {tableLoading ? (
            <p className="center muted py-12">Loading candidates...</p>
          ) : (
            <CandidateTable
              candidates={candidatesData?.candidates || []}
              onDeleteCandidate={handleDeleteCandidate}
              onScheduleCandidate={handleScheduleCandidate}
            />
          )}

          <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Showing {(candidatesData?.candidates || []).length} of {candidatesData?.total_results || 0} candidates
            </p>
            <button
              type="button"
              onClick={() => navigate("/hr/candidates")}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              View All
            </button>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6">Current JD</h4>
            {dashboard?.latest_jd ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">{dashboard.latest_jd.jd_title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    Cutoff: {dashboard.latest_jd.cutoff_score}% | Questions: {dashboard.latest_jd.question_count}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/hr/jds")}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                >
                  Open JD Management
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No JD has been uploaded for this HR account yet.</p>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6">Pipeline Snapshot</h4>
            <div className="space-y-4">
              {pipeline.map((item) => (
                <div key={item.key} className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                  <span className="text-sm text-slate-500 dark:text-slate-400">{item.label}</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

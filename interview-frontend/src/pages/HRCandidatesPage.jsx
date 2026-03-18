import { useCallback, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import ScoreBadge from "../components/ScoreBadge";
import MetricCard from "../components/MetricCard";
import { hrApi } from "../services/api";
import { cn } from "../utils/utils";

function SortButton({ column, label, sortKey, onSort }) {
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="flex items-center space-x-1 hover:text-blue-600 transition-colors uppercase tracking-wider font-bold"
    >
      <span>{label}</span>
      <ArrowUpDown size={12} className={cn(sortKey === column ? "text-blue-600" : "text-slate-400 opacity-50")} />
    </button>
  );
}

export default function HRCandidatesPage() {
  const [allCandidates, setAllCandidates] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [jdFilter, setJdFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "finalAIScore", direction: "desc" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const itemsPerPage = 10;

  const loadAllCandidates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let pageNumber = 1;
      let hasMore = true;
      let candidates = [];

      while (hasMore) {
        const response = await hrApi.listCandidates({ page: pageNumber });
        candidates = candidates.concat(response.candidates || []);
        hasMore = response.has_next;
        pageNumber += 1;
      }

      // Load detailed information for each candidate
      const detailedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
          try {
            const detail = await hrApi.candidateDetail(candidate.candidate_uid);
            const detailCandidate = detail?.candidate || {};
            return {
              ...candidate,
              uid: candidate.candidate_uid,
              semanticScore: Number(detailCandidate.semanticScore || 0),
              skillMatchScore: Number(detailCandidate.skillMatchScore || 0),
              interviewScore:
                detailCandidate.interviewScore === null || detailCandidate.interviewScore === undefined
                  ? 0
                  : Number(detailCandidate.interviewScore),
              communicationScore:
                detailCandidate.communicationScore === null || detailCandidate.communicationScore === undefined
                  ? 0
                  : Number(detailCandidate.communicationScore),
              confidenceScore:
                detailCandidate.confidenceScore === null || detailCandidate.confidenceScore === undefined
                  ? 0
                  : Number(detailCandidate.confidenceScore),
              finalAIScore: Number(detailCandidate.finalAIScore || candidate.resumeScore || 0),
            };
          } catch {
            return candidate;
          }
        })
      );

      setAllCandidates(detailedCandidates);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllCandidates();
  }, [loadAllCandidates]);

  const jdOptions = useMemo(() => {
    return ["all", ...new Set(allCandidates.map((c) => c.role).filter(Boolean))];
  }, [allCandidates]);

  const filteredCandidates = useMemo(() => {
    return allCandidates
      .filter((candidate) => {
        const matchesSearch =
          candidate.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          candidate.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          String(candidate.candidate_uid || "").toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === "all" || candidate.interviewStatus?.key === statusFilter;
        const matchesDecision = decisionFilter === "all" || candidate.finalDecision?.key === decisionFilter;
        const matchesJd = jdFilter === "all" || candidate.role === jdFilter;
        return matchesSearch && matchesStatus && matchesDecision && matchesJd;
      })
      .sort((left, right) => {
        const leftValue = Number(left[sortConfig.key] || 0);
        const rightValue = Number(right[sortConfig.key] || 0);
        if (leftValue < rightValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (leftValue > rightValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
  }, [allCandidates, searchTerm, statusFilter, decisionFilter, jdFilter, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / itemsPerPage));
  const paginatedCandidates = filteredCandidates.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, decisionFilter, jdFilter, sortConfig]);

  const requestSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
  };

  async function handleDeleteCandidate(candidateUid) {
    if (!window.confirm("Are you sure you want to delete this candidate?")) return;
    try {
      await hrApi.deleteCandidate(candidateUid);
      await loadAllCandidates();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function handleExportCsv() {
    const header = [
      "Candidate ID",
      "Name",
      "Email",
      "Applied JD",
      "Resume Score",
      "Semantic Score",
      "Skill Match",
      "Interview Score",
      "Communication",
      "Confidence",
      "Final Score",
      "Decision",
      "Status",
    ];
    const rows = filteredCandidates.map((candidate) => [
      candidate.candidate_uid,
      candidate.name,
      candidate.email,
      candidate.role || "–",
      candidate.resumeScore || 0,
      candidate.semanticScore || 0,
      candidate.skillMatchScore || 0,
      candidate.interviewScore || 0,
      candidate.communicationScore || 0,
      candidate.confidenceScore || 0,
      candidate.finalAIScore || 0,
      candidate.finalDecision?.label || "–",
      candidate.interviewStatus?.label || "–",
    ]);
    const csvContent = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "candidates.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !allCandidates.length) {
    return <p className="center muted py-12">Loading candidates...</p>;
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">Candidate Directory</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Review and compare all candidates with detailed scoring metrics.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
          >
            <Download size={20} />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => loadAllCandidates()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all shadow-lg shadow-blue-200 dark:shadow-none"
          >
            <RefreshCw size={18} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error ? <p className="alert error">{error}</p> : null}

      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by name, email, or ID..."
              className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium dark:text-white"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <select
            className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium dark:text-white"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Interview Status: All</option>
            <option value="applied">Applied</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="interview_scheduled">Interview Scheduled</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium dark:text-white"
            value={jdFilter}
            onChange={(event) => setJdFilter(event.target.value)}
          >
            <option value="all">Applied JD: All</option>
            {jdOptions.slice(1).map((jd) => (
              <option key={jd} value={jd}>
                {jd}
              </option>
            ))}
          </select>

          <select
            className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium dark:text-white"
            value={decisionFilter}
            onChange={(event) => setDecisionFilter(event.target.value)}
          >
            <option value="all">Decision: All</option>
            <option value="selected">Selected</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
          Showing {paginatedCandidates.length} of {filteredCandidates.length} candidates
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800">
                <th className="px-6 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Candidate</th>
                <th className="px-6 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Applied JD</th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="resumeScore" label="Resume" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="semanticScore" label="Semantic" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="skillMatchScore" label="Skill Match" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="interviewScore" label="Interview" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="communicationScore" label="Communication" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px]"><SortButton column="confidenceScore" label="Confidence" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 min-w-[110px] bg-blue-50/20 dark:bg-blue-900/10"><SortButton column="finalAIScore" label="Final Score" sortKey={sortConfig.key} direction={sortConfig.direction} onSort={requestSort} /></th>
                <th className="px-6 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Decision</th>
                <th className="px-6 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Status</th>
                <th className="px-6 py-5 text-[10px] text-slate-400 uppercase tracking-widest font-black">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {!paginatedCandidates.length ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No candidates match your filters.
                  </td>
                </tr>
              ) : paginatedCandidates.map((candidate) => (
                <tr key={candidate.candidate_uid} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-all group">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <img src={candidate.avatar} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{candidate.name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{candidate.candidate_uid}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{candidate.role || "–"}</p>
                  </td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.resumeScore || 0} /></td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.semanticScore || 0} /></td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.skillMatchScore || 0} /></td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.interviewScore || 0} /></td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.communicationScore || 0} /></td>
                  <td className="px-6 py-4"><ScoreBadge score={candidate.confidenceScore || 0} /></td>
                  <td className="px-6 py-4 bg-blue-50/20 dark:bg-blue-900/5">
                    <ScoreBadge score={candidate.finalAIScore || 0} className="scale-110 shadow-sm" />
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={candidate.finalDecision} />
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={candidate.interviewStatus} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <Link
                        to={`/hr/candidates/${candidate.candidate_uid}`}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all"
                      >
                        <Eye size={18} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteCandidate(candidate.candidate_uid)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-6 bg-slate-50/30 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-500">
            Showing <span className="text-slate-900 dark:text-white">{paginatedCandidates.length}</span> per page
          </p>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-white dark:hover:bg-slate-900 disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center space-x-1 px-4">
              <span className="text-sm font-black text-slate-900 dark:text-white">Page {page}</span>
              <span className="text-sm text-slate-400">of {totalPages}</span>
            </div>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-white dark:hover:bg-slate-900 disabled:opacity-30 transition-all"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

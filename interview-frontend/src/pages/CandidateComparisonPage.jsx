import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import MetricCard from "../components/MetricCard";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { hrApi } from "../services/api";
import { formatPercent } from "../utils/formatters";
import "./CandidateComparisonPage.css";

export default function CandidateComparisonPage() {
  const [allCandidates, setAllCandidates] = useState([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAllCandidates() {
    setLoading(true);
    setError("");
    try {
      let allResults = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await hrApi.listCandidates({ page });
        allResults = allResults.concat(response.candidates || []);
        hasMore = response.has_next || false;
        page += 1;
      }

      setAllCandidates(allResults);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllCandidates();
  }, []);

  const selectedCandidates = useMemo(
    () => allCandidates.filter((c) => selectedCandidateIds.includes(c.candidate_uid)),
    [allCandidates, selectedCandidateIds],
  );

  const toggleCandidateSelection = (candidateUid) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateUid) ? prev.filter((id) => id !== candidateUid) : [...prev, candidateUid],
    );
  };

  const toggleAllSelection = () => {
    if (selectedCandidateIds.length === allCandidates.length) {
      setSelectedCandidateIds([]);
    } else {
      setSelectedCandidateIds(allCandidates.map((c) => c.candidate_uid));
    }
  };

  if (loading) return <p className="center muted">Loading candidates for comparison...</p>;

  return (
    <div className="stack">
      <PageHeader
        title="Candidate Comparison"
        subtitle="Compare multiple candidates side-by-side based on their scores and status."
        actions={
          <>
            <Link to="/hr/candidates" className="button-link subtle-button">
              Back to Candidates
            </Link>
            <button type="button" onClick={() => setSelectedCandidateIds([])}>
              Clear Selection
            </button>
          </>
        }
      />

      {error && <p className="alert error">{error}</p>}

      <section className="card stack">
        <div className="title-row">
          <div>
            <p className="eyebrow">Selection</p>
            <h3>Choose candidates to compare</h3>
          </div>
          <p className="muted">{selectedCandidateIds.length} selected</p>
        </div>

        {!allCandidates.length && <p className="muted">No candidates available for comparison.</p>}
        {!!allCandidates.length && (
          <>
            <div className="inline-row">
              <input
                type="checkbox"
                id="select-all"
                checked={selectedCandidateIds.length === allCandidates.length && allCandidates.length > 0}
                onChange={toggleAllSelection}
              />
              <label htmlFor="select-all">
                <strong>Select All</strong>
              </label>
            </div>

            <div className="candidates-list">
              {allCandidates.map((candidate) => (
                <div key={candidate.candidate_uid} className="candidate-checkbox-row">
                  <input
                    type="checkbox"
                    id={`candidate-${candidate.candidate_uid}`}
                    checked={selectedCandidateIds.includes(candidate.candidate_uid)}
                    onChange={() => toggleCandidateSelection(candidate.candidate_uid)}
                  />
                  <label htmlFor={`candidate-${candidate.candidate_uid}`} className="candidate-label">
                    <span>
                      <strong>{candidate.name}</strong>
                      <span className="muted">{candidate.candidate_uid}</span>
                    </span>
                    <span className="muted">{candidate.email}</span>
                  </label>
                  <StatusBadge status={candidate.status} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {selectedCandidates.length > 0 && (
        <section className="card stack">
          <div className="title-row">
            <div>
              <p className="eyebrow">Comparison Matrix</p>
              <h3>Score breakdown</h3>
            </div>
          </div>

          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Resume Score</th>
                  <th>Status</th>
                  <th>Interview Score</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedCandidates.map((candidate) => (
                  <tr key={candidate.candidate_uid}>
                    <td>
                      <div className="stack-sm">
                        <strong>{candidate.name}</strong>
                        <span className="muted">{candidate.candidate_uid}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`score-badge ${Number(candidate.score) > 75 ? "high" : Number(candidate.score) > 50 ? "medium" : "low"}`}>
                        {formatPercent(candidate.score)}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={candidate.status} />
                    </td>
                    <td>
                      <span className="muted">{candidate.interview_score || "—"}</span>
                    </td>
                    <td className="muted text-sm">{candidate.created_at?.split("T")[0]}</td>
                    <td>
                      <Link to={`/hr/candidates/${candidate.candidate_uid}`} className="button-link subtle-button">
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="comparison-summary">
            <div className="summary-stat">
              <p className="eyebrow">Average Resume Score</p>
              <h3>
                {formatPercent(
                  selectedCandidates.reduce((sum, c) => sum + (Number(c.score) || 0), 0) / selectedCandidates.length,
                )}
              </h3>
            </div>
            <div className="summary-stat">
              <p className="eyebrow">Highest Score</p>
              <h3>
                {formatPercent(Math.max(...selectedCandidates.map((c) => Number(c.score) || 0)))}
              </h3>
            </div>
            <div className="summary-stat">
              <p className="eyebrow">Lowest Score</p>
              <h3>
                {formatPercent(Math.min(...selectedCandidates.map((c) => Number(c.score) || 0)))}
              </h3>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

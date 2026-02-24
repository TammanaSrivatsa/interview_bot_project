import { useEffect, useMemo, useState } from "react";
import { hrApi } from "../services/api";

function normalizeSkillWeights(skillMap) {
  const next = {};
  Object.entries(skillMap || {}).forEach(([key, value]) => {
    if (!key) return;
    next[key] = Number(value || 0);
  });
  return next;
}

export default function HRDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [jdFile, setJdFile] = useState(null);
  const [jdTitle, setJdTitle] = useState("");
  const [genderRequirement, setGenderRequirement] = useState("");
  const [educationRequirement, setEducationRequirement] = useState("");
  const [experienceRequirement, setExperienceRequirement] = useState("");
  const [extractedSkills, setExtractedSkills] = useState(null);
  const [skillDraft, setSkillDraft] = useState({});
  const [technicalScores, setTechnicalScores] = useState({});

  const selectedJobId = data?.selected_job_id || null;
  const selectedJob = useMemo(
    () => (data?.jobs || []).find((job) => job.id === selectedJobId) || null,
    [data?.jobs, selectedJobId],
  );

  async function loadDashboard(jobId) {
    setLoading(true);
    setError("");
    try {
      const dashboard = await hrApi.dashboard(jobId);
      setData(dashboard);
      setSkillDraft(normalizeSkillWeights(dashboard?.latest_jd?.skill_scores || {}));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleUploadJd() {
    if (!jdFile) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await hrApi.uploadJd({
        file: jdFile,
        jdTitle,
        educationRequirement,
        experienceRequirement,
        genderRequirement,
      });
      setExtractedSkills(normalizeSkillWeights(response.ai_skills || {}));
      setNotice("JD uploaded. Review extracted skills and confirm.");
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmJd() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await hrApi.confirmJd(extractedSkills || {});
      setNotice(response.message || "JD confirmed.");
      setExtractedSkills(null);
      setJdFile(null);
      await loadDashboard(response.job_id);
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSkillWeights() {
    if (!selectedJob?.id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await hrApi.updateSkillWeights(skillDraft, selectedJob.id);
      setNotice(response.message || "Skill weights updated.");
      await loadDashboard(selectedJob.id);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInterviewScoreSubmit(resultId) {
    const value = Number(technicalScores[resultId] || 0);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await hrApi.submitInterviewScore(resultId, value);
      setNotice(
        `Interview score saved. Final: ${response.final_score}% (${response.recommendation})`,
      );
      await loadDashboard(selectedJobId);
    } catch (scoreError) {
      setError(scoreError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="center muted">Loading HR dashboard...</p>;

  return (
    <div className="stack">
      {error && <p className="alert error">{error}</p>}
      {notice && <p className="alert success">{notice}</p>}

      <section className="card">
        <div className="title-row">
          <h2>HR Dashboard</h2>
          <button onClick={() => loadDashboard(selectedJobId)}>Refresh</button>
        </div>
        {!!data?.jobs?.length && (
          <div className="stack-sm">
            <label htmlFor="jd-selector">View JD</label>
            <select id="jd-selector" value={selectedJobId || ""} onChange={(e) => loadDashboard(Number(e.target.value))}>
              {data.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jd_title || job.jd_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Upload New JD</h3>
        <div className="stack-sm">
          <input
            type="text"
            placeholder="JD title"
            value={jdTitle}
            onChange={(e) => setJdTitle(e.target.value)}
          />
          <input type="file" onChange={(e) => setJdFile(e.target.files?.[0] || null)} />
          <select
            value={educationRequirement}
            onChange={(e) => setEducationRequirement(e.target.value)}
          >
            <option value="">Education: None</option>
            <option value="bachelor">Bachelor's</option>
            <option value="master">Master's</option>
            <option value="phd">PhD</option>
          </select>
          <input
            type="number"
            placeholder="Experience years"
            value={experienceRequirement}
            onChange={(e) => setExperienceRequirement(e.target.value)}
          />
          <select value={genderRequirement} onChange={(e) => setGenderRequirement(e.target.value)}>
            <option value="">Gender: None</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
          <button disabled={busy || !jdFile} onClick={handleUploadJd}>
            {busy ? "Uploading..." : "Upload JD"}
          </button>
        </div>

        {!!extractedSkills && (
          <div className="stack-sm top-gap">
            <h4>Extracted Skills</h4>
            {Object.entries(extractedSkills).map(([skill, score]) => (
              <div className="inline-row" key={skill}>
                <input value={skill} readOnly />
                <input
                  type="number"
                  value={score}
                  onChange={(e) =>
                    setExtractedSkills((prev) => ({
                      ...prev,
                      [skill]: Number(e.target.value || 0),
                    }))
                  }
                />
              </div>
            ))}
            <button disabled={busy} onClick={handleConfirmJd}>
              Confirm JD
            </button>
          </div>
        )}
      </section>

      {!!selectedJob && (
        <section className="card">
          <h3>Skill Weights: {selectedJob.jd_title || "Selected JD"}</h3>
          {Object.entries(skillDraft).map(([skill, score]) => (
            <div className="inline-row" key={skill}>
              <input value={skill} readOnly />
              <input
                type="number"
                value={score}
                onChange={(e) =>
                  setSkillDraft((prev) => ({
                    ...prev,
                    [skill]: Number(e.target.value || 0),
                  }))
                }
              />
            </div>
          ))}
          <button disabled={busy} onClick={handleUpdateSkillWeights}>
            Update Skill Weights
          </button>
        </section>
      )}

      <section className="card">
        <h3>Shortlisted Candidates</h3>
        {!data?.shortlisted_candidates?.length && <p className="muted">No shortlisted candidates yet.</p>}
        {!!data?.shortlisted_candidates?.length && (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Score</th>
                <th>Resume Match</th>
                <th>Interview Score</th>
              </tr>
            </thead>
            <tbody>
              {data.shortlisted_candidates.map((item) => {
                const result = item.result || {};
                const interviewScoring = result.explanation?.interview_scoring || null;
                return (
                  <tr key={result.id}>
                    <td>{item.candidate?.name}</td>
                    <td>{item.candidate?.email}</td>
                    <td>{result.score}%</td>
                    <td>{result.explanation?.matched_percentage ?? 0}%</td>
                    <td>
                      <div className="stack-sm">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="Technical score"
                          value={technicalScores[result.id] || ""}
                          onChange={(e) =>
                            setTechnicalScores((prev) => ({
                              ...prev,
                              [result.id]: e.target.value,
                            }))
                          }
                        />
                        <button disabled={busy} onClick={() => handleInterviewScoreSubmit(result.id)}>
                          Save Interview Score
                        </button>
                        {interviewScoring && (
                          <span className="muted">
                            Final: {interviewScoring.final_score}% ({interviewScoring.recommendation})
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hrApi } from "../services/api";

export default function HRInterviewDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState("selected");
  const [notes, setNotes] = useState("");
  const [score, setScore] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await hrApi.interviewDetail(id);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleFinalize() {
    try {
      await hrApi.finalizeInterview(id, {
        decision,
        notes,
        final_score: score ? Number(score) : null,
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="center muted">Loading interview...</p>;
  if (error) return <p className="alert error">{error}</p>;
  if (!data?.interview) return <p className="muted">Not found.</p>;

  const { interview, questions, events } = data;

  return (
    <div className="stack">
      <div className="title-row">
        <h2>Interview {interview.application_id || interview.interview_id}</h2>
        <button onClick={() => navigate(-1)}>Back</button>
      </div>
      <p className="muted">
        Candidate: {interview.candidate?.name} ({interview.candidate?.email}) | Job: {interview.job?.title}
      </p>

      <section className="card stack-sm">
        <h3>Finalize</h3>
        <div className="inline-row">
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="selected">Selected</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            type="number"
            placeholder="Final score"
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <textarea
          rows={3}
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button onClick={handleFinalize}>Save decision</button>
      </section>

      <section className="card stack-sm">
        <h3>Questions</h3>
        {!questions?.length && <p className="muted">No questions.</p>}
        {!!questions?.length &&
          questions.map((q) => (
            <div key={q.id} className="stack-sm" style={{ borderBottom: "1px solid #e1e7ef", paddingBottom: 8 }}>
              <strong>{q.text}</strong>
              <p><em>Answer:</em> {q.answer_text || "(skipped)"} </p>
              <p className="muted">Summary: {q.answer_summary || "—"} | Relevance: {q.relevance_score ?? "N/A"}</p>
            </div>
          ))}
      </section>

      <section className="card stack-sm">
        <h3>Proctoring Events</h3>
        {!events?.length && <p className="muted">No events.</p>}
        {!!events?.length &&
          events.map((ev) => (
            <div key={ev.id} className="inline-row">
              <span>{ev.created_at}</span>
              <span>{ev.event_type}</span>
              <span>score {ev.score ?? 0}</span>
              {(ev.image_url || ev.snapshot_path) && (
                <a href={ev.image_url || `/${ev.snapshot_path}`} target="_blank" rel="noreferrer">
                  Snapshot
                </a>
              )}
            </div>
          ))}
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hrApi } from "../services/api";

function scoreOrEmpty(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export default function HRInterviewDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState("selected");
  const [notes, setNotes] = useState("");
  const [finalScore, setFinalScore] = useState("");
  const [behavioralScore, setBehavioralScore] = useState("");
  const [communicationScore, setCommunicationScore] = useState("");
  const [redFlags, setRedFlags] = useState("");

  function hydrateReview(hrReview) {
    if (!hrReview) return;
    setNotes(hrReview.notes || "");
    setFinalScore(scoreOrEmpty(hrReview.final_score));
    setBehavioralScore(scoreOrEmpty(hrReview.behavioral_score));
    setCommunicationScore(scoreOrEmpty(hrReview.communication_score));
    setRedFlags(hrReview.red_flags || "");
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await hrApi.interviewDetail(id);
      setData(res);
      hydrateReview(res.hr_review);
      if (res?.interview?.status === "rejected") {
        setDecision("rejected");
      } else if (res?.interview?.status === "selected") {
        setDecision("selected");
      }
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
        final_score: finalScore ? Number(finalScore) : null,
        behavioral_score: behavioralScore ? Number(behavioralScore) : null,
        communication_score: communicationScore ? Number(communicationScore) : null,
        red_flags: redFlags.trim() || null,
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="center muted">Loading interview...</p>;
  if (error) return <p className="alert error">{error}</p>;
  if (!data?.interview) return <p className="muted">Not found.</p>;

  const { interview, questions, events, hr_review: hrReview } = data;
  const suspiciousEvents = (events || []).filter((event) => event.suspicious);

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
        <h3>HR Review</h3>
        <p className="muted">
          Current: Final {hrReview?.final_score ?? "N/A"} | Behavioral {hrReview?.behavioral_score ?? "N/A"} |
          Communication {hrReview?.communication_score ?? "N/A"}
        </p>
        <div className="inline-row">
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="selected">Selected</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="Final score (0-100)"
            value={finalScore}
            onChange={(e) => setFinalScore(e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={100}
            placeholder="Behavioral score"
            value={behavioralScore}
            onChange={(e) => setBehavioralScore(e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={100}
            placeholder="Communication score"
            value={communicationScore}
            onChange={(e) => setCommunicationScore(e.target.value)}
          />
        </div>
        <textarea
          rows={2}
          placeholder="Red flags / suspicious behavior remarks"
          value={redFlags}
          onChange={(e) => setRedFlags(e.target.value)}
        />
        <textarea
          rows={3}
          placeholder="Final interview notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button onClick={handleFinalize}>Save decision</button>
      </section>

      <section className="card stack-sm">
        <h3>Questions, Answers, and Timing</h3>
        {!questions?.length && <p className="muted">No questions.</p>}
        {!!questions?.length &&
          questions.map((question) => (
            <div
              key={question.id}
              className="stack-sm"
              style={{ borderBottom: "1px solid #e1e7ef", paddingBottom: 8 }}
            >
              <strong>{question.text}</strong>
              <p>
                <em>Answer:</em> {question.answer_text || "(skipped)"}
              </p>
              <p className="muted">
                Time: {question.time_taken_seconds ?? "N/A"}s / {question.allotted_seconds ?? "N/A"}s | Summary:{" "}
                {question.answer_summary || "-"} | Relevance: {question.relevance_score ?? "N/A"}
              </p>
            </div>
          ))}
      </section>

      <section className="card stack-sm">
        <h3>Suspicious Moments ({suspiciousEvents.length})</h3>
        {!events?.length && <p className="muted">No proctoring events.</p>}
        {!!events?.length &&
          events.map((event) => (
            <div
              key={event.id}
              className="inline-row"
              style={{
                borderLeft: event.suspicious ? "4px solid #d33" : "4px solid #cfd8e3",
                paddingLeft: 8,
              }}
            >
              <span>{event.created_at}</span>
              <span>{event.event_type}</span>
              <span>score {event.score ?? 0}</span>
              <span>faces {event.meta_json?.faces_count ?? "N/A"}</span>
              {(event.image_url || event.snapshot_path) && (
                <a href={event.image_url || `/${event.snapshot_path}`} target="_blank" rel="noreferrer">
                  Snapshot
                </a>
              )}
            </div>
          ))}
      </section>
    </div>
  );
}

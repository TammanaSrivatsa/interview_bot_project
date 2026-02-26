import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function Completed() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const message = useMemo(() => {
    if (!sessionId) return "Interview completed successfully.";
    return `Interview session #${sessionId} is completed.`;
  }, [sessionId]);

  return (
    <div className="stack">
      <section className="card stack-sm">
        <h2>Interview Completed</h2>
        <p>{message}</p>
        <p className="muted">
          Your responses and proctoring snapshots have been stored for HR review.
        </p>
        <div className="inline-row">
          <button onClick={() => navigate("/candidate")}>Return to Dashboard</button>
        </div>
      </section>
    </div>
  );
}

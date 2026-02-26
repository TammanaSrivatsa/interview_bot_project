import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { interviewApi } from "../services/api";

const SNAPSHOT_INTERVAL_MS = 2000;

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to capture frame"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.78);
  });
}

export default function Interview() {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const numericResultId = Number(resultId);
  const routeResultId = Number.isFinite(numericResultId) && numericResultId > 0 ? numericResultId : 0;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const captureBusyRef = useRef(false);
  const autoSkipLockRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [sessionId, setSessionId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionNumber, setQuestionNumber] = useState(0);
  const [maxQuestions, setMaxQuestions] = useState(0);
  const [questionTimeLimit, setQuestionTimeLimit] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [remainingTotalSeconds, setRemainingTotalSeconds] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [lastEventType, setLastEventType] = useState("none");
  const [lastFacesCount, setLastFacesCount] = useState(0);
  const [lastMotionScore, setLastMotionScore] = useState(0);

  const hasActiveQuestion = Boolean(sessionId && currentQuestion);

  const timerClassName = useMemo(() => {
    if (remainingSeconds <= 5) return "timer-chip danger";
    if (remainingSeconds <= 15) return "timer-chip warn";
    return "timer-chip";
  }, [remainingSeconds]);

  async function initializeCamera() {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError("Camera permission is required for proctoring.");
    }
  }

  function stopCamera() {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  const bootstrapSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const body = {};
      if (routeResultId > 0) body.result_id = routeResultId;
      const payload = await interviewApi.start(body);
      if (!payload?.session_id) {
        throw new Error("Could not initialize interview session.");
      }
      setSessionId(payload.session_id);
      setCurrentQuestion(payload.current_question || null);
      setQuestionNumber(payload.question_number || 0);
      setMaxQuestions(payload.max_questions || 0);
      setQuestionTimeLimit(payload.time_limit_seconds || 0);
      setRemainingSeconds(payload.time_limit_seconds || 0);
      setRemainingTotalSeconds(payload.remaining_total_seconds || 0);

      if (!payload.current_question || payload.interview_completed) {
        navigate(`/interview/${routeResultId}/completed?sessionId=${payload.session_id}`, { replace: true });
        return;
      }
      setNotice("Interview started. Questions are generated progressively.");
    } catch (initError) {
      setError(initError.message);
    } finally {
      setLoading(false);
    }
  }, [navigate, routeResultId]);

  const uploadSnapshot = useCallback(async () => {
    if (!sessionId || !hasActiveQuestion) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    const formData = new FormData();
    formData.append("file", blob, `scan_${Date.now()}.jpg`);
    formData.append("session_id", String(sessionId));
    formData.append("event_type", "scan");

    const response = await interviewApi.uploadProctorFrame(formData);
    setLastEventType(response?.event_type || "none");
    setLastFacesCount(Number(response?.faces_count ?? 0));
    setLastMotionScore(Number(response?.motion_score ?? 0));
    if (response?.suspicious) {
      setNotice(`Suspicious event captured: ${response.event_type}`);
    }
  }, [hasActiveQuestion, sessionId]);

  const submitAnswer = useCallback(
    async (skipped = false) => {
      if (!sessionId || !currentQuestion || submitting) return;

      setSubmitting(true);
      setError("");
      try {
        const elapsed = Math.max(0, questionTimeLimit - remainingSeconds);
        const timeTaken = skipped
          ? questionTimeLimit
          : Math.max(1, Math.min(questionTimeLimit, elapsed));

        const response = await interviewApi.submitAnswer({
          session_id: sessionId,
          question_id: currentQuestion.id,
          answer_text: skipped ? "" : answerText.trim(),
          skipped,
          time_taken_sec: timeTaken,
        });

        if (response?.interview_completed || !response?.next_question) {
          navigate(`/interview/${routeResultId}/completed?sessionId=${sessionId}`, {
            replace: true,
          });
          return;
        }

        setCurrentQuestion(response.next_question);
        setQuestionNumber(response.question_number || questionNumber + 1);
        setMaxQuestions(response.max_questions || maxQuestions);
        setQuestionTimeLimit(response.time_limit_seconds || questionTimeLimit);
        setRemainingSeconds(response.time_limit_seconds || questionTimeLimit);
        setRemainingTotalSeconds(response.remaining_total_seconds || remainingTotalSeconds);
        setAnswerText("");
        autoSkipLockRef.current = false;
      } catch (submitError) {
        setError(submitError.message);
      } finally {
        setSubmitting(false);
      }
    },
    [
      answerText,
      currentQuestion,
      maxQuestions,
      navigate,
      questionNumber,
      questionTimeLimit,
      remainingSeconds,
      remainingTotalSeconds,
      routeResultId,
      sessionId,
      submitting,
    ],
  );

  useEffect(() => {
    initializeCamera();
    bootstrapSession();
    return () => {
      stopCamera();
    };
  }, [bootstrapSession]);

  useEffect(() => {
    if (!hasActiveQuestion || submitting) return undefined;
    if (remainingSeconds <= 0 || remainingTotalSeconds <= 0) {
      if (!autoSkipLockRef.current) {
        autoSkipLockRef.current = true;
        void submitAnswer(true);
      }
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      setRemainingSeconds((value) => Math.max(0, value - 1));
      setRemainingTotalSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasActiveQuestion, remainingSeconds, remainingTotalSeconds, submitAnswer, submitting]);

  useEffect(() => {
    if (!hasActiveQuestion) return undefined;
    const intervalId = setInterval(() => {
      if (captureBusyRef.current) return;
      captureBusyRef.current = true;
      void uploadSnapshot().finally(() => {
        captureBusyRef.current = false;
      });
    }, SNAPSHOT_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [hasActiveQuestion, uploadSnapshot]);

  if (loading) {
    return <p className="center muted">Loading interview session...</p>;
  }

  return (
    <div className="stack">
      <header className="title-row">
        <h2>Timed Interview</h2>
        <span className={timerClassName}>Q Timer: {remainingSeconds}s</span>
      </header>

      {error && <p className="alert error">{error}</p>}
      {notice && <p className="alert success">{notice}</p>}

      <section className="card stack-sm">
        <p>
          Question {questionNumber} / {maxQuestions} | Total Time Left: {remainingTotalSeconds}s
        </p>
        <div className="question-box">
          {currentQuestion?.text || "No active question. Complete this interview session."}
        </div>
        <textarea
          rows={6}
          value={answerText}
          onChange={(event) => setAnswerText(event.target.value)}
          placeholder="Write your answer here..."
          disabled={!hasActiveQuestion || submitting}
        />
        <div className="inline-row">
          <button disabled={!hasActiveQuestion || submitting} onClick={() => submitAnswer(false)}>
            {submitting ? "Submitting..." : "Submit Answer"}
          </button>
          <button disabled={!hasActiveQuestion || submitting} onClick={() => submitAnswer(true)}>
            Skip Question
          </button>
        </div>
      </section>

      <section className="card stack-sm">
        <h3>Proctoring Feed (OpenCV Backend)</h3>
        <video ref={videoRef} className="interview-video" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden-canvas" />
        <p className="muted">
          Last Event: {lastEventType} | Faces: {lastFacesCount} | Motion: {lastMotionScore.toFixed(3)}
        </p>
      </section>
    </div>
  );
}

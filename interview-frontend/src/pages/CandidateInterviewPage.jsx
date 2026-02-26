import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { interviewApi } from "../services/api";

const TICK_MS = 1000;
const PROCTOR_MS = 1500;
const MOTION_THRESHOLD = 0.15;
const FACE_MISSING_THRESHOLD_MS = 2000;

function canvasDiff(ctx, prevData, width, height) {
  const curr = ctx.getImageData(0, 0, width, height);
  if (!prevData) return { diff: 0, data: curr };
  let diff = 0;
  for (let i = 0; i < curr.data.length; i += 10) {
    diff += Math.abs(curr.data[i] - prevData.data[i]);
  }
  return { diff: diff / (curr.data.length / 10) / 255, data: curr };
}

function hasFace(canvas, detectorRef) {
  if (detectorRef.current === undefined) {
    if ("FaceDetector" in window) detectorRef.current = new window.FaceDetector({ fastMode: true });
    else detectorRef.current = null;
  }
  if (!detectorRef.current) return Promise.resolve(true); // assume face present if unsupported
  return detectorRef.current
    .detect(canvas)
    .then((faces) => faces.length > 0)
    .catch(() => true);
}

export default function CandidateInterviewPage() {
  const { token: pathToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || pathToken;
  const [state, setState] = useState({ loading: true, error: "", interview: null, idx: 0, answer: "" });
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const lastFrameRef = useRef(null);
  const lastFaceSeenRef = useRef(Date.now());
  const detectorRef = useRef();

  const questions = state.interview?.questions || [];
  const current = questions[state.idx] || null;
  const timeLimit = state.interview?.time_limit_seconds || 45;

  useEffect(() => {
    async function init() {
      try {
        if (!token) {
          throw new Error("Missing interview token");
        }
        const data = await interviewApi.startByToken(token);
        setState((s) => ({ ...s, interview: data, loading: false, idx: 0 }));
        setRemaining(data.time_limit_seconds || 45);
      } catch (err) {
        setState((s) => ({ ...s, error: err.message, loading: false }));
      }
    }
    init();
  }, [token]);

  useEffect(() => {
    async function startCam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        // ignore
      }
    }
    startCam();
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!current) return undefined;
    setRemaining(timeLimit);
    const id = setInterval(() => setRemaining((t) => Math.max(0, t - 1)), TICK_MS);
    return () => clearInterval(id);
  }, [current, timeLimit]);

  useEffect(() => {
    if (!current) return;
    if (remaining === 0 && !submitting) {
      handleSubmit(true);
    }
  }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !current) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const { diff, data } = canvasDiff(ctx, lastFrameRef.current, w, h);
      lastFrameRef.current = { data };

      const facePresent = await hasFace(canvas, detectorRef);
      if (facePresent) lastFaceSeenRef.current = Date.now();

      const events = [];
      if (diff > MOTION_THRESHOLD) {
        events.push({ event_type: "EXCESSIVE_MOVEMENT", confidence: Math.min(1, diff) });
      }
      if (Date.now() - lastFaceSeenRef.current > FACE_MISSING_THRESHOLD_MS) {
        events.push({ event_type: "FACE_MISSING", confidence: 1 });
      }

      for (const ev of events) {
        let snapshot_base64 = null;
        try {
          snapshot_base64 = canvas.toDataURL("image/jpeg", 0.7);
        } catch {
          /* noop */
        }
        interviewApi.eventByToken(token, {
          ...ev,
          question_id: current.id,
          snapshot_base64,
        });
      }
    }, PROCTOR_MS);
    return () => clearInterval(timer);
  }, [current, token]);

  async function handleSubmit(skip = false) {
    if (!current) return;
    setSubmitting(true);
    try {
      await interviewApi.answerByToken(token, {
        question_id: current.id,
        answer_text: skip ? "" : state.answer,
        skipped: skip,
        time_taken_seconds: timeLimit - remaining,
      });
      const nextIdx = state.idx + 1;
      if (nextIdx >= questions.length) {
        setState((s) => ({ ...s, idx: nextIdx, answer: "" }));
        return;
      }
      setState((s) => ({ ...s, idx: nextIdx, answer: "" }));
      setRemaining(timeLimit);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setSubmitting(false);
    }
  }

  const timerText = useMemo(() => {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [remaining]);

  if (state.loading) return <p className="center muted">Loading interview...</p>;
  if (state.error) return <p className="alert error">{state.error}</p>;
  if (!current) return <p className="muted">No more questions.</p>;

  return (
    <div className="stack">
      <header className="title-row">
        <h2>Interview</h2>
        <span className="timer-chip">{timerText}</span>
      </header>

      <section className="card stack-sm">
        <p className="muted">Question {state.idx + 1} / {questions.length}</p>
        <div className="question-box">{current.text}</div>
        <textarea
          rows={6}
          value={state.answer}
          onChange={(e) => setState((s) => ({ ...s, answer: e.target.value }))}
          placeholder="Type your answer..."
        />
        <div className="inline-row">
          <button disabled={submitting} onClick={() => handleSubmit(false)}>
            {submitting ? "Submitting..." : "Submit"}
          </button>
          <button disabled={submitting} onClick={() => handleSubmit(true)}>
            Skip
          </button>
        </div>
      </section>

      <section className="card stack-sm">
        <h3>Proctoring</h3>
        <video ref={videoRef} className="interview-video" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden-canvas" />
      </section>
    </div>
  );
}

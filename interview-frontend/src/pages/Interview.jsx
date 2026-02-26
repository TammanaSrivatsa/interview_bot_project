import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { interviewApi } from "../services/api";

const SNAPSHOT_INTERVAL_MS = 2000;
const PERIODIC_UPLOAD_MS = 10000;
const MOTION_THRESHOLD = 0.18;

function computeMotionScore(previousFrame, currentFrame) {
  if (!previousFrame || !currentFrame) return 0;
  const prev = previousFrame.data;
  const curr = currentFrame.data;
  const stride = 16;
  let diffTotal = 0;
  let maxTotal = 0;

  for (let i = 0; i < prev.length; i += stride) {
    diffTotal += Math.abs(prev[i] - curr[i]);
    diffTotal += Math.abs(prev[i + 1] - curr[i + 1]);
    diffTotal += Math.abs(prev[i + 2] - curr[i + 2]);
    maxTotal += 255 * 3;
  }
  if (!maxTotal) return 0;
  return diffTotal / maxTotal;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to capture frame"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.75);
  });
}

async function detectFaces(canvas, detectorRef) {
  if (detectorRef.current === undefined) {
    if (typeof window !== "undefined" && "FaceDetector" in window) {
      detectorRef.current = new window.FaceDetector({
        fastMode: true,
        maxDetectedFaces: 5,
      });
    } else {
      detectorRef.current = null;
    }
  }

  if (!detectorRef.current) {
    return 1;
  }

  try {
    const faces = await detectorRef.current.detect(canvas);
    return faces.length;
  } catch {
    return 1;
  }
}

export default function Interview() {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const numericResultId = Number(resultId);
  const routeResultId = Number.isFinite(numericResultId) && numericResultId > 0 ? numericResultId : 0;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceDetectorRef = useRef();
  const lastFrameRef = useRef(null);
  const lastUploadAtRef = useRef(0);
  const captureBusyRef = useRef(false);
  const autoSkipLockRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionData, setSessionData] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [motionScore, setMotionScore] = useState(0);
  const [facesCount, setFacesCount] = useState(1);

  const questions = sessionData?.questions || [];
  const sessionId = sessionData?.session_id || null;
  const perQuestionSeconds = sessionData?.per_question_seconds || 60;
  const currentQuestion = questions[currentIndex] || null;
  const totalQuestions = questions.length;
  const hasActiveQuestion = Boolean(currentQuestion && sessionId);

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
      const startPayload = await interviewApi.start(body);
      if (!startPayload?.session_id || !Array.isArray(startPayload?.questions)) {
        throw new Error("Interview session payload is invalid.");
      }
      setSessionData(startPayload);
      setCurrentIndex(0);
      setRemainingSeconds(startPayload.per_question_seconds || 60);
      setNotice("Interview started. Timer runs per question.");
    } catch (initError) {
      setError(initError.message);
    } finally {
      setLoading(false);
    }
  }, [routeResultId]);

  const uploadSnapshot = useCallback(
    async (canvas, flags, motion, faces, eventType) => {
      if (!sessionId) return;
      const blob = await canvasToBlob(canvas);
      const formData = new FormData();
      formData.append("file", blob, `frame_${Date.now()}.jpg`);
      formData.append("session_id", String(sessionId));
      formData.append("event_flags", JSON.stringify(flags));
      formData.append("motion_score", String(motion));
      formData.append("faces_count", String(faces));
      formData.append("event_type", eventType);
      await interviewApi.uploadProctorFrame(formData);
      lastUploadAtRef.current = Date.now();
    },
    [sessionId],
  );

  const proctorTick = useCallback(async () => {
    if (!sessionId || !hasActiveQuestion) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const currentFrame = ctx.getImageData(0, 0, width, height);
    const motion = computeMotionScore(lastFrameRef.current, currentFrame);
    lastFrameRef.current = currentFrame;

    const faces = await detectFaces(canvas, faceDetectorRef);
    const flags = {
      no_face: faces === 0,
      multi_face: faces > 1,
      high_motion: motion > MOTION_THRESHOLD,
    };
    const suspicious = flags.no_face || flags.multi_face || flags.high_motion;
    const periodic = Date.now() - lastUploadAtRef.current >= PERIODIC_UPLOAD_MS;

    setMotionScore(motion);
    setFacesCount(faces);

    if (!suspicious && !periodic) return;
    const eventType = suspicious ? "suspicious" : "periodic";
    try {
      await uploadSnapshot(canvas, flags, motion, faces, eventType);
    } catch {
      setNotice("Proctor frame upload failed; retrying automatically.");
    }
  }, [hasActiveQuestion, sessionId, uploadSnapshot]);

  const submitAnswer = useCallback(
    async (skipped = false) => {
      if (!sessionId || !currentQuestion || submitting) return;

      setSubmitting(true);
      setError("");
      try {
        const elapsed = Math.max(0, perQuestionSeconds - remainingSeconds);
        const timeTaken = skipped
          ? perQuestionSeconds
          : Math.max(1, Math.min(perQuestionSeconds, elapsed));
        const response = await interviewApi.submitAnswer({
          session_id: sessionId,
          question_id: currentQuestion.id,
          answer_text: skipped ? "" : answerText.trim(),
          skipped,
          time_taken_sec: timeTaken,
        });

        const nextIndex = response?.next_question_index;
        if (
          response?.interview_completed ||
          nextIndex === null ||
          nextIndex === undefined ||
          nextIndex >= totalQuestions
        ) {
          navigate(`/interview/${routeResultId}/completed?sessionId=${sessionId}`, {
            replace: true,
          });
          return;
        }

        setCurrentIndex(nextIndex);
        setAnswerText("");
        setRemainingSeconds(perQuestionSeconds);
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
      navigate,
      perQuestionSeconds,
      remainingSeconds,
      routeResultId,
      sessionId,
      submitting,
      totalQuestions,
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
    if (!sessionId || !hasActiveQuestion) return;
    setRemainingSeconds(perQuestionSeconds);
    autoSkipLockRef.current = false;
  }, [sessionId, hasActiveQuestion, currentIndex, perQuestionSeconds]);

  useEffect(() => {
    if (!sessionId || !hasActiveQuestion || submitting) return undefined;
    if (remainingSeconds <= 0) {
      if (!autoSkipLockRef.current) {
        autoSkipLockRef.current = true;
        void submitAnswer(true);
      }
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      setRemainingSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasActiveQuestion, remainingSeconds, sessionId, submitAnswer, submitting]);

  useEffect(() => {
    if (!sessionId || !hasActiveQuestion) return undefined;
    const intervalId = setInterval(() => {
      if (captureBusyRef.current) return;
      captureBusyRef.current = true;
      void proctorTick().finally(() => {
        captureBusyRef.current = false;
      });
    }, SNAPSHOT_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [hasActiveQuestion, proctorTick, sessionId]);

  if (loading) {
    return <p className="center muted">Loading interview session...</p>;
  }

  return (
    <div className="stack">
      <header className="title-row">
        <h2>Timed Interview</h2>
        <span className={timerClassName}>Time Left: {remainingSeconds}s</span>
      </header>

      {error && <p className="alert error">{error}</p>}
      {notice && <p className="alert success">{notice}</p>}

      <section className="card stack-sm">
        <p>
          Question {Math.min(currentIndex + 1, totalQuestions)} / {totalQuestions}
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
        <h3>Proctoring Feed</h3>
        <video ref={videoRef} className="interview-video" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden-canvas" />
        <p className="muted">
          Faces: {facesCount} | Motion Score: {motionScore.toFixed(3)} | Capture every{" "}
          {SNAPSHOT_INTERVAL_MS / 1000}s
        </p>
      </section>
    </div>
  );
}

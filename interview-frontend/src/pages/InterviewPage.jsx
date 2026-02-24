import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { interviewApi } from "../services/api";

export default function InterviewPage() {
  const { resultId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const parsedResultId = Number(resultId);
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const keepListeningRef = useRef(false);

  async function requestMediaAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setMediaReady(true);
      return true;
    } catch {
      setError("Camera and microphone permission is required.");
      return false;
    }
  }

  async function startVoiceInput() {
    setError("");
    if (listening) return;
    const hasMedia = mediaReady || (await requestMediaAccess());
    if (!hasMedia) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stale state
      }
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let transcript = answer ? `${answer} ` : "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += `${event.results[i][0].transcript} `;
      }
      setAnswer(transcript.trim());
    };
    recognition.onerror = (event) => {
      keepListeningRef.current = false;
      setListening(false);
      setVoiceStatus("Voice input stopped.");
      setError(`Voice input error: ${event?.error || "unknown"}`);
    };
    recognition.onend = () => {
      if (keepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          // continue to stop path
        }
      }
      setListening(false);
      setVoiceStatus("Voice input stopped.");
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    recognition.start();
    setListening(true);
    setVoiceStatus("Listening...");
  }

  function stopVoiceInput() {
    keepListeningRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    setListening(false);
    setVoiceStatus("Voice input stopped.");
  }

  async function initializeInterview() {
    if (!parsedResultId || !token) {
      setError("Invalid interview link.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await interviewApi.info(parsedResultId, token);
      setCandidateName(response.candidate_name || "");
    } catch (initError) {
      setError(initError.message);
    } finally {
      setLoading(false);
    }
  }

  async function startInterview() {
    setSubmitting(true);
    setError("");
    try {
      const hasMedia = mediaReady || (await requestMediaAccess());
      if (!hasMedia) return;
      await interviewApi.info(parsedResultId, token);
      const next = await interviewApi.nextQuestion({
        result_id: parsedResultId,
        token,
        last_answer: "",
      });
      setQuestion(next.question || "");
    } catch (startError) {
      setError(startError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function askNextQuestion() {
    setSubmitting(true);
    setError("");
    try {
      const next = await interviewApi.nextQuestion({
        result_id: parsedResultId,
        token,
        last_answer: answer,
      });
      if (next.question === "INTERVIEW_COMPLETE") {
        setQuestion("Interview completed. Thank you.");
      } else {
        setQuestion(next.question || "Could not fetch question.");
      }
      setAnswer("");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    initializeInterview();
    return () => {
      keepListeningRef.current = false;
      if (recognitionRef.current) recognitionRef.current.stop();
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, [parsedResultId, token]);

  return (
    <div className="stack">
      <header className="title-row">
        <h2>AI Interview Session</h2>
        <button onClick={() => navigate("/")}>Back</button>
      </header>

      {loading && <p className="muted">Loading interview session...</p>}
      {error && <p className="alert error">{error}</p>}
      {!loading && !error && (
        <section className="card stack-sm">
          <p>
            <strong>Candidate:</strong> {candidateName}
          </p>
          <video ref={videoRef} className="interview-video" autoPlay muted playsInline />
          <div className="inline-row">
            <button disabled={mediaReady} onClick={requestMediaAccess}>
              {mediaReady ? "Camera & Mic Ready" : "Enable Camera & Mic"}
            </button>
            <button disabled={submitting || !!question} onClick={startInterview}>
              Start Interview
            </button>
          </div>
          <div className="question-box">{question || "Click Start Interview to begin."}</div>
          <textarea
            rows={4}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type answer or use voice input..."
          />
          <div className="inline-row">
            <button disabled={listening} onClick={startVoiceInput}>
              Start Voice Input
            </button>
            <button disabled={!listening} onClick={stopVoiceInput}>
              Stop Voice Input
            </button>
            <button disabled={submitting || !question} onClick={askNextQuestion}>
              {submitting ? "Submitting..." : "Next Question"}
            </button>
          </div>
          {voiceStatus && <p className="muted">{voiceStatus}</p>}
        </section>
      )}
    </div>
  );
}

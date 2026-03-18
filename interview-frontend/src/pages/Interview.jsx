/**
 * Interview.jsx — Live interview page with enhanced proctoring + TTS (Indian accent).
 *
 * FIXES IN THIS FILE:
 *   C2: Pass resultId to useProctoring so tab-switch events route to the correct backend endpoint
 *   I1: Handle HTTP 400 "already answered" gracefully — treat as success, reload session
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Mic, MicOff, Send, MessageSquare, CheckCircle2,
  Activity, AlertTriangle, Eye, EyeOff, Brain,
  Volume2, VolumeX,
} from "lucide-react";
import { interviewApi, proctorApi } from "../services/api";
import { cn } from "../utils/utils";
import AnswerFeedback from "../components/AnswerFeedback";
import { useProctoring } from "../hooks/useProctoring";

// ── TTS hook ──────────────────────────────────────────────────────────────────
function useTTS() {
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    const priority = ["en-IN", "en-GB", "en-US"];
    for (const lang of priority) {
      const v = voices.find((v) => v.lang === lang);
      if (v) return v;
    }
    return voices.find((v) => v.lang.startsWith("en")) || null;
  }, []);

  const speak = useCallback((text) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.volume = muted ? 0 : 1;

    const applyVoice = () => {
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
    };

    utterance.onstart = () => setSpeaking(true);
    utterance.onend   = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        applyVoice();
        window.speechSynthesis.speak(utterance);
      };
    } else {
      applyVoice();
      window.speechSynthesis.speak(utterance);
    }
  }, [muted, pickVoice]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    stop();
    setMuted((m) => !m);
  }, [stop]);

  useEffect(() => () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  return { speak, stop, speaking, muted, toggleMute };
}

// ── tiny helpers ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function appendTranscript(current, next) {
  const base = String(current || "").trim();
  const t    = String(next   || "").trim();
  if (!t)    return base;
  if (!base) return t;
  return `${base} ${t}`;
}

function hasActiveAudioTrack(stream) {
  if (!stream) return false;
  return stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled !== false);
}

function stopStreamTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

function getPreferredAudioMimeType() {
  if (typeof window === "undefined" || !window.MediaRecorder) return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((t) => window.MediaRecorder.isTypeSupported(t)) || "";
}

const EMOTION_COLOR = {
  confident: "text-emerald-400",
  focused:   "text-blue-400",
  neutral:   "text-slate-400",
  nervous:   "text-amber-400",
};

function VoiceConfidenceBar({ metrics }) {
  if (!metrics) return null;
  const pct = Math.round(metrics.confidence_score * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-400 uppercase tracking-widest font-bold">Voice</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-300 font-black w-8 text-right">{pct}%</span>
    </div>
  );
}

function TabSwitchAlert({ count }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-2xl text-red-400 text-xs font-bold animate-pulse">
      <AlertTriangle size={14} />
      Tab switch detected × {count} — this is recorded
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Interview() {
  const { resultId } = useParams();
  const navigate     = useNavigate();

  const [sessionId,       setSessionId]       = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionNumber,  setQuestionNumber]  = useState(1);
  const [maxQuestions,    setMaxQuestions]     = useState(1);
  const [answer,          setAnswer]           = useState("");
  const [isRecording,     setIsRecording]      = useState(false);
  const [isTranscribing,  setIsTranscribing]   = useState(false);
  const [timeLeft,        setTimeLeft]         = useState(0);
  const [totalTimeLeft,   setTotalTimeLeft]    = useState(0);
  const [transcripts,     setTranscripts]      = useState([]);
  const [loading,         setLoading]          = useState(true);
  const [isSubmitting,    setIsSubmitting]     = useState(false);
  const [error,           setError]            = useState("");
  const [transcriptionWarning, setTranscriptionWarning] = useState("");
  const [previewReady,    setPreviewReady]     = useState(false);
  const [previewWarning,  setPreviewWarning]   = useState("");
  const [answerFeedback,  setAnswerFeedback]   = useState(null);

  const videoRef             = useRef(null);
  const autoSubmittedRef     = useRef(false);
  const baselineCapturedRef  = useRef(false);
  const streamRef            = useRef(null);
  const audioStreamRef       = useRef(null);
  const recorderRef          = useRef(null);
  const recordedChunksRef    = useRef([]);
  const answerStartTimeRef   = useRef(null);

  // ── TTS ────────────────────────────────────────────────────────────────────
  const { speak, stop: stopSpeaking, speaking, muted, toggleMute } = useTTS();

  // ── proctoring ─────────────────────────────────────────────────────────────
  // FIX C2: Pass resultId to useProctoring so tab-switch events go to the correct
  // backend route /api/interview/{resultId}/event (not /api/interview/{sessionId}/event)
  const {
    proctoringEvents,
    voiceMetrics,
    emotionSignal,
    emotionEnabled,
    analyseAnswer,
  } = useProctoring({ sessionId, resultId, videoRef, enabled: !!sessionId });

  const tabSwitchCount = proctoringEvents.filter((e) => e.type === "TAB_SWITCH").length;

  // ── session load ───────────────────────────────────────────────────────────
  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const consentGiven = sessionStorage.getItem(`interview-consent:${resultId}`) === "true";
      const response = await interviewApi.start({
        result_id: Number(resultId),
        consent_given: consentGiven,
      });

      if (response.interview_completed || !response.current_question) {
        navigate(`/interview/${resultId}/completed`, { replace: true });
        return;
      }

      setSessionId(response.session_id);
      sessionStorage.setItem(`session-id:${resultId}`, String(response.session_id));
      setCurrentQuestion(response.current_question);
      setQuestionNumber(response.question_number || 1);
      setMaxQuestions(response.max_questions || 1);
      setTimeLeft(response.time_limit_seconds || 0);
      setTotalTimeLeft(response.remaining_total_seconds || 0);
      baselineCapturedRef.current = false;
      autoSubmittedRef.current    = false;
      answerStartTimeRef.current  = Date.now();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate, resultId]);

  const releaseAudioStream = useCallback(() => {
    if (audioStreamRef.current) { stopStreamTracks(audioStreamRef.current); audioStreamRef.current = null; }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  // ── AUTO-SPEAK question ────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentQuestion?.text || loading || answerFeedback) return;
    if (muted) return;
    const timer = setTimeout(() => {
      speak(currentQuestion.text);
    }, 700);
    return () => {
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  useEffect(() => {
    if (isRecording || isSubmitting) stopSpeaking();
  }, [isRecording, isSubmitting, stopSpeaking]);

  // ── camera setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;

    async function startPreview() {
      setPreviewReady(false);
      setPreviewWarning("");

      if (streamRef.current) { stopStreamTracks(streamRef.current); streamRef.current = null; }

      let waited = 0;
      while (!videoRef.current && waited < 2000) {
        await new Promise((r) => setTimeout(r, 50));
        waited += 50;
      }

      if (disposed) return;

      const videoEl = videoRef.current;
      if (!videoEl) {
        setPreviewWarning("Camera preview element not ready. Refresh and try again.");
        return;
      }

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          setPreviewWarning("Microphone unavailable. Camera preview still active.");
        } catch {
          setPreviewWarning("Camera unavailable — please allow camera access in your browser.");
          return;
        }
      }

      if (disposed) { stopStreamTracks(stream); return; }

      streamRef.current = stream;
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;

      try {
        await videoEl.play();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
        try { await videoEl.play(); } catch { /* srcObject is still set */ }
      }

      const pollStart = Date.now();
      const poll = () => {
        if (disposed) return;
        if (videoEl.videoWidth > 0 && videoEl.readyState >= 2) {
          setPreviewReady(true);
        } else if (Date.now() - pollStart < 8000) {
          setTimeout(poll, 200);
        } else {
          setPreviewReady(true);
        }
      };
      setTimeout(poll, 200);
    }

    startPreview();

    return () => {
      disposed = true;
      const rec = recorderRef.current;
      if (rec) {
        rec.ondataavailable = null; rec.onerror = null; rec.onstop = null;
        if (rec.state !== "inactive") rec.stop();
        recorderRef.current = null;
      }
      releaseAudioStream();
      if (streamRef.current) { stopStreamTracks(streamRef.current); streamRef.current = null; }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [releaseAudioStream]);

  // ── timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentQuestion || loading || isSubmitting || answerFeedback) return;
    const id = setInterval(() => {
      setTimeLeft((p)      => (p > 0 ? p - 1 : 0));
      setTotalTimeLeft((p) => (p > 0 ? p - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [currentQuestion, isSubmitting, loading, answerFeedback]);

  // ── advance after answer ───────────────────────────────────────────────────
  const _advanceAfterAnswer = useCallback((response) => {
    stopSpeaking();
    if (response.interview_completed || !response.next_question) {
      navigate(`/interview/${resultId}/completed`);
      return;
    }
    setCurrentQuestion(response.next_question);
    setQuestionNumber(response.question_number || questionNumber + 1);
    setMaxQuestions(response.max_questions || maxQuestions);
    setTimeLeft(response.time_limit_seconds || 0);
    setTotalTimeLeft(response.remaining_total_seconds || 0);
    setAnswer("");
    setTranscriptionWarning("");
    setIsRecording(false);
    setIsTranscribing(false);
    autoSubmittedRef.current   = false;
    answerStartTimeRef.current = Date.now();
    setAnswerFeedback(null);
  }, [navigate, resultId, questionNumber, maxQuestions, stopSpeaking]);

  // ── submit answer ──────────────────────────────────────────────────────────
  const submitAnswer = useCallback(async ({ skipCurrent = false, answerOverride } = {}) => {
    if (!sessionId || !currentQuestion) return;
    const resolvedAnswer  = skipCurrent ? "" : String(answerOverride ?? answer);
    const normalizedAnswer = resolvedAnswer.trim();
    const durationSeconds  = answerStartTimeRef.current
      ? (Date.now() - answerStartTimeRef.current) / 1000 : 0;

    setIsSubmitting(true);
    setError("");
    try {
      const timeTaken = Math.max(0, (currentQuestion.allotted_seconds || 0) - timeLeft);
      const response = await interviewApi.submitAnswer({
        session_id:  sessionId,
        question_id: currentQuestion.id,
        answer_text: skipCurrent ? "" : resolvedAnswer,
        skipped:     skipCurrent || !normalizedAnswer,
        time_taken_sec: timeTaken,
      });

      if (!skipCurrent && normalizedAnswer) analyseAnswer(normalizedAnswer, durationSeconds);

      setTranscripts((prev) => [...prev, { q: currentQuestion.text, a: skipCurrent ? "" : resolvedAnswer }]);

      if (response.feedback && !skipCurrent && normalizedAnswer) {
        stopSpeaking();
        setAnswerFeedback({ ...response.feedback, _nextResponse: response });
        return;
      }

      _advanceAfterAnswer(response);
    } catch (e) {
      // FIX I1: If the question was already answered (double-submit or race condition),
      // treat it as success and reload session to get the next unanswered question.
      // Previously this showed a confusing red error to the candidate.
      if (e.message && e.message.toLowerCase().includes("already answered")) {
        autoSubmittedRef.current = false;
        setError("");
        await loadSession();
        return;
      }
      setError(e.message);
      autoSubmittedRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  }, [answer, currentQuestion, _advanceAfterAnswer, sessionId, timeLeft, analyseAnswer, stopSpeaking, loadSession]);

  // ── recording ──────────────────────────────────────────────────────────────
  const stopRecordingAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return { text: "", lowConfidence: true, confidence: null };
    setIsRecording(false);
    setIsTranscribing(true);
    setError("");
    try {
      return await new Promise((resolve, reject) => {
        recorder.onerror = (ev) => reject(new Error(ev?.error?.message || "Recording failed."));
        recorder.onstop = async () => {
          recorderRef.current = null;
          try {
            const mimeType = recorder.mimeType || getPreferredAudioMimeType() || "audio/webm";
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            recordedChunksRef.current = [];
            releaseAudioStream();
            if (!blob.size) { resolve({ text: "", lowConfidence: true, confidence: null }); return; }
            const fd = new FormData();
            const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
            fd.append("audio", blob, `answer.${ext}`);
            fd.append("language", (navigator.language || "en").split("-")[0] || "en");
            fd.append("context_hint", String(currentQuestion?.text || ""));
            const res = await interviewApi.transcribe(fd);
            resolve({
              text: String(res?.text || "").trim(),
              lowConfidence: Boolean(res?.low_confidence),
              confidence: typeof res?.confidence === "number" ? res.confidence : null,
            });
          } catch (e) { reject(e); }
        };
        recorder.stop();
      });
    } finally {
      setIsTranscribing(false);
    }
  }, [currentQuestion, releaseAudioStream]);

  const startRecording = useCallback(async () => {
    if (!window.MediaRecorder) { setError("Voice recording not supported. Use Chrome or Edge."); return; }
    setError(""); setTranscriptionWarning("");
    stopSpeaking();
    try {
      let recStream;
      if (hasActiveAudioTrack(streamRef.current)) {
        recStream = new MediaStream(streamRef.current.getAudioTracks());
      } else {
        recStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStreamRef.current = recStream;
      }
      recordedChunksRef.current = [];
      const mimeType = getPreferredAudioMimeType();
      const rec = mimeType
        ? new window.MediaRecorder(recStream, { mimeType })
        : new window.MediaRecorder(recStream);
      rec.ondataavailable = (ev) => { if (ev.data?.size > 0) recordedChunksRef.current.push(ev.data); };
      rec.onerror = () => {
        recorderRef.current = null; recordedChunksRef.current = []; releaseAudioStream();
        setIsRecording(false); setError("Recording failed. Check microphone access.");
      };
      rec.start();
      recorderRef.current = rec;
      answerStartTimeRef.current = Date.now();
      setIsRecording(true);
    } catch {
      releaseAudioStream();
      setError("Microphone access unavailable. Allow permission and try again.");
    }
  }, [releaseAudioStream, stopSpeaking]);

  const handleRecordingToggle = useCallback(async () => {
    if (isSubmitting || isTranscribing) return;
    if (!isRecording) { await startRecording(); return; }
    try {
      const t = await stopRecordingAndTranscribe();
      if (!t.text) { setError("No speech detected. Try again or type your answer."); return; }
      if (t.lowConfidence) {
        const suf = typeof t.confidence === "number" ? ` (confidence ${(t.confidence * 100).toFixed(0)}%)` : "";
        setTranscriptionWarning(`Whisper was unsure about parts of this answer${suf}. Review before submitting.`);
      } else { setTranscriptionWarning(""); }
      setAnswer((prev) => appendTranscript(prev, t.text));
    } catch (e) { setError(e.message); }
  }, [isRecording, isSubmitting, isTranscribing, startRecording, stopRecordingAndTranscribe]);

  // ── proctoring frame capture ───────────────────────────────────────────────
  const captureAndUploadFrame = useCallback(async (eventType = "scan") => {
    if (!sessionId || !videoRef.current || !previewReady) return;
    try {
      const canvas = document.createElement("canvas");
      const ctx    = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width  = videoRef.current.videoWidth  || 320;
      canvas.height = videoRef.current.videoHeight || 240;
      ctx.drawImage(videoRef.current, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.7));
      if (!blob) return;
      await proctorApi.uploadFrame(sessionId, blob, eventType);
    } catch { /* silent */ }
  }, [sessionId, previewReady]);

  useEffect(() => {
    if (!sessionId || !previewReady || baselineCapturedRef.current) return;
    baselineCapturedRef.current = true;
    const t = setTimeout(() => void captureAndUploadFrame("baseline"), 2000);
    return () => clearTimeout(t);
  }, [sessionId, previewReady, captureAndUploadFrame]);

  useEffect(() => {
    if (!sessionId || !previewReady) return;
    const id = setInterval(() => void captureAndUploadFrame("scan"), 15000);
    return () => clearInterval(id);
  }, [sessionId, previewReady, captureAndUploadFrame]);

  // ── auto-submit on timer expiry ────────────────────────────────────────────
  const handleSubmit = useCallback(async (skipCurrent = false) => {
    if (isSubmitting || isTranscribing) return;
    let nextAnswer = answer;
    if (isRecording) {
      try {
        const t = await stopRecordingAndTranscribe();
        nextAnswer = appendTranscript(answer, t.text);
        if (t.lowConfidence) {
          const suf = typeof t.confidence === "number" ? ` (${(t.confidence * 100).toFixed(0)}%)` : "";
          setTranscriptionWarning(`Whisper was unsure${suf}. Review before submitting.`);
        } else { setTranscriptionWarning(""); }
        if (t.text) setAnswer(nextAnswer);
      } catch (e) { setError(e.message); autoSubmittedRef.current = false; return; }
    }
    await submitAnswer({ skipCurrent, answerOverride: nextAnswer });
  }, [answer, isRecording, isSubmitting, isTranscribing, stopRecordingAndTranscribe, submitAnswer]);

  useEffect(() => {
    if (!currentQuestion || isSubmitting || isTranscribing || answerFeedback) return;
    if (timeLeft > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    void handleSubmit(false);
  }, [currentQuestion, handleSubmit, isSubmitting, isTranscribing, timeLeft, answerFeedback]);

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) return <p className="center muted">Starting interview session...</p>;
  if (error && !currentQuestion) return <p className="alert error">{error}</p>;

  return (
    <div className="min-h-screen bg-slate-950 font-sans p-4 lg:p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT — question + answer ───────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {error && <p className="alert error">{error}</p>}
          <TabSwitchAlert count={tabSwitchCount} />

          {/* Progress + timers + mute toggle */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-900/40 text-blue-400 w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm border border-blue-800/50">
                {questionNumber}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Question {questionNumber} of {maxQuestions}
                </p>
                <p className="text-slate-200 font-bold text-sm">
                  {answerFeedback ? "Review your answer" : "Live Interview"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                title={muted ? "Enable question voice" : "Mute question voice"}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-all",
                  muted
                    ? "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                    : "bg-blue-900/30 border-blue-700/50 text-blue-400 hover:bg-blue-900/50"
                )}
              >
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span className="hidden sm:inline">{muted ? "Voice Off" : "Voice On"}</span>
              </button>

              {!answerFeedback && (
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">This Q</p>
                  <p className={cn("text-xl font-black font-mono",
                    timeLeft < 20 ? "text-red-400 animate-pulse" : "text-slate-200")}>
                    {formatTime(timeLeft)}
                  </p>
                </div>
              )}
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</p>
                <p className="text-xl font-black font-mono text-slate-200">{formatTime(totalTimeLeft)}</p>
              </div>
            </div>
          </div>

          {/* Question card with replay button */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-600" />
            <div className="flex items-start gap-4 pl-4">
              <h2 className="text-2xl font-bold text-white leading-tight flex-1">
                {currentQuestion?.text}
              </h2>
              <button
                type="button"
                onClick={() => speaking ? stopSpeaking() : speak(currentQuestion?.text || "")}
                title={speaking ? "Stop" : "Read question aloud (Indian accent)"}
                className={cn(
                  "flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center border transition-all",
                  speaking
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-600"
                )}
              >
                {speaking ? (
                  <span className="flex gap-0.5">
                    {[...Array(3)].map((_, i) => (
                      <span key={i} className="w-0.5 bg-white rounded-full animate-bounce" style={{ height: "14px", animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                ) : (
                  <Volume2 size={18} />
                )}
              </button>
            </div>

            {speaking && (
              <div className="mt-3 ml-4 inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 border border-blue-500/30 rounded-full text-blue-400 text-[10px] font-black uppercase tracking-widest">
                <Volume2 size={10} className="animate-pulse" />
                Reading question in Indian English…
              </div>
            )}
          </div>

          {/* Answer / feedback */}
          {answerFeedback ? (
            <AnswerFeedback
              feedback={answerFeedback}
              isLastQuestion={questionNumber === maxQuestions}
              onContinue={() => _advanceAfterAnswer(answerFeedback._nextResponse)}
            />
          ) : (
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <MessageSquare size={16} className="text-blue-500" />
                  Your Response
                </h4>
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full",
                    isRecording    ? "bg-red-500 animate-pulse" :
                    isTranscribing ? "bg-amber-500 animate-pulse" : "bg-emerald-500")} />
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {isRecording ? "Listening…" : isTranscribing ? "Transcribing…" : "Ready"}
                  </span>
                </div>
              </div>

              {voiceMetrics && (
                <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-slate-700/50">
                  <VoiceConfidenceBar metrics={voiceMetrics} />
                  <div className="flex gap-4 mt-1 text-[10px] text-slate-500">
                    <span>{voiceMetrics.speaking_rate} wpm</span>
                    <span>Fillers: {voiceMetrics.filler_count}</span>
                  </div>
                </div>
              )}

              <textarea
                className="w-full h-44 bg-slate-800 border border-slate-700 rounded-xl p-4 text-base text-white outline-none focus:ring-2 focus:ring-blue-500/30 resize-none font-medium leading-relaxed"
                placeholder="Whisper transcript appears here. You can edit before submitting."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />

              {transcriptionWarning && (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
                  {transcriptionWarning}
                </p>
              )}

              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={handleRecordingToggle}
                  disabled={isSubmitting || isTranscribing}
                  className={cn(
                    "flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-50",
                    isRecording ? "bg-red-600 hover:bg-red-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"
                  )}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                  {isRecording ? "Stop & Transcribe" : isTranscribing ? "Transcribing…" : "Start Speaking"}
                </button>

                <div className="flex gap-3 flex-1 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setAnswer("")}
                    disabled={isSubmitting || isTranscribing}
                    className="flex-1 sm:flex-none px-5 py-3.5 rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 font-bold text-sm transition-all"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmit(false)}
                    disabled={isSubmitting || isTranscribing}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm transition-all disabled:opacity-50"
                  >
                    <span>{isSubmitting ? "Submitting…" : questionNumber === maxQuestions ? "Finish" : "Submit"}</span>
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT — proctoring panel ───────────────────────────────────── */}
        <div className="space-y-4">

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-4 space-y-3">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} className="text-emerald-400" />
              Proctoring Feed
            </h4>

            <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
              <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
              {!previewReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                  <Activity size={28} className="mb-2" />
                  <p className="text-xs font-bold uppercase tracking-widest">No Feed</p>
                </div>
              )}

              {emotionSignal && emotionEnabled && (
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/10 flex items-center gap-1.5">
                  <Brain size={11} className={EMOTION_COLOR[emotionSignal.emotion] || "text-slate-400"} />
                  <span className={cn("text-[10px] font-black capitalize", EMOTION_COLOR[emotionSignal.emotion] || "text-slate-400")}>
                    {emotionSignal.emotion}
                  </span>
                  <span className="text-[9px] text-slate-500">{Math.round(emotionSignal.confidence * 100)}%</span>
                </div>
              )}

              {speaking && (
                <div className="absolute bottom-10 left-2 flex items-center gap-1 bg-blue-600/80 px-2 py-1 rounded-full border border-blue-400/30">
                  <Volume2 size={10} className="text-white animate-pulse" />
                  <span className="text-[9px] font-black text-white">Reading…</span>
                </div>
              )}

              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-full border border-white/10">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[9px] font-black text-white uppercase tracking-widest">Live</span>
              </div>
            </div>

            {/* Status grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Video",   previewReady ? "Active"    : "Off",    previewReady],
                ["Session", sessionId    ? `#${sessionId}` : "—", !!sessionId],
                ["Emotion", emotionEnabled ? (emotionSignal?.emotion || "—") : "Disabled", emotionEnabled],
                ["Tabs",    tabSwitchCount > 0 ? `${tabSwitchCount} switch${tabSwitchCount > 1 ? "es" : ""}` : "Clean", tabSwitchCount === 0],
              ].map(([label, value, ok]) => (
                <div key={label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-2.5">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</p>
                  <p className={cn("text-xs font-black mt-0.5 truncate", ok ? "text-slate-200" : "text-amber-400")}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-2.5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Question Voice (en-IN)</p>
                <p className={cn("text-xs font-black mt-0.5",
                  speaking ? "text-blue-400" : muted ? "text-amber-400" : "text-emerald-400")}>
                  {speaking ? "Speaking question…" : muted ? "Muted" : "Auto-speak ON"}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleMute}
                className={cn(
                  "p-1.5 rounded-lg border transition-all",
                  muted
                    ? "bg-slate-700 border-slate-600 text-slate-400 hover:text-white"
                    : "bg-blue-900/30 border-blue-700/50 text-blue-400 hover:bg-blue-900/50"
                )}
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>

            {previewWarning && (
              <p className="text-[10px] text-amber-400 bg-amber-500/10 rounded-lg px-3 py-1.5 border border-amber-500/20">
                {previewWarning}
              </p>
            )}
          </div>

          {/* Event log */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 max-h-72 overflow-hidden flex flex-col">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
              <Eye size={14} className="text-blue-400" />
              Event Log
              {proctoringEvents.length > 0 && (
                <span className="ml-auto bg-slate-800 text-slate-400 text-[9px] font-black px-2 py-0.5 rounded-full border border-slate-700">
                  {proctoringEvents.length}
                </span>
              )}
            </h4>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {proctoringEvents.length === 0 && (
                <div className="text-center py-6 opacity-30">
                  <EyeOff size={28} className="mx-auto mb-2" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">No events</p>
                </div>
              )}
              {proctoringEvents.map((ev, i) => {
                const isAlert   = ev.type === "TAB_SWITCH";
                const isEmotion = ev.type === "EMOTION";
                const isVoice   = ev.type === "VOICE_CONFIDENCE";
                return (
                  <div key={i} className={cn(
                    "flex items-start gap-2 px-2.5 py-2 rounded-lg text-[10px] border",
                    isAlert   ? "bg-red-500/10 border-red-500/30 text-red-400"      :
                    isEmotion ? "bg-blue-500/10 border-blue-500/20 text-blue-400"   :
                    isVoice   ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                                "bg-slate-800/50 border-slate-700/50 text-slate-500"
                  )}>
                    <span className="font-black flex-shrink-0">
                      {isAlert ? "⚠" : isEmotion ? "😐" : isVoice ? "🎤" : "·"}
                    </span>
                    <span className="font-bold leading-tight">
                      {isAlert   && "Tab switch detected"}
                      {isEmotion && `Emotion: ${ev.emotion} (${Math.round(ev.confidence * 100)}%)`}
                      {isVoice   && `Voice: ${ev.confidence_score >= 0.7 ? "confident" : "hesitant"} · ${ev.speaking_rate}wpm`}
                      {!isAlert && !isEmotion && !isVoice && ev.type}
                    </span>
                    <span className="ml-auto flex-shrink-0 opacity-50">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Session log */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 flex-1 flex flex-col min-h-40">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 size={14} className="text-blue-400" />
              Session Log
            </h4>
            <div className="flex-1 overflow-y-auto space-y-3">
              {transcripts.length === 0 && (
                <div className="text-center py-4 opacity-30">
                  <MessageSquare size={24} className="mx-auto mb-2" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">No answers yet</p>
                </div>
              )}
              {transcripts.map((item, idx) => (
                <div key={idx} className="border-l-2 border-slate-700 pl-3 space-y-0.5">
                  <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Q{idx + 1}</p>
                  <p className="text-[10px] text-slate-300 font-bold line-clamp-2">{item.q}</p>
                  <p className="text-[10px] text-slate-500 italic line-clamp-2">"{item.a || "(skipped)"}"</p>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

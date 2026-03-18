import React, { useRef, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Camera, Mic, Wifi, CheckCircle2, AlertCircle, Play,
  ShieldCheck, Video, Settings, AlertTriangle, Lock, Mail, Volume2
} from "lucide-react";
import { interviewApi } from "../services/api";
import { useAuth } from "../context/useAuth";
import { cn } from "../utils/utils";

async function attachPreviewStream(videoElement, stream) {
  if (!videoElement) return;
  videoElement.srcObject = stream;
  videoElement.muted = true;
  videoElement.playsInline = true;
  try {
    await videoElement.play();
  } catch {
    await new Promise((resolve) => {
      const timeoutId = window.setTimeout(resolve, 500);
      videoElement.onloadedmetadata = () => { window.clearTimeout(timeoutId); resolve(); };
    });
    try { await videoElement.play(); } catch { /* keep srcObject */ }
  }
}

function checkMediaRecorderSupport() {
  if (typeof window === "undefined") return { supported: false, reason: "Non-browser environment." };
  if (typeof window.MediaRecorder === "undefined") {
    return { supported: false, reason: "MediaRecorder API is not supported in this browser." };
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  const supported = candidates.some((type) => {
    try { return window.MediaRecorder.isTypeSupported(type); } catch { return false; }
  });
  if (!supported) {
    return { supported: false, reason: "No supported audio recording format found in this browser." };
  }
  return { supported: true, reason: "" };
}

function interviewAccessErrorMessage(response) {
  const reason = String(response?.interview_locked_reason || "").trim().toLowerCase();
  if (reason === "schedule_required") return "Schedule your interview before starting.";
  if (reason === "shortlist_required") return "Only shortlisted candidates can start the interview.";
  if (reason === "already_completed") return "This interview has already been submitted.";
  return "Interview is not ready yet. Please try again from your dashboard.";
}

// ── Inline login form shown when candidate is not logged in ──────────────────
function InlineLogin({ onSuccess }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password, role: "candidate" });
      onSuccess();
    } catch (err) {
      setError(err?.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={28} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Sign in to continue</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
            Please sign in with your candidate account to access your interview.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm border border-red-100 dark:border-red-900/30">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In & Open Interview"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main PreCheck component ───────────────────────────────────────────────────
export default function PreCheck() {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [checks, setChecks] = useState({
    camera:        { status: "pending", label: "Camera access" },
    mic:           { status: "pending", label: "Microphone access" },
    internet:      { status: "granted", label: "Internet connection" },
    voiceRecorder: { status: "pending", label: "Voice recording support" },
  });
  const [isChecking, setIsChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Check MediaRecorder support on mount
  useEffect(() => {
    const { supported, reason } = checkMediaRecorderSupport();
    setChecks((prev) => ({
      ...prev,
      voiceRecorder: {
        status: supported ? "granted" : "denied",
        label: "Voice recording support",
        detail: reason,
      },
    }));
  }, []);

  // Cleanup camera stream on unmount
  React.useEffect(() => {
    const videoElement = videoRef.current;
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoElement) videoElement.srcObject = null;
    };
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <InlineLogin onSuccess={() => window.location.reload()} />;
  }

  const startCheck = async () => {
    setIsChecking(true);
    setError("");

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const recorderCheck = checkMediaRecorderSupport();

    try {
      let stream;
      let micGranted = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        micGranted = false;
      }
      streamRef.current = stream;
      await attachPreviewStream(videoRef.current, stream);
      setChecks({
        camera:        { status: "granted", label: "Camera access" },
        mic:           { status: micGranted ? "granted" : "denied", label: "Microphone access" },
        internet:      { status: "granted", label: "Internet connection" },
        voiceRecorder: {
          status: recorderCheck.supported ? "granted" : "denied",
          label: "Voice recording support",
          detail: recorderCheck.reason,
        },
      });
      if (!micGranted) {
        setError("Camera preview is active, but microphone permission is blocked. Allow mic access for voice answers.");
      }
    } catch {
      setChecks({
        camera:        { status: "denied", label: "Camera access" },
        mic:           { status: "denied", label: "Microphone access" },
        internet:      { status: "granted", label: "Internet connection" },
        voiceRecorder: {
          status: recorderCheck.supported ? "granted" : "denied",
          label: "Voice recording support",
          detail: recorderCheck.reason,
        },
      });
    } finally {
      setIsChecking(false);
    }
  };

  async function handleStartInterview() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      const response = await interviewApi.access(Number(resultId));
      if (!response?.interview_ready) {
        setError(interviewAccessErrorMessage(response));
        return;
      }
      const resolvedResultId = Number(response?.result_id || resultId);
      sessionStorage.setItem(`interview-consent:${resolvedResultId}`, "true");
      navigate(`/interview/${resolvedResultId}/live`);
    } catch (e) {
      setError(e?.message || "Interview questions are not ready yet. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  const cameraGranted = checks.camera.status === "granted";
  const voiceUnsupported = checks.voiceRecorder.status === "denied" && checks.voiceRecorder.detail;
  const allGranted = Object.values(checks).every((c) => c.status === "granted");

  return (
    <div className="min-h-[calc(100vh-160px)] flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12">

        {/* Left: checks */}
        <div className="space-y-8">
          <div>
            <div className="flex items-center space-x-2 text-blue-600 mb-4">
              <ShieldCheck size={24} />
              <span className="text-sm font-black uppercase tracking-widest">System Check</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white font-display leading-tight">
              Ready to start your interview?
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-4 text-lg">
              Before we begin, ensure your camera, microphone, and browser are ready.
            </p>
          </div>

          {error && <p className="alert error">{error}</p>}

          {voiceUnsupported && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Voice recording not supported</p>
                <p className="mt-0.5">{checks.voiceRecorder.detail} You can still type your answers. Use Chrome or Edge for full voice support.</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(checks).map(([key, check]) => (
              <div key={key} className={cn(
                "flex items-center justify-between p-5 rounded-2xl border transition-all",
                check.status === "granted"
                  ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400"
                  : check.status === "denied"
                  ? "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50 text-red-700 dark:text-red-400"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400"
              )}>
                <div className="flex items-center space-x-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center",
                    check.status === "granted" ? "bg-emerald-100 dark:bg-emerald-800" : "bg-slate-100 dark:bg-slate-800")}>
                    {key === "camera" && <Camera size={20} />}
                    {key === "mic" && <Mic size={20} />}
                    {key === "internet" && <Wifi size={20} />}
                    {key === "voiceRecorder" && <Mic size={20} />}
                  </div>
                  <span className="font-bold">{check.label}</span>
                </div>
                {check.status === "granted" && <CheckCircle2 size={24} />}
                {check.status === "denied" && <AlertCircle size={24} />}
              </div>
            ))}
          </div>

          <div className="pt-4 flex items-center gap-4">
            <button
              onClick={startCheck}
              disabled={isChecking}
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-black py-4 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center space-x-2 shadow-sm"
            >
              {isChecking ? "Checking..." : "Run System Check"}
            </button>

            <button
              disabled={!cameraGranted || starting}
              onClick={handleStartInterview}
              className={cn(
                "flex-[1.5] py-4 rounded-2xl font-black flex items-center justify-center space-x-2 transition-all shadow-xl",
                cameraGranted
                  ? "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 dark:shadow-none"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
              )}
            >
              <span>{starting ? "Starting..." : "Start Interview"}</span>
              <Play size={18} fill="currentColor" />
            </button>
          </div>

          {!allGranted && cameraGranted && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              Camera is ready. You can start — type answers if mic is unavailable.
            </p>
          )}
        </div>

        {/* Right: video preview */}
        <div className="space-y-6">
          <div className="relative aspect-video bg-slate-900 rounded-[32px] overflow-hidden shadow-2xl border-4 border-white dark:border-slate-800">
            <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
            {checks.camera.status !== "granted" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Video size={32} />
                </div>
                <p className="text-sm font-bold uppercase tracking-widest">No Video Feed</p>
              </div>
            )}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-2 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Live Preview</span>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-3xl border border-blue-100 dark:border-blue-800/50">
            <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300 flex items-center mb-3">
              <Settings className="mr-2" size={16} />Interview Requirements
            </h4>
            <ul className="space-y-2 text-xs text-blue-700 dark:text-blue-400 font-medium">
              <li className="flex items-center space-x-2">
                <div className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0" />
                <span>Sit in a well-lit and quiet room</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0" />
                <span>Ensure your face is clearly visible</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0" />
                <span>Use Chrome or Edge for best voice recording support</span>
              </li>
              {/* FIX I2: Inform candidates about TTS before the interview starts */}
              <li className="flex items-start space-x-2">
                <Volume2 size={12} className="flex-shrink-0 mt-0.5" />
                <span>Each question will be <strong>read aloud automatically</strong> — you can mute this at any time using the voice button during the interview</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

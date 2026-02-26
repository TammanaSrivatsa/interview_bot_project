import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { interviewApi } from "../services/api";

const BASELINE_SHOTS = 3;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fileFromBlob(blob, filename) {
  return new File([blob], filename, { type: "image/jpeg" });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not capture image from camera."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.8);
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

export default function PreCheck() {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const numericResultId = Number(resultId);
  const routeResultId = Number.isFinite(numericResultId) && numericResultId > 0 ? numericResultId : 0;

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const faceDetectorRef = useRef();

  const [cameraReady, setCameraReady] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [baselineUploaded, setBaselineUploaded] = useState(0);

  async function initializeCamera() {
    setError("");
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
      setCameraReady(true);
    } catch {
      setCameraReady(false);
      setError("Camera permission is required to continue.");
    }
  }

  function stopCamera() {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  async function uploadBaselineFrame(sessionId, index) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      throw new Error("Camera is not ready.");
    }

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to initialize frame capture.");
    }
    ctx.drawImage(video, 0, 0, width, height);

    const facesCount = await detectFaces(canvas, faceDetectorRef);
    const eventFlags = {
      no_face: facesCount === 0,
      multi_face: facesCount > 1,
    };

    const blob = await canvasToBlob(canvas);
    const formData = new FormData();
    formData.append("file", fileFromBlob(blob, `baseline_${index}.jpg`));
    formData.append("session_id", String(sessionId));
    formData.append("event_type", "baseline");
    formData.append("event_flags", JSON.stringify(eventFlags));
    formData.append("motion_score", "0");
    formData.append("faces_count", String(facesCount));

    await interviewApi.uploadProctorFrame(formData);
  }

  async function handleContinue() {
    if (!consentChecked) {
      setError("Please provide consent before continuing.");
      return;
    }
    if (!cameraReady) {
      setError("Enable camera first.");
      return;
    }

    setBusy(true);
    setError("");
    setInfo("Starting interview session...");
    setBaselineUploaded(0);
    try {
      const payload = {};
      if (routeResultId > 0) payload.result_id = routeResultId;
      const startResponse = await interviewApi.start(payload);
      const sessionId = startResponse?.session_id;
      if (!sessionId) {
        throw new Error("Could not start interview session.");
      }

      for (let i = 1; i <= BASELINE_SHOTS; i += 1) {
        setInfo(`Uploading baseline ${i}/${BASELINE_SHOTS}...`);
        await uploadBaselineFrame(sessionId, i);
        setBaselineUploaded(i);
        await wait(350);
      }

      navigate(`/interview/${routeResultId}/live`, {
        replace: true,
        state: {
          resultId: routeResultId,
          sessionData: startResponse,
        },
      });
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    initializeCamera();
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="stack">
      <header className="title-row">
        <h2>Interview Pre-Check</h2>
        <button onClick={() => navigate("/candidate")}>Back</button>
      </header>

      {error && <p className="alert error">{error}</p>}
      {info && <p className="alert success">{info}</p>}

      <section className="card stack-sm">
        <p className="muted">
          Camera access is required for proctoring snapshots during the interview.
        </p>
        <video ref={videoRef} className="interview-video" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden-canvas" />
        <label className="inline-row" htmlFor="consent-checkbox">
          <input
            id="consent-checkbox"
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
          />
          <span>I consent to webcam-based proctoring for this interview.</span>
        </label>
        <div className="inline-row">
          <button disabled={busy} onClick={initializeCamera}>
            {cameraReady ? "Camera Ready" : "Enable Camera"}
          </button>
          <button disabled={busy || !cameraReady || !consentChecked} onClick={handleContinue}>
            {busy ? "Preparing..." : "Continue to Interview"}
          </button>
        </div>
        <p className="muted">Baseline uploads: {baselineUploaded}/{BASELINE_SHOTS}</p>
      </section>
    </div>
  );
}

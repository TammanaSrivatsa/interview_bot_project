import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';

function InterviewSetup() {
  const navigate = useNavigate();
  const { resultId } = useParams();

  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [fullscreenGranted, setFullscreenGranted] = useState(!!document.fullscreenElement);
  const [internetStatus, setInternetStatus] = useState(navigator.onLine);
  const [browserSupported, setBrowserSupported] = useState(true);
  const [quietEnvironment, setQuietEnvironment] = useState(false);
  const [checking, setChecking] = useState(false);

  const previewRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!navigator.mediaDevices || !SpeechRecognition) {
      setBrowserSupported(false);
    }

    const updateOnlineStatus = () => setInternetStatus(navigator.onLine);
    const onFullscreenChange = () => setFullscreenGranted(!!document.fullscreenElement);

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const checkPermissions = async () => {
    setChecking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
      }
      setCameraGranted(true);
      setMicGranted(true);
    } catch (err) {
      alert('Camera and microphone permissions are required.');
    } finally {
      setChecking(false);
    }
  };

  const enableFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenGranted(true);
    } catch (err) {
      alert('Fullscreen is required before interview starts.');
    }
  };

  const allReady =
    cameraGranted &&
    micGranted &&
    fullscreenGranted &&
    internetStatus &&
    browserSupported &&
    quietEnvironment;

  return (
    <>
      <Navbar showLogout={false} />
      <div className="ib-shell">
        <div className="ib-container ib-grid ib-grid-2">
          <section className="ib-card ib-p-24">
            <div className="ib-kicker">Pre-Interview Check</div>
            <h3 className="mt-1">System readiness before live session</h3>
            <p className="text-muted">
              Complete all checks. The interview runs on camera, microphone, speech recognition,
              and fullscreen monitoring.
            </p>

            <div className="ib-status">Camera: {cameraGranted ? 'Ready' : 'Not Granted'}</div>
            <div className="ib-status">Microphone: {micGranted ? 'Ready' : 'Not Granted'}</div>
            <div className="ib-status">Fullscreen: {fullscreenGranted ? 'Enabled' : 'Not Enabled'}</div>
            <div className="ib-status">Internet: {internetStatus ? 'Online' : 'Offline'}</div>
            <div className="ib-status mb-3">
              Browser: {browserSupported ? 'Supported' : 'Unsupported (use Chrome)'}
            </div>

            <div className="form-check mb-3">
              <input
                id="quietMode"
                type="checkbox"
                className="form-check-input"
                checked={quietEnvironment}
                onChange={(e) => setQuietEnvironment(e.target.checked)}
              />
              <label htmlFor="quietMode" className="form-check-label">
                I confirm I am in a quiet environment and ready for a timed interview.
              </label>
            </div>

            <button
              onClick={checkPermissions}
              disabled={checking}
              className="btn ib-btn-brand btn-primary w-100 mb-2"
            >
              {checking ? 'Checking Devices...' : 'Allow Camera & Microphone'}
            </button>

            <button onClick={enableFullscreen} className="btn btn-dark w-100 mb-2">
              Enable Fullscreen
            </button>

            <button
              disabled={!allReady}
              onClick={() => navigate(`/interview-session/${resultId}${window.location.search}`)}
              className="btn btn-success w-100"
            >
              Start Interview Session
            </button>
          </section>

          <section className="ib-card ib-p-24 ib-card-soft">
            <h5 className="mb-3">Live Preview</h5>
            <video ref={previewRef} autoPlay muted playsInline className="ib-video-preview mb-3" />
            <div className="small text-muted">
              Keep your face in frame. Leaving fullscreen or disconnecting devices can impact
              interview completion status.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default InterviewSetup;

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getPreferredVoices,
  getStoredVoicePreference,
  persistVoicePreference
} from '../utils/voiceOptions';

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
  const [botVoice, setBotVoice] = useState(getStoredVoicePreference());
  const [voiceSupport, setVoiceSupport] = useState({ female: false, male: false });

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!navigator.mediaDevices || !SpeechRecognition) {
      setBrowserSupported(false);
    }

    const loadVoices = () => {
      const synth = window.speechSynthesis;
      if (!synth) {
        setVoiceSupport({ female: false, male: false });
        return;
      }

      const preferred = getPreferredVoices(synth.getVoices());
      setVoiceSupport({
        female: Boolean(preferred.female),
        male: Boolean(preferred.male)
      });
    };

    const updateOnlineStatus = () => setInternetStatus(navigator.onLine);
    const onFullscreenChange = () => setFullscreenGranted(!!document.fullscreenElement);

    loadVoices();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleVoiceChange = (voiceType: 'female' | 'male') => {
    setBotVoice(voiceType);
    persistVoicePreference(voiceType);
  };

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

  const hardwareCards = [
    {
      title: 'Camera',
      subtitle: cameraGranted ? 'Integrated Webcam ready' : 'Permission required',
      ready: cameraGranted
    },
    {
      title: 'Microphone',
      subtitle: micGranted ? 'Default input detected' : 'Permission required',
      ready: micGranted
    },
    {
      title: 'Internet',
      subtitle: internetStatus ? 'Online and stable' : 'Offline',
      ready: internetStatus
    },
    {
      title: 'Browser',
      subtitle: browserSupported ? 'Speech features supported' : 'Unsupported, use Chrome',
      ready: browserSupported
    }
  ];

  return (
    <div className="ib-shell ib-setup-shell">
      <div className="ib-setup-topbar">
        <div className="ib-setup-brand">
          <span className="ib-setup-brand-mark">I</span>
          <span>InterviewBot</span>
        </div>
        <div className="ib-setup-top-actions">
          <span className="ib-setup-top-icon">⚙</span>
          <span className="ib-setup-top-icon">?</span>
        </div>
      </div>

      <div className="ib-container ib-setup-layout">
        <section className="ib-setup-main">
          <div>
            <h1 className="ib-setup-title">Readiness Check</h1>
            <p className="ib-setup-copy">
              Let's make sure your hardware and environment are optimized for your live AI
              interview. This will only take a moment.
            </p>
          </div>

          <div className="ib-setup-preview-card">
            <video ref={previewRef} autoPlay muted playsInline className="ib-setup-preview-video" />
            {!cameraGranted && <div className="ib-setup-preview-placeholder" />}
            <div className="ib-setup-preview-badges">
              <span className="ib-setup-live-pill">LIVE HD</span>
              <div className="ib-setup-preview-icons">
                <span>🎥</span>
                <span>🎤</span>
              </div>
            </div>
          </div>

          <div className="ib-setup-environment-card">
            <div className="ib-setup-environment-title">Environment Check</div>
            <label className="ib-setup-quiet-row">
              <input
                type="checkbox"
                checked={quietEnvironment}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuietEnvironment(e.target.checked)}
              />
              <span>I am in a quiet, well-lit room and will not be interrupted.</span>
            </label>
          </div>
        </section>

        <aside className="ib-setup-side">
          <section className="ib-setup-side-card">
            <div className="ib-setup-side-title">Hardware & Connectivity</div>
            <div className="ib-setup-status-list">
              {hardwareCards.map((item) => (
                <div key={item.title} className="ib-setup-status-card">
                  <div className="ib-setup-status-icon">{item.title[0]}</div>
                  <div className="ib-setup-status-copy">
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                  <div className={`ib-setup-status-check ${item.ready ? 'ready' : 'pending'}`}>
                    {item.ready ? '✓' : '!'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="ib-setup-side-card">
            <div className="ib-setup-side-title">Interviewer Voice Profile</div>
            <div className="ib-voice-choice-grid">
              <label className={`ib-voice-option ${botVoice === 'female' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="botVoice"
                  value="female"
                  checked={botVoice === 'female'}
                  onChange={() => handleVoiceChange('female')}
                />
                <span>Female Voice</span>
              </label>
              <label className={`ib-voice-option ${botVoice === 'male' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="botVoice"
                  value="male"
                  checked={botVoice === 'male'}
                  onChange={() => handleVoiceChange('male')}
                />
                <span>Male Voice</span>
              </label>
            </div>
            <div className="ib-help">
              Browser voices detected: Female {voiceSupport.female ? 'available' : 'fallback only'} | Male {voiceSupport.male ? 'available' : 'fallback only'}
            </div>
          </section>

          <section className="ib-setup-side-card">
            <div className="ib-setup-action-stack">
              <button type="button" className="btn ib-candidate-secondary" onClick={checkPermissions} disabled={checking}>
                {checking ? 'Checking Devices...' : 'Allow Camera & Microphone'}
              </button>
              <button type="button" className="btn ib-candidate-secondary" onClick={enableFullscreen}>
                Enable Fullscreen
              </button>
              <button
                type="button"
                className="btn ib-setup-start-btn"
                disabled={!allReady}
                onClick={() => navigate(`/interview-session/${resultId || ''}${window.location.search}`)}
              >
                Start Interview
              </button>
            </div>
            <p className="ib-setup-terms">
              By clicking 'Start', you agree to our recording and data processing terms.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default InterviewSetup;

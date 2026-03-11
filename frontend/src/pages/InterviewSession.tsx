import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FaceDetection } from '@mediapipe/face_detection';
import { Camera } from '@mediapipe/camera_utils';
import api from '../lib/api';
import {
  getPreferredVoices,
  getStoredVoicePreference,
  persistVoicePreference
} from '../utils/voiceOptions';

const MEDIAPIPE_FACE_DETECTION_VERSION = '0.4.1646425229';

function InterviewSession() {
  const { resultId } = useParams();

  const [candidateName, setCandidateName] = useState('');
  const [interviewDuration, setInterviewDuration] = useState(0);
  const [question, setQuestion] = useState('Loading interview...');
  const [answer, setAnswer] = useState('');
  const [timeRemaining, setTimeRemaining] = useState('00:00');
  const [questionTimeLeft, setQuestionTimeLeft] = useState(0);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [interviewEnded, setInterviewEnded] = useState(false);
  const [statusText, setStatusText] = useState('Waiting to begin');
  const [warningMessage, setWarningMessage] = useState('');
  const [violationCount, setViolationCount] = useState(0);
  const [questionWindowSec, setQuestionWindowSec] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [botViseme, setBotViseme] = useState('rest');
  const [botVoice, setBotVoice] = useState(getStoredVoicePreference());
  const [voiceCatalog, setVoiceCatalog] = useState({ female: null, male: null });

  const MAX_WARNINGS_PER_TYPE = 5;

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const cameraAIRef = useRef(null);
  const faceDetectionRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const backendQueueRef = useRef([]);
  const backendPendingRef = useRef(0);
  const backendSegmentsRef = useRef({});
  const backendTranscriptRef = useRef('');
  const backendSeqRef = useRef(0);
  const interimTranscriptRef = useRef('');
  const answerRef = useRef('');
  const finalTranscriptRef = useRef('');
  const lastSpeechAtRef = useRef(0);
  const restartTimeoutRef = useRef(null);
  const recognitionWatchdogRef = useRef(null);
  const shouldRestartRef = useRef(false);
  const isRecognizingRef = useRef(false);
  const recorderStopPromiseRef = useRef(null);
  const countdownRef = useRef(null);
  const questionTimerRef = useRef(null);
  const totalSecondsRef = useRef(0);

  const faceMissingStartRef = useRef(null);
  const headTurnStartRef = useRef(null);
  const multiFaceStartRef = useRef(null);

  const warningCountRef = useRef({ tab: 0, face: 0, head: 0, multi: 0 });
  const timelineRef = useRef([]);
  const violationsRef = useRef([]);
  const startTimeRef = useRef(null);
  const endedRef = useRef(false);
  const lowConfidenceChunksRef = useRef(0);
  const currentQuestionRef = useRef('');
  const aiMonitorDisposedRef = useRef(false);
  const visemeIntervalRef = useRef(null);

  const normalizeTranscript = (text) =>
    (text || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();

  const appendWithOverlap = (base, addition) => {
    const b = normalizeTranscript(base);
    const a = normalizeTranscript(addition);
    if (!a) return b;
    if (!b) return a;
    if (b.toLowerCase().endsWith(a.toLowerCase())) return b;

    const max = Math.min(80, b.length, a.length);
    for (let i = max; i > 0; i -= 1) {
      if (b.slice(-i).toLowerCase() === a.slice(0, i).toLowerCase()) {
        return normalizeTranscript(`${b}${a.slice(i)}`);
      }
    }
    return normalizeTranscript(`${b} ${a}`);
  };

  const updateVisibleAnswer = () => {
    const backendText = normalizeTranscript(backendTranscriptRef.current || '');
    const localText = normalizeTranscript(
      `${finalTranscriptRef.current || ''} ${interimTranscriptRef.current || ''}`
    );

    let nextText = localText;
    if (backendText) {
      nextText = backendText;
      if (localText.length > backendText.length) {
        const previewExtension = localText.slice(backendText.length).trim();
        if (previewExtension) {
          nextText = appendWithOverlap(backendText, previewExtension);
        }
      }
    }

    answerRef.current = nextText;
    setAnswer(nextText);
  };

  const addTimeline = (event) => {
    timelineRef.current.push({ event, time: new Date().toISOString() });
    setTimelineEvents([...timelineRef.current.slice(-8)]);
  };

  const stopAIMonitoring = () => {
    if (aiMonitorDisposedRef.current) return;
    aiMonitorDisposedRef.current = true;

    if (cameraAIRef.current) {
      try {
        cameraAIRef.current.stop();
      } catch (error) {
        // no-op
      }
      cameraAIRef.current = null;
    }

    if (faceDetectionRef.current && typeof faceDetectionRef.current.close === 'function') {
      try {
        faceDetectionRef.current.close();
      } catch (error) {
        // no-op (already disposed)
      }
      faceDetectionRef.current = null;
    }
  };

  const getAdaptiveQuestionTime = (questionText) => {
    const words = (questionText || '').trim().split(/\s+/).filter(Boolean).length;
    const adaptive = Math.round(45 + words * 1.2);
    return Math.max(45, Math.min(120, adaptive));
  };

  const logViolation = async (type, reason) => {
    if (endedRef.current) return;

    if ((warningCountRef.current[type] || 0) >= MAX_WARNINGS_PER_TYPE) {
      return;
    }

    warningCountRef.current[type] = (warningCountRef.current[type] || 0) + 1;
    const count = warningCountRef.current[type];

    const event = { type, reason, count, time: new Date().toISOString() };
    violationsRef.current.push(event);
    setViolationCount(violationsRef.current.length);
    addTimeline(`Violation (${type}): ${reason}`);

    setWarningMessage(`Warning: ${reason} (${count}/${MAX_WARNINGS_PER_TYPE})`);
    setTimeout(() => setWarningMessage(''), 3000);

    try {
      await api.post('/log-violation', { reason });
    } catch (error) {
      // no-op
    }

    if (count >= MAX_WARNINGS_PER_TYPE) {
      await endInterview('abandoned');
    }
  };

  useEffect(() => {
    const loadVoices = () => {
      const synth = window.speechSynthesis;
      if (!synth) {
        setVoiceCatalog({ female: null, male: null });
        return;
      }

      setVoiceCatalog(getPreferredVoices(synth.getVoices()));
    };

    const loadInterview = async () => {
      try {
        const token = new URLSearchParams(window.location.search).get('token');
        const res = await api.get(`/interview/${resultId}?token=${token}`);
        setCandidateName(res.data.candidate_name || '');
        setInterviewDuration(res.data.interview_duration || 0);
        setTimeRemaining(`${String(res.data.interview_duration || 0).padStart(2, '0')}:00`);
      } catch (error) {
        setQuestion('Unauthorized interview link or session expired.');
        setStatusText('Unable to load interview');
      }
    };

    loadVoices();
    loadInterview();
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    return () => {
      clearInterval(countdownRef.current);
      clearInterval(questionTimerRef.current);
      stopLiveSpeechRecognition();
      window.speechSynthesis.cancel();
      setIsBotSpeaking(false);
      setBotViseme('rest');

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      stopAIMonitoring();
      if (window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      }
    };
  }, [resultId]);

  useEffect(() => {
    const onVisibility = () => {
      if (interviewStarted && !interviewEnded && document.hidden) {
        logViolation('tab', 'Tab switch detected');
      }
    };

    const onBlur = () => {
      if (interviewStarted && !interviewEnded) {
        logViolation('tab', 'Window lost focus');
      }
    };

    const onFullscreen = () => {
      if (interviewStarted && !interviewEnded && !document.fullscreenElement) {
        logViolation('tab', 'Exited fullscreen');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [interviewStarted, interviewEnded]);

  useEffect(() => {
    if (visemeIntervalRef.current) {
      clearInterval(visemeIntervalRef.current);
      visemeIntervalRef.current = null;
    }

    if (!isBotSpeaking) {
      setBotViseme('rest');
      return undefined;
    }

    const frames = ['aa', 'ee', 'oh', 'fv', 'rest', 'oh', 'aa'];
    let idx = 0;
    visemeIntervalRef.current = setInterval(() => {
      setBotViseme(frames[idx % frames.length]);
      idx += 1;
    }, 110);

    return () => {
      if (visemeIntervalRef.current) {
        clearInterval(visemeIntervalRef.current);
        visemeIntervalRef.current = null;
      }
      setBotViseme('rest');
    };
  }, [isBotSpeaking]);

  const speak = (text, callback = null) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const selectedVoice = botVoice === 'male' ? voiceCatalog.male : voiceCatalog.female;
    if (selectedVoice) {
      utter.voice = selectedVoice;
      utter.lang = selectedVoice.lang || 'en-US';
    }
    utter.onstart = () => setIsBotSpeaking(true);
    utter.onend = () => {
      setIsBotSpeaking(false);
      callback && callback();
    };
    utter.onerror = () => {
      setIsBotSpeaking(false);
      callback && callback();
    };
    window.speechSynthesis.speak(utter);
  };

  const handleVoiceChange = (voiceType) => {
    const nextVoice = voiceType === 'male' ? 'male' : 'female';
    setBotVoice(nextVoice);
    persistVoicePreference(nextVoice);
  };

  const startTimer = () => {
    totalSecondsRef.current = interviewDuration * 60;

    countdownRef.current = setInterval(() => {
      const min = Math.floor(totalSecondsRef.current / 60);
      const sec = totalSecondsRef.current % 60;
      setTimeRemaining(`${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);

      if (totalSecondsRef.current <= 0) {
        clearInterval(countdownRef.current);
        endInterview('completed');
      }

      totalSecondsRef.current -= 1;
    }, 1000);
  };

  const startQuestionTimer = (stream) => {
    clearInterval(questionTimerRef.current);
    questionTimerRef.current = setInterval(() => {
      setQuestionTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(questionTimerRef.current);
          nextQuestion(stream);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      streamRef.current = stream;
      audioStreamRef.current = new MediaStream(stream.getAudioTracks());
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return stream;
    } catch (error) {
      alert('Camera and microphone permission required.');
      return null;
    }
  };

  const startAIMonitoring = () => {
    if (!videoRef.current) return;
    aiMonitorDisposedRef.current = false;

    try {
      const faceDetection = new FaceDetection({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@${MEDIAPIPE_FACE_DETECTION_VERSION}/${file}`
      });

      faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.6 });

      faceDetection.onResults(async (results) => {
        const now = Date.now();

        if (!results.detections || results.detections.length === 0) {
          if (!faceMissingStartRef.current) faceMissingStartRef.current = now;
          if (now - faceMissingStartRef.current > 3000) {
            faceMissingStartRef.current = null;
            await logViolation('face', 'Face not detected');
          }
          return;
        }
        faceMissingStartRef.current = null;

        if (results.detections.length > 1) {
          if (!multiFaceStartRef.current) multiFaceStartRef.current = now;
          if (now - multiFaceStartRef.current > 3000) {
            multiFaceStartRef.current = null;
            await logViolation('multi', 'Multiple people detected');
          }
          return;
        }
        multiFaceStartRef.current = null;

        const box = results.detections[0].boundingBox;
        if (box.xCenter < 0.2 || box.xCenter > 0.8) {
          if (!headTurnStartRef.current) headTurnStartRef.current = now;
          if (now - headTurnStartRef.current > 3000) {
            headTurnStartRef.current = null;
            await logViolation('head', 'Candidate looking away repeatedly');
          }
        } else {
          headTurnStartRef.current = null;
        }
      });

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            await faceDetection.send({ image: videoRef.current });
          } catch (error) {
            setStatusText('Interview in progress (AI monitor unavailable)');
            stopAIMonitoring();
          }
        },
        width: 640,
        height: 480
      });

      camera.start();
      faceDetectionRef.current = faceDetection;
      cameraAIRef.current = camera;
    } catch (error) {
      setStatusText('Interview in progress (AI monitor unavailable)');
    }
  };

  const processBackendQueue = async () => {
    if (endedRef.current) return;
    while (backendPendingRef.current < 3 && backendQueueRef.current.length > 0) {
      const chunk = backendQueueRef.current.shift();
      if (!chunk || !chunk.blob || chunk.blob.size === 0) continue;

      backendPendingRef.current += 1;

      const formData = new FormData();
      formData.append('audio', chunk.blob, `chunk_${chunk.sequence_id}.webm`);
      formData.append('sequence_id', String(chunk.sequence_id));
      formData.append('context_hint', currentQuestionRef.current || '');

      api
        .post('/transcribe-audio', formData)
        .then((res) => {
          if (!res?.data?.success) return;
          const seq = Number(res.data.sequence_id);
          const text = normalizeTranscript(res.data.transcription || '');
          if (!Number.isFinite(seq) || !text) return;
          if (res.data.low_confidence) {
            lowConfidenceChunksRef.current += 1;
          }

          backendSegmentsRef.current[seq] = text;
          const orderedSeq = Object.keys(backendSegmentsRef.current)
            .map((k) => Number(k))
            .filter((v) => Number.isFinite(v))
            .sort((a, b) => a - b);

          let mergedBackend = '';
          for (const s of orderedSeq) {
            mergedBackend = appendWithOverlap(mergedBackend, backendSegmentsRef.current[s]);
          }
          backendTranscriptRef.current = mergedBackend;
          updateVisibleAnswer();
        })
        .catch(() => {
          // no-op
        })
        .finally(() => {
          backendPendingRef.current = Math.max(0, backendPendingRef.current - 1);
          processBackendQueue();
        });
    }
  };

  const waitForBackendQueueFlush = async (timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (backendQueueRef.current.length === 0 && backendPendingRef.current === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const startParallelAudioTranscription = (stream) => {
    const source = audioStreamRef.current || (stream ? new MediaStream(stream.getAudioTracks()) : null);
    if (!source) return;
    if (typeof MediaRecorder === 'undefined') return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') return;

    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(source, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0 || endedRef.current) return;
        const sequence_id = backendSeqRef.current;
        backendSeqRef.current += 1;
        backendQueueRef.current.push({ sequence_id, blob: event.data });
        processBackendQueue();
      };

      recorder.onstop = () => {
        if (recorderStopPromiseRef.current) {
          recorderStopPromiseRef.current();
          recorderStopPromiseRef.current = null;
        }
      };

      recorder.start(3000);
    } catch (error) {
      // no-op
    }
  };

  const stopParallelAudioTranscription = async ({ flush = false } = {}) => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (flush) {
          await new Promise<void>((resolve) => {
            let done = false;
            const settle = () => {
              if (done) return;
              done = true;
              resolve();
            };
            recorderStopPromiseRef.current = settle;
            mediaRecorderRef.current.stop();
            setTimeout(settle, 1200);
          });
        } else {
          mediaRecorderRef.current.stop();
        }
      } catch (error) {
        // no-op
      }
    }

    if (flush) {
      await waitForBackendQueueFlush(5000);
      updateVisibleAnswer();
    } else {
      backendQueueRef.current = [];
      backendPendingRef.current = 0;
    }

    mediaRecorderRef.current = null;
  };

  const startLiveSpeechRecognition = (stream) => {
    if (isRecognizingRef.current) return;
    startParallelAudioTranscription(stream);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Use Google Chrome for speech recognition.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = 'en-US';

    shouldRestartRef.current = true;
    lastSpeechAtRef.current = Date.now();

    const scheduleRestart = (delayMs = 350) => {
      if (!shouldRestartRef.current || endedRef.current) return;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = setTimeout(() => {
        if (!shouldRestartRef.current || endedRef.current || isRecognizingRef.current) return;
        try {
          recognition.start();
        } catch (error) {
          // no-op
        }
      }, delayMs);
    };

    recognition.onstart = () => {
      isRecognizingRef.current = true;
      lastSpeechAtRef.current = Date.now();
    };

    recognition.onresult = (event) => {
      let fullFinal = '';
      let interimTranscript = '';

      // Parse the full result window every callback so older words are retained.
      for (let i = 0; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript || '';
        if (!chunk) continue;
        if (event.results[i].isFinal) {
          fullFinal = appendWithOverlap(fullFinal, chunk);
        } else {
          interimTranscript = appendWithOverlap(interimTranscript, chunk);
        }
      }

      const currentFinal = normalizeTranscript(fullFinal);
      if (currentFinal) {
        if (
          !finalTranscriptRef.current ||
          currentFinal.toLowerCase().startsWith(finalTranscriptRef.current.toLowerCase())
        ) {
          finalTranscriptRef.current = currentFinal;
        } else {
          finalTranscriptRef.current = appendWithOverlap(finalTranscriptRef.current, currentFinal);
        }
      }
      interimTranscriptRef.current = normalizeTranscript(interimTranscript);
      updateVisibleAnswer();
      lastSpeechAtRef.current = Date.now();
    };

    recognition.onerror = (event) => {
      if (!endedRef.current && shouldRestartRef.current) {
        if (event.error !== 'aborted') scheduleRestart(500);
      }
    };

    recognition.onend = () => {
      isRecognizingRef.current = false;
      if (shouldRestartRef.current && !endedRef.current) {
        scheduleRestart(250);
      }
    };

    try {
      recognition.start();
    } catch (error) {
      // no-op
    }

    if (recognitionWatchdogRef.current) clearInterval(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = setInterval(() => {
      if (!shouldRestartRef.current || endedRef.current) return;
      const silentForMs = Date.now() - lastSpeechAtRef.current;
      if (!isRecognizingRef.current || silentForMs > 12000) {
        scheduleRestart(200);
      }
    }, 2000);
  };

  const stopLiveSpeechRecognition = async ({ flushAudio = false } = {}) => {
    shouldRestartRef.current = false;
    isRecognizingRef.current = false;
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionWatchdogRef.current) {
      clearInterval(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // no-op
      }
    }
    await stopParallelAudioTranscription({ flush: flushAudio });
  };

  const waitForSpeechFinalize = () =>
    new Promise((resolve) => {
      // Give recognition a moment to flush final words.
      setTimeout(resolve, 700);
    });

  const generateFirstQuestion = async (stream) => {
    try {
      const formData = new FormData();
      formData.append('result_id', resultId);
      formData.append('last_answer', '');

      const res = await api.post('/generate-next-question', formData);
      if (!res.data.question || res.data.question === 'INTERVIEW_COMPLETE') {
        await endInterview('completed');
        return;
      }

      setQuestion(res.data.question);
      currentQuestionRef.current = res.data.question || '';
      finalTranscriptRef.current = '';
      interimTranscriptRef.current = '';
      backendSegmentsRef.current = {};
      backendTranscriptRef.current = '';
      backendSeqRef.current = 0;
      backendQueueRef.current = [];
      backendPendingRef.current = 0;
      lowConfidenceChunksRef.current = 0;
      answerRef.current = '';
      setAnswer('');
      const qWindow = getAdaptiveQuestionTime(res.data.question || '');
      setQuestionWindowSec(qWindow);
      setQuestionTimeLeft(qWindow);
      setQuestionIndex(1);
      addTimeline('Question asked');

      speak(res.data.question, () => {
        startQuestionTimer(stream);
        setTimeout(() => startLiveSpeechRecognition(stream), 900);
      });
    } catch (error) {
      await endInterview('abandoned');
    }
  };

  const nextQuestion = async (stream) => {
    try {
      await stopLiveSpeechRecognition({ flushAudio: true });
      await waitForSpeechFinalize();

      const formData = new FormData();
      formData.append('result_id', resultId);
      formData.append(
        'last_answer',
        normalizeTranscript(backendTranscriptRef.current || answerRef.current || answer || '')
      );

      addTimeline('Answer submitted');

      const res = await api.post('/generate-next-question', formData);
      if (!res.data.question || res.data.question === 'INTERVIEW_COMPLETE') {
        await endInterview('completed');
        return;
      }

      setQuestion(res.data.question);
      currentQuestionRef.current = res.data.question || '';
      finalTranscriptRef.current = '';
      interimTranscriptRef.current = '';
      backendSegmentsRef.current = {};
      backendTranscriptRef.current = '';
      backendSeqRef.current = 0;
      backendQueueRef.current = [];
      backendPendingRef.current = 0;
      lowConfidenceChunksRef.current = 0;
      answerRef.current = '';
      setAnswer('');
      const qWindow = getAdaptiveQuestionTime(res.data.question || '');
      setQuestionWindowSec(qWindow);
      setQuestionTimeLeft(qWindow);
      setQuestionIndex((prev) => prev + 1);
      addTimeline('Question asked');

      speak(res.data.question, () => {
        startQuestionTimer(stream);
        setTimeout(() => startLiveSpeechRecognition(stream), 900);
      });
    } catch (error) {
      await endInterview('abandoned');
    }
  };

  const startInterview = async () => {
    if (interviewStarted || interviewEnded || !interviewDuration) return;

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      // ignore
    }

    const stream = await startCamera();
    if (!stream) return;

    startTimeRef.current = new Date().toISOString();
    addTimeline('Interview started');
    startAIMonitoring();
    setInterviewStarted(true);
    setStatusText('Interview in progress');
    startTimer();

    speak(`Hello ${candidateName}. Welcome to your AI interview. Let's begin.`, () => {
      generateFirstQuestion(stream);
    });
  };

  const endInterview = async (status = 'completed') => {
    if (endedRef.current) return;
    endedRef.current = true;

    await stopLiveSpeechRecognition({ flushAudio: true });
    clearInterval(countdownRef.current);
    clearInterval(questionTimerRef.current);
    window.speechSynthesis.cancel();
    setIsBotSpeaking(false);
    setBotViseme('rest');

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    stopAIMonitoring();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setInterviewEnded(true);
    setStatusText('Interview ended');
    setQuestion('Interview completed. Thank you.');
    addTimeline('Interview ended');

    try {
      await api.post('/complete-interview', {
        result_id: Number(resultId),
        status,
        last_answer: normalizeTranscript(
          backendTranscriptRef.current || answerRef.current || answer || ''
        ),
        start_time: startTimeRef.current,
        end_time: new Date().toISOString(),
        timeline: timelineRef.current,
        violations: violationsRef.current,
        transcription_quality: {
          low_confidence_chunks: lowConfidenceChunksRef.current
        }
      });
    } catch (error) {
      console.error('Failed to submit interview report', error);
    }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const liveAnalysis = useMemo(() => {
    const transcript = normalizeTranscript(answer || '');
    const words = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
    const elapsedQuestionSeconds = Math.max(1, questionWindowSec - questionTimeLeft);
    const wpm = Math.round((words / elapsedQuestionSeconds) * 60);

    const fillerMatches = transcript.match(/\b(um|uh|like|you know|basically|actually|sort of|kind of)\b/gi) || [];
    const sentenceCount = (transcript.match(/[.!?]/g) || []).length || (words > 0 ? 1 : 0);

    const paceScore = clamp(100 - Math.abs(130 - wpm), 20, 98);
    const clarityScore = clamp(92 - fillerMatches.length * 7 + sentenceCount * 2, 18, 98);
    const confidenceScore = clamp(
      90 - violationCount * 5 - lowConfidenceChunksRef.current * 3 - fillerMatches.length * 2,
      12,
      98
    );
    const completenessScore = clamp((words / 110) * 100, 8, 98);
    const riskLevel = clamp(violationCount * 18 + lowConfidenceChunksRef.current * 11, 0, 100);

    const mode = interviewEnded
      ? 'Session closed'
      : interviewStarted
        ? questionTimeLeft <= 12
          ? 'Final probing'
          : 'Live adaptive questioning'
        : 'Awaiting start';

    return {
      words,
      wpm,
      fillerCount: fillerMatches.length,
      sentenceCount,
      paceScore,
      clarityScore,
      confidenceScore,
      completenessScore,
      riskLevel,
      mode
    };
  }, [answer, interviewEnded, interviewStarted, questionTimeLeft, questionWindowSec, violationCount]);

  const sessionIdLabel = resultId ? `#${String(resultId).padStart(3, '0')}-941` : '#882-941';
  const progressPercent = clamp((Math.max(questionIndex, interviewStarted ? 1 : 0) / 20) * 100, 4, 100);
  const questionLabel = questionIndex > 0 ? `Step ${questionIndex} of 20` : 'Step 0 of 20';
  const keywords = Array.from<string>(
    new Set(
      normalizeTranscript(answer || '')
        .split(/\s+/)
        .map((word) => word.replace(/[^a-zA-Z0-9#+.-]/g, '').trim())
        .filter((word) => word.length > 4)
    )
  ).slice(0, 4);
  const aiSuggestion = interviewStarted
    ? liveAnalysis.completenessScore < 45
      ? 'Prompt the candidate to ground the answer in one production example.'
      : liveAnalysis.clarityScore < 55
        ? 'Follow up on structure and trade-offs before moving to the next topic.'
        : 'Candidate is progressing well. Next prompt can probe implementation depth.'
    : 'Interview has not started yet. Start the session to activate live guidance.';

  return (
    <div className="ib-shell ib-session-shell ib-session-shell-v2">
      <div className="ib-session-bg orb-one" />
      <div className="ib-session-bg orb-two" />

      <div className="ib-container ib-session-layout ib-session-layout-v2">
        <section className="ib-session-topbar">
          <div className="ib-session-brand">
            <div className="ib-logo-mark">I</div>
            <div>
              <div className="ib-session-brand-title">InterviewBot Live</div>
              <div className="ib-session-brand-meta">Session ID: {sessionIdLabel}</div>
            </div>
          </div>
          <div className="ib-session-top-actions">
            <span className="ib-session-recording">
              <span className="ib-session-recording-dot" />
              {interviewEnded ? 'SESSION CLOSED' : 'LIVE RECORDING'}
            </span>
            <button
              onClick={() => endInterview('abandoned')}
              disabled={interviewEnded}
              className="ib-session-end-btn"
            >
              End Session
            </button>
          </div>
        </section>

        <section className="ib-session-metrics-row">
          <article className="ib-session-metric-card">
            <div className="ib-kicker">Total Duration</div>
            <div className="ib-session-metric-value ib-session-metric-mono">{timeRemaining}</div>
          </article>
          <article className="ib-session-metric-card">
            <div className="ib-kicker">Question Timer</div>
            <div className="ib-session-metric-split">
              <div className="ib-session-metric-value ib-session-metric-mono">
                {String(Math.max(questionTimeLeft, 0)).padStart(2, '0')}s
              </div>
              <span>Limit: {String(questionWindowSec || 0).padStart(2, '0')}s</span>
            </div>
          </article>
          <article className="ib-session-metric-card ib-session-progress-card">
            <div className="ib-session-progress-head">
              <div className="ib-kicker">Interview Progress</div>
              <strong>{questionLabel}</strong>
            </div>
            <div className="ib-session-progress-track">
              <div className="ib-session-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="ib-session-progress-note">{liveAnalysis.mode}</div>
          </article>
        </section>

        <div className="ib-session-grid-v2">
          <section className="ib-card ib-session-stage-card">
            {warningMessage && <div className="alert alert-warning">{warningMessage}</div>}

            <div className="ib-session-stage-head">
              <div className="ib-session-stage-title">
                <span className="ib-session-stage-icon">🤖</span>
                <span>AI Interviewer: Astra</span>
              </div>
              <div className="ib-session-audio-state">
                <span className="ib-session-audio-dot" />
                Audio Processing Active
              </div>
            </div>

            <div className="ib-session-avatar-stage">
              <div className={`ib-bot-avatar ${isBotSpeaking ? 'is-speaking' : ''}`} aria-label="Interviewer avatar">
                <svg className="ib-bot-svg" viewBox="0 0 140 170" role="img" aria-label="AI interviewer face">
                  <defs>
                    <linearGradient id="ibSkin" x1="0.15" y1="0.05" x2="0.88" y2="0.95">
                      <stop offset="0%" stopColor="#f7d6bf" />
                      <stop offset="55%" stopColor="#e8b997" />
                      <stop offset="100%" stopColor="#d59f7a" />
                    </linearGradient>
                    <linearGradient id="ibHair" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#1e293b" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <linearGradient id="ibSuit" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#334155" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <radialGradient id="ibCheek" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#efb19d" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="#efb19d" stopOpacity="0" />
                    </radialGradient>
                  </defs>

                  <path d="M18 150 Q40 118 70 116 Q100 118 122 150 Z" fill="url(#ibSuit)" />
                  <path d="M56 120 L70 138 L84 120 Z" fill="#f8fafc" />
                  <rect x="62" y="103" width="16" height="16" rx="6" fill="#d6a786" />

                  <ellipse cx="70" cy="56" rx="40" ry="42" fill="url(#ibSkin)" />
                  <ellipse cx="37" cy="59" rx="6" ry="9" fill="#dbab8c" />
                  <ellipse cx="103" cy="59" rx="6" ry="9" fill="#dbab8c" />
                  <ellipse cx="53" cy="66" rx="11" ry="8" fill="url(#ibCheek)" />
                  <ellipse cx="87" cy="66" rx="11" ry="8" fill="url(#ibCheek)" />

                  <path d="M30 49 Q28 16 69 13 Q112 16 110 50 Q103 28 84 22 Q70 19 56 22 Q37 28 30 49 Z" fill="url(#ibHair)" />
                  <path d="M40 37 Q47 27 58 25" fill="none" stroke="#475569" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M81 25 Q94 27 100 38" fill="none" stroke="#475569" strokeWidth="2.2" strokeLinecap="round" />

                  <ellipse cx="54" cy="55" rx="9.5" ry="6.8" fill="#ffffff" />
                  <ellipse cx="86" cy="55" rx="9.5" ry="6.8" fill="#ffffff" />
                  <circle cx="54" cy="55" r="4.2" fill="#2b3a4f" className={`ib-bot-eye-svg ${isBotSpeaking ? 'is-speaking' : ''}`} />
                  <circle cx="86" cy="55" r="4.2" fill="#2b3a4f" className={`ib-bot-eye-svg ${isBotSpeaking ? 'is-speaking' : ''}`} />
                  <circle cx="55.2" cy="53.8" r="1.3" fill="#f8fafc" />
                  <circle cx="87.2" cy="53.8" r="1.3" fill="#f8fafc" />
                  <path d="M44 45 Q54 40 64 45" fill="none" stroke="#263448" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M76 45 Q86 40 96 45" fill="none" stroke="#263448" strokeWidth="2.2" strokeLinecap="round" />

                  <path d="M70 59 Q66 69 68 75 Q70 77 72 75 Q74 69 70 59 Z" fill="#d49a77" />
                  <ellipse cx="66.5" cy="72.5" rx="1.1" ry="0.8" fill="#b88262" />
                  <ellipse cx="73.5" cy="72.5" rx="1.1" ry="0.8" fill="#b88262" />

                  <g className={`ib-viseme ib-viseme-${botViseme}`}>
                    <ellipse className="mouth-rest" cx="70" cy="74" rx="10" ry="3.5" />
                    <ellipse className="mouth-aa" cx="70" cy="75" rx="8" ry="10" />
                    <ellipse className="mouth-ee" cx="70" cy="74" rx="13" ry="4.2" />
                    <ellipse className="mouth-oh" cx="70" cy="75" rx="6" ry="8.5" />
                    <path className="mouth-fv" d="M58 75 Q70 68 82 75 Q70 83 58 75 Z" />
                  </g>
                </svg>
              </div>
            </div>

            <div className="ib-session-question-card">
              <div className="ib-question-head">
                <span>Current Question</span>
                <span className={`ib-speaking-badge ${isBotSpeaking ? 'on' : ''}`}>
                  {isBotSpeaking ? 'Speaking...' : 'Waiting'}
                </span>
              </div>
              <div className="ib-session-question-text">{question}</div>
            </div>

            <section className="ib-session-transcript-panel">
              <div className="ib-session-panel-label">Live Transcript</div>
              <div className="ib-session-transcript-content">
                <p><strong>Astra:</strong> {question}</p>
                <p><strong>Candidate:</strong> {answer || 'Transcript will appear here once the candidate starts answering.'}</p>
              </div>
            </section>

            <div className="ib-voice-panel ib-session-voice-panel">
              <div className="ib-kicker">Interviewer Voice Profile</div>
              <div className="ib-voice-choice-grid">
                <label className={`ib-voice-option ${botVoice === 'female' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="sessionBotVoice"
                    value="female"
                    checked={botVoice === 'female'}
                    onChange={() => handleVoiceChange('female')}
                  />
                  <span>Female Voice</span>
                </label>
                <label className={`ib-voice-option ${botVoice === 'male' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="sessionBotVoice"
                    value="male"
                    checked={botVoice === 'male'}
                    onChange={() => handleVoiceChange('male')}
                  />
                  <span>Male Voice</span>
                </label>
              </div>
              <div className="ib-help">
                Active voice: {(botVoice === 'male' ? voiceCatalog.male?.name : voiceCatalog.female?.name) || 'Browser default'}
              </div>
            </div>

            <div className="ib-session-control-row">
              <button
                onClick={startInterview}
                disabled={interviewStarted || interviewEnded}
                className="ib-btn-session-primary"
              >
                Start Interview
              </button>
              <button
                onClick={() => nextQuestion(streamRef.current)}
                disabled={!interviewStarted || interviewEnded}
                className="ib-session-secondary-btn"
              >
                Submit & Next
              </button>
              <div className="ib-session-status-copy">{statusText}</div>
            </div>
          </section>

          <aside className="ib-session-side-v2">
            <section className="ib-card ib-session-camera-card">
              <div className="ib-session-camera-frame">
                <span className="ib-session-camera-chip">Camera On</span>
                <video ref={videoRef} autoPlay muted playsInline className="ib-video-preview ib-session-video-preview" />
                <div className="ib-session-face-guide" />
              </div>

              <div className="ib-session-violation-grid">
                <div className="ib-session-violation-box danger">
                  <span>Gaze Deviations</span>
                  <strong>{violationCount}</strong>
                </div>
                <div className="ib-session-violation-box">
                  <span>Tab Switches</span>
                  <strong>{timelineEvents.filter((entry) => entry.event.toLowerCase().includes('tab')).length}</strong>
                </div>
                <div className="ib-session-violation-box">
                  <span>Audio Events</span>
                  <strong>{lowConfidenceChunksRef.current}</strong>
                </div>
                <div className="ib-session-violation-box">
                  <span>Multi-face</span>
                  <strong>{violationsRef.current.filter((entry) => entry.type === 'multi').length}</strong>
                </div>
              </div>
            </section>

            <section className="ib-card ib-session-insight-card">
              <div className="ib-kicker">Candidate Insights (Live)</div>
              <div className="ib-score-row">
                <div className="ib-score-row-head">
                  <span>Confidence Score</span>
                  <strong>{liveAnalysis.confidenceScore}%</strong>
                </div>
                <div className="ib-score-track">
                  <div className="ib-score-fill ib-score-brand" style={{ width: `${liveAnalysis.confidenceScore}%` }} />
                </div>
              </div>

              <div className="ib-session-live-note">
                <div className="ib-session-live-note-head">
                  <span>Clarity & Pace</span>
                  <strong>{liveAnalysis.paceScore >= 70 ? 'Optimal' : 'Watch'}</strong>
                </div>
                <p>
                  Speaker is maintaining roughly {liveAnalysis.wpm || 0} words per minute with clarity at {liveAnalysis.clarityScore}%.
                </p>
              </div>

              <div className="ib-session-live-note">
                <div className="ib-session-live-note-head">
                  <span>Keywords Detected</span>
                </div>
                <div className="ib-session-keywords">
                  {(keywords.length > 0 ? keywords : ['response', 'analysis', 'system', 'design']).map((keyword) => (
                    <span key={keyword} className="ib-session-keyword-chip">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>

              <div className="ib-session-live-note">
                <div className="ib-session-live-note-head">
                  <span>AI Suggestion</span>
                </div>
                <p>{aiSuggestion}</p>
              </div>
            </section>

            <section className="ib-card ib-session-analysis-card-v2">
              <div className="ib-kicker">Candidate Analysis</div>
              <div className="ib-analysis-grid">
                <div className="ib-stat">
                  <div className="ib-stat-label">Words spoken</div>
                  <div className="ib-stat-value">{liveAnalysis.words}</div>
                </div>
                <div className="ib-stat">
                  <div className="ib-stat-label">Speaking pace</div>
                  <div className="ib-stat-value">{liveAnalysis.wpm} WPM</div>
                </div>
                <div className="ib-stat">
                  <div className="ib-stat-label">Filler count</div>
                  <div className="ib-stat-value">{liveAnalysis.fillerCount}</div>
                </div>
                <div className="ib-stat">
                  <div className="ib-stat-label">Sentences</div>
                  <div className="ib-stat-value">{liveAnalysis.sentenceCount}</div>
                </div>
              </div>
            </section>

            <section className="ib-card ib-session-trail-card-v2">
              <div className="ib-kicker">Session Trail</div>
              <ul className="ib-session-trail">
                {timelineEvents.length === 0 && <li>Awaiting interview events...</li>}
                {timelineEvents.map((entry, idx) => (
                  <li key={`${entry.time}-${idx}`}>
                    <span>{entry.event}</span>
                    <small>{new Date(entry.time).toLocaleTimeString()}</small>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default InterviewSession;

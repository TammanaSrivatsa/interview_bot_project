import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { FaceDetection } from '@mediapipe/face_detection';
import { Camera } from '@mediapipe/camera_utils';
import Navbar from '../components/Navbar';

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
      await axios.post('/log-violation', { reason });
    } catch (error) {
      // no-op
    }

    if (count >= MAX_WARNINGS_PER_TYPE) {
      await endInterview('abandoned');
    }
  };

  useEffect(() => {
    const loadInterview = async () => {
      try {
        const token = new URLSearchParams(window.location.search).get('token');
        const res = await axios.get(`/interview/${resultId}?token=${token}`);
        setCandidateName(res.data.candidate_name || '');
        setInterviewDuration(res.data.interview_duration || 0);
        setTimeRemaining(`${String(res.data.interview_duration || 0).padStart(2, '0')}:00`);
      } catch (error) {
        setQuestion('Unauthorized interview link or session expired.');
        setStatusText('Unable to load interview');
      }
    };

    loadInterview();

    return () => {
      clearInterval(countdownRef.current);
      clearInterval(questionTimerRef.current);
      stopLiveSpeechRecognition();
      window.speechSynthesis.cancel();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (cameraAIRef.current) {
        cameraAIRef.current.stop();
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

  const speak = (text, callback = null) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => callback && callback();
    window.speechSynthesis.speak(utter);
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
          stopLiveSpeechRecognition();
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

    const faceDetection = new FaceDetection({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
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
        if (videoRef.current) {
          await faceDetection.send({ image: videoRef.current });
        }
      },
      width: 640,
      height: 480
    });

    camera.start();
    faceDetectionRef.current = faceDetection;
    cameraAIRef.current = camera;
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

      axios
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

      recorder.start(3000);
    } catch (error) {
      // no-op
    }
  };

  const stopParallelAudioTranscription = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        // no-op
      }
    }
    mediaRecorderRef.current = null;
    backendQueueRef.current = [];
    backendPendingRef.current = 0;
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

      finalTranscriptRef.current = normalizeTranscript(fullFinal);
      interimTranscriptRef.current = interimTranscript;
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

  const stopLiveSpeechRecognition = () => {
    shouldRestartRef.current = false;
    isRecognizingRef.current = false;
    stopParallelAudioTranscription();
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

      const res = await axios.post('/generate-next-question', formData);
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
      setQuestionTimeLeft(getAdaptiveQuestionTime(res.data.question || ''));
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
      stopLiveSpeechRecognition();
      await waitForSpeechFinalize();

      const formData = new FormData();
      formData.append('result_id', resultId);
      formData.append(
        'last_answer',
        normalizeTranscript(backendTranscriptRef.current || answerRef.current || answer || '')
      );

      addTimeline('Answer submitted');

      const res = await axios.post('/generate-next-question', formData);
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
      setQuestionTimeLeft(getAdaptiveQuestionTime(res.data.question || ''));
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

    stopLiveSpeechRecognition();
    clearInterval(countdownRef.current);
    clearInterval(questionTimerRef.current);
    window.speechSynthesis.cancel();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (cameraAIRef.current) {
      cameraAIRef.current.stop();
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setInterviewEnded(true);
    setStatusText('Interview ended');
    setQuestion('Interview completed. Thank you.');
    addTimeline('Interview ended');

    try {
      await axios.post('/complete-interview', {
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

  return (
    <>
      <Navbar showLogout />
      <div className="ib-shell">
        <div className="ib-container ib-grid ib-grid-2 ib-interview-layout">
          <section className="ib-card ib-p-24">
            {warningMessage && <div className="alert alert-warning">{warningMessage}</div>}

            <h3 className="mb-1">Candidate: {candidateName || 'Loading...'}</h3>
            <div className="small text-muted mb-3">{statusText}</div>

            <div className="ib-timer">Time Remaining: {timeRemaining}</div>
            <div className="mt-2 mb-3">
              <strong>Question Timer:</strong> {questionTimeLeft}s
            </div>

            <div className="ib-question mb-3">{question}</div>

            <textarea value={answer} readOnly className="form-control" style={{ minHeight: '160px' }} />

            <div className="d-flex gap-2 mt-3 flex-wrap">
              <button
                onClick={startInterview}
                disabled={interviewStarted || interviewEnded}
                className="btn btn-primary"
              >
                Start Interview
              </button>

              <button
                onClick={() => nextQuestion(streamRef.current)}
                disabled={!interviewStarted || interviewEnded}
                className="btn btn-outline-dark"
              >
                Submit & Next
              </button>

              <button onClick={() => endInterview('abandoned')} disabled={interviewEnded} className="btn btn-outline-danger">
                End Session
              </button>
            </div>
          </section>

          <aside className="ib-card ib-p-24">
            <h5>Monitoring Preview</h5>
            <video ref={videoRef} autoPlay muted playsInline className="ib-video-preview" />
            <div className="small text-muted mt-3 ib-status mb-2">
              Violations logged: <strong>{violationCount}</strong>
            </div>
            <div className="small text-muted ib-status mb-0">
              Question time left: <strong>{questionTimeLeft}s</strong>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

export default InterviewSession;

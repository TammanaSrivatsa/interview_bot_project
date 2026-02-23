import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import "./App.css";

// ------------------------------
// Route Parsing Helpers
// ------------------------------
function parseInterviewRoute() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#/interview/")) return null;
  const raw = hash.slice(1);
  const [path, query] = raw.split("?");
  const parts = path.split("/");
  const resultId = Number(parts[2]);
  const token = new URLSearchParams(query || "").get("token") || "";
  if (!Number.isFinite(resultId) || resultId <= 0 || !token) return null;
  return { resultId, token };
}

// ------------------------------
// Public Auth Screens
// ------------------------------
function LoginForm({ onLogin, loading }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onLogin({ email, password });
      }}
    >
      <h2>Login</h2>
      <label>Email</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label>Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button disabled={loading} type="submit">
        {loading ? "Please wait..." : "Login"}
      </button>
    </form>
  );
}

function SignupForm({ onSignup, loading }) {
  const [role, setRole] = useState("candidate");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState("");

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSignup({
          role,
          name,
          email,
          password,
          gender: role === "candidate" ? gender || null : null,
        });
      }}
    >
      <h2>Signup</h2>
      <label>Role</label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="candidate">Candidate</option>
        <option value="hr">HR</option>
      </select>
      <label>{role === "hr" ? "Company Name" : "Name"}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} required />
      <label>Email</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label>Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {role === "candidate" && (
        <>
          <label>Gender (optional)</label>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </>
      )}
      <button disabled={loading} type="submit">
        {loading ? "Please wait..." : "Create Account"}
      </button>
    </form>
  );
}

// ------------------------------
// Candidate Experience
// ------------------------------
function CandidateDashboard({
  data,
  onRefresh,
  onUploadResume,
  onScheduleInterview,
  onSelectJob,
  uploading,
}) {
  const result = data?.result;
  const selectedJobId = data?.selected_job_id || "";
  const availableJobs = data?.available_jobs || [];
  const selectedJob = availableJobs.find((j) => j.id === selectedJobId);
  const [file, setFile] = useState(null);
  const [interviewDate, setInterviewDate] = useState("");

  return (
    <div className="stack">
      <div className="card">
        <div className="title-row">
          <h2>Candidate Dashboard</h2>
          <button onClick={onRefresh}>Refresh</button>
        </div>
        <p><strong>Name:</strong> {data?.candidate?.name}</p>
        <p><strong>Email:</strong> {data?.candidate?.email}</p>
        <p><strong>Resume:</strong> {data?.candidate?.resume_path || "Not uploaded"}</p>
      </div>

      <div className="card">
        <h3>Select Company / JD</h3>
        {!availableJobs.length && <p>No jobs are available yet.</p>}
        {!!availableJobs.length && (
          <div className="stack-sm">
            <select
              value={selectedJobId}
              onChange={(e) => onSelectJob(Number(e.target.value))}
            >
              {availableJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company_name} | {job.jd_name}
                </option>
              ))}
            </select>
            {selectedJob && (
              <p className="muted">
                Education: {selectedJob.education_requirement || "None"} | Experience:{" "}
                {selectedJob.experience_requirement || 0} yrs | Gender:{" "}
                {selectedJob.gender_requirement || "None"}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Upload Resume for Selected JD</h3>
        <div className="inline-row">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            accept=".pdf,.docx,.txt"
          />
          <button
            disabled={uploading || !file || !selectedJobId}
            onClick={() => {
              if (file && selectedJobId) onUploadResume(file, selectedJobId);
            }}
          >
            {uploading ? "Uploading..." : "Upload Resume"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>AI Result (Selected JD)</h3>
        {!result && <p>No result yet for this job.</p>}
        {result && (
          <div className="stack-sm">
            <p><strong>Score:</strong> {result.score}%</p>
            <p><strong>Status:</strong> {result.shortlisted ? "Shortlisted" : "Rejected"}</p>
            {result.shortlisted && !result.interview_date && (
              <div className="inline-row">
                <input
                  type="datetime-local"
                  value={interviewDate}
                  onChange={(e) => setInterviewDate(e.target.value)}
                />
                <button
                  disabled={!interviewDate}
                  onClick={() =>
                    onScheduleInterview({
                      result_id: result.id,
                      interview_date: interviewDate,
                    })
                  }
                >
                  Confirm Interview
                </button>
              </div>
            )}
            {result.interview_date && (
              <>
                <p><strong>Interview Date:</strong> {result.interview_date}</p>
                <p>
                  <strong>Interview Link:</strong>{" "}
                  <a href={result.interview_link} target="_blank" rel="noreferrer">
                    Open Interview
                  </a>
                </p>
              </>
            )}
            {!!result.explanation && (
              <div>
                <h4>Detailed Analysis</h4>
                <p><strong>Semantic Match:</strong> {result.explanation.semantic_score}%</p>
                <p><strong>Skill Match:</strong> {result.explanation.skill_score}%</p>
                <p><strong>Matched Skills:</strong> {(result.explanation.matched_skills || []).join(", ")}</p>
                <p><strong>Education Check:</strong> {result.explanation.education_reason}</p>
                <p><strong>Experience Check:</strong> {result.explanation.experience_reason}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------
// HR Experience
// ------------------------------
function HRDashboard({
  data,
  selectedJobId,
  onSelectJob,
  onRefresh,
  onUploadJd,
  onConfirmJd,
  onUpdateSkillWeights,
  submitting,
}) {
  const jobs = data?.jobs || [];
  const [jdFile, setJdFile] = useState(null);
  const [jdTitle, setJdTitle] = useState("");
  const [genderRequirement, setGenderRequirement] = useState("");
  const [educationRequirement, setEducationRequirement] = useState("");
  const [experienceRequirement, setExperienceRequirement] = useState("");
  const [extractedSkills, setExtractedSkills] = useState(null);
  const [latestSkillDraft, setLatestSkillDraft] = useState({});

  useEffect(() => {
    setLatestSkillDraft(data?.latest_jd?.skill_scores || {});
  }, [data?.latest_jd?.id]);

  return (
    <div className="stack">
      <div className="card">
        <div className="title-row">
          <h2>HR Dashboard</h2>
          <button onClick={onRefresh}>Refresh</button>
        </div>

        {!!jobs.length && (
          <div className="stack-sm">
            <label>View Existing JD</label>
            <select
              value={selectedJobId || ""}
              onChange={(e) => onSelectJob(Number(e.target.value))}
            >
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jd_title || job.jd_name}
                </option>
              ))}
            </select>
          </div>
        )}

        <h3>Upload Job Description</h3>
        <div className="stack-sm">
          <input
            type="text"
            placeholder="JD title (e.g., Data Analyst - Feb Intake)"
            value={jdTitle}
            onChange={(e) => setJdTitle(e.target.value)}
          />
          <input type="file" onChange={(e) => setJdFile(e.target.files?.[0] || null)} />
          <select value={educationRequirement} onChange={(e) => setEducationRequirement(e.target.value)}>
            <option value="">Education: None</option>
            <option value="bachelor">Bachelor's</option>
            <option value="master">Master's</option>
            <option value="phd">PhD</option>
          </select>
          <input
            type="number"
            placeholder="Experience years"
            value={experienceRequirement}
            onChange={(e) => setExperienceRequirement(e.target.value)}
          />
          <select value={genderRequirement} onChange={(e) => setGenderRequirement(e.target.value)}>
            <option value="">Gender: None</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
          <button
            disabled={submitting || !jdFile}
            onClick={async () => {
              const response = await onUploadJd({
                file: jdFile,
                jdTitle,
                educationRequirement,
                experienceRequirement,
                genderRequirement,
              });
              setExtractedSkills(response?.ai_skills || {});
            }}
          >
            {submitting ? "Uploading..." : "Upload JD & Extract Skills"}
          </button>
        </div>

        {!!extractedSkills && (
          <div className="stack-sm top-gap">
            <h4>AI Extracted Skills (Editable)</h4>
            {Object.entries(extractedSkills).map(([skill, score]) => (
              <div className="inline-row" key={skill}>
                <input value={skill} readOnly />
                <input
                  type="number"
                  value={score}
                  onChange={(e) =>
                    setExtractedSkills((prev) => ({
                      ...prev,
                      [skill]: Number(e.target.value || 0),
                    }))
                  }
                />
              </div>
            ))}
            <button
              disabled={submitting}
              onClick={() => onConfirmJd(extractedSkills).then(() => setExtractedSkills(null))}
            >
              Confirm JD & Run Matching
            </button>
          </div>
        )}
      </div>

      {!!data?.latest_jd && (
        <div className="card">
          <h3>{data.latest_jd.jd_title || "Selected JD"} Skill Weights</h3>
          {Object.entries(latestSkillDraft).map(([skill, score]) => (
            <div className="inline-row" key={skill}>
              <input value={skill} readOnly />
              <input
                type="number"
                value={score}
                onChange={(e) =>
                  setLatestSkillDraft((prev) => ({
                    ...prev,
                    [skill]: Number(e.target.value || 0),
                  }))
                }
              />
            </div>
          ))}
          <button
            disabled={submitting || !data?.latest_jd?.id}
            onClick={() => onUpdateSkillWeights(latestSkillDraft, data.latest_jd.id)}
          >
            Update Skill Weights
          </button>
        </div>
      )}

      <div className="card">
        <h3>Shortlisted Candidates</h3>
        {!data?.shortlisted_candidates?.length && <p>No shortlisted candidates yet.</p>}
        {!!data?.shortlisted_candidates?.length && (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Score</th>
                <th>Interview Date</th>
                <th>Resume</th>
              </tr>
            </thead>
            <tbody>
              {data.shortlisted_candidates.map((item) => (
                <tr key={item.result.id}>
                  <td>{item.candidate.name}</td>
                  <td>{item.candidate.email}</td>
                  <td>{item.result.score}%</td>
                  <td>{item.result.interview_date || "Not scheduled"}</td>
                  <td>
                    {item.candidate.resume_path ? (
                      <a href={`http://localhost:8000/${item.candidate.resume_path}`} target="_blank" rel="noreferrer">
                        View Resume
                      </a>
                    ) : (
                      "N/A"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------
// Interview Experience
// ------------------------------
function InterviewPage({ resultId, token }) {
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
  const mediaStreamRef = useRef(null);
  const recognitionRef = useRef(null);
  const keepListeningRef = useRef(false);

  // Camera/mic permission gate used by both interview and voice input flows.
  async function requestMediaAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setMediaReady(true);
      return true;
    } catch {
      setError("Camera and microphone permission is required for interview.");
      return false;
    }
  }

  // Starts browser speech-to-text and keeps listening until explicitly stopped.
  async function startVoiceInput() {
    setError("");
    setVoiceStatus("");
    if (listening) return;

    const granted = mediaReady || (await requestMediaAccess());
    if (!granted) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Use Chrome or Edge.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stale recognition stop errors
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
      setListening(false);
      const code = event?.error || "unknown";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone permission denied. Allow mic access in browser site settings.");
      } else if (code === "network") {
        setError("Voice input network error. Check connection and try again.");
      } else {
        setError(`Voice input error: ${code}`);
      }
      setVoiceStatus("Voice input stopped.");
      keepListeningRef.current = false;
    };
    recognition.onend = () => {
      if (keepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          // fall through to stopped state
        }
      }
      setListening(false);
      setVoiceStatus("Voice input stopped.");
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    try {
      recognition.start();
      setListening(true);
      setVoiceStatus("Listening...");
    } catch (e) {
      keepListeningRef.current = false;
      setListening(false);
      setError(e?.message || "Could not start voice input.");
    }
  }

  // Stops speech-to-text without clearing the typed/transcribed answer.
  function stopVoiceInput() {
    keepListeningRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setListening(false);
    setVoiceStatus("Voice input stopped.");
  }

  // Initializes interview session state and asks first question.
  async function startInterview() {
    setSubmitting(true);
    setError("");
    try {
      const granted = mediaReady || (await requestMediaAccess());
      if (!granted) return;
      // Re-init interview context before first question to avoid stale session issues.
      await api.interviewInfo(resultId, token);
      const next = await api.interviewNextQuestion({ result_id: resultId, token, last_answer: "" });
      setQuestion(next.question || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Sends current answer to backend and fetches next question.
  async function submitAnswer() {
    setSubmitting(true);
    setError("");
    try {
      const next = await api.interviewNextQuestion({
        result_id: resultId,
        token,
        last_answer: answer,
      });
      if (next.question === "INTERVIEW_COMPLETE") {
        setQuestion("Interview completed. Thank you.");
      } else {
        setQuestion(next.question || "Interview session error.");
      }
      setAnswer("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true);
      setError("");
      try {
        const data = await api.interviewInfo(resultId, token);
        if (!active) return;
        setCandidateName(data.candidate_name);
      } catch (e) {
        if (!active) return;
        setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
      if (recognitionRef.current) recognitionRef.current.stop();
      keepListeningRef.current = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [resultId, token]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>AI Interview Session</h1>
        <button onClick={() => (window.location.hash = "")}>Back</button>
      </header>
      {loading && <p>Loading interview...</p>}
      {!loading && error && <p className="alert error">{error}</p>}
      {!loading && !error && (
        <div className="card stack-sm">
          <p><strong>Candidate:</strong> {candidateName}</p>
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
            <button disabled={listening} onClick={startVoiceInput}>Start Voice Input</button>
            <button disabled={!listening} onClick={stopVoiceInput}>Stop Voice Input</button>
            <button disabled={submitting || !question} onClick={submitAnswer}>
              {submitting ? "Submitting..." : "Next Question"}
            </button>
          </div>
          {voiceStatus && <p className="muted">{voiceStatus}</p>}
        </div>
      )}
      {!loading && error && (
        <div className="card stack-sm">
          <p>Could not initialize interview session.</p>
          <button
            onClick={() => {
              setError("");
              setLoading(true);
              api
                .interviewInfo(resultId, token)
                .then((data) => {
                  setCandidateName(data.candidate_name);
                })
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      )}
    </main>
  );
}

// ------------------------------
// Root App State + Orchestration
// ------------------------------
function App() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [screen, setScreen] = useState("login");
  const [session, setSession] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [selectedCandidateJob, setSelectedCandidateJob] = useState(null);
  const [selectedHrJob, setSelectedHrJob] = useState(null);
  const [interviewRoute, setInterviewRoute] = useState(parseInterviewRoute());

  useEffect(() => {
    const handler = () => setInterviewRoute(parseInterviewRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const isInterviewPage = useMemo(() => !!interviewRoute, [interviewRoute]);

  // Single loader for role/session + dashboard data.
  async function loadSessionAndDashboard(jobId = selectedCandidateJob) {
    setLoading(true);
    try {
      const me = await api.me();
      setSession({ userId: me.user_id, role: me.role });
      if (me.role === "candidate") {
        const candidateData = await api.candidateDashboard(jobId);
        setDashboard(candidateData);
        setSelectedCandidateJob(candidateData.selected_job_id || null);
      } else {
        const hrData = await api.hrDashboard(selectedHrJob);
        setDashboard(hrData);
        setSelectedHrJob(hrData.selected_job_id || null);
      }
    } catch {
      setSession(null);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isInterviewPage) {
      loadSessionAndDashboard();
    }
  }, [isInterviewPage]);

  // Auth handlers
  async function handleLogin(payload) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await api.login(payload);
      await loadSessionAndDashboard();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignup(payload) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await api.signup(payload);
      setNotice("Account created. Please login.");
      setScreen("login");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await api.logout();
    setSession(null);
    setDashboard(null);
    setSelectedCandidateJob(null);
    setSelectedHrJob(null);
    setScreen("login");
  }

  // Shared refresh route used by both candidate and HR pages.
  async function handleRefresh() {
    if (!session) return;
    if (session.role === "candidate") {
      const candidateData = await api.candidateDashboard(selectedCandidateJob);
      setDashboard(candidateData);
      setSelectedCandidateJob(candidateData.selected_job_id || null);
    } else {
      const hrData = await api.hrDashboard(selectedHrJob);
      setDashboard(hrData);
      setSelectedHrJob(hrData.selected_job_id || null);
    }
  }

  // Candidate actions
  async function handleSelectCandidateJob(jobId) {
    setSubmitting(true);
    setError("");
    try {
      const candidateData = await api.candidateDashboard(jobId);
      setDashboard(candidateData);
      setSelectedCandidateJob(candidateData.selected_job_id || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadResume(file, jobId) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const data = await api.uploadResume(file, jobId);
      setDashboard(data);
      setSelectedCandidateJob(data.selected_job_id || jobId || null);
      setNotice(data.message || "Resume uploaded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleScheduleInterview(payload) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await api.scheduleInterview(payload);
      setNotice(response.message);
      await handleRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // HR actions
  async function handleUploadJd(payload) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const data = await api.uploadJd(payload);
      setNotice("JD uploaded. Review extracted skills, then confirm.");
      await handleRefresh();
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmJd(skillScores) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const data = await api.confirmJd(skillScores);
      setNotice(data.message || "JD confirmed.");
      await handleRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateSkillWeights(skillScores, jobId) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const data = await api.updateSkillWeights(skillScores, jobId);
      setNotice(data.message || "Updated successfully.");
      await handleRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectHrJob(jobId) {
    setSubmitting(true);
    setError("");
    try {
      const hrData = await api.hrDashboard(jobId);
      setDashboard(hrData);
      setSelectedHrJob(hrData.selected_job_id || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (isInterviewPage) {
    return <InterviewPage resultId={interviewRoute.resultId} token={interviewRoute.token} />;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Interview Bot</h1>
        {session && (
          <div className="header-actions">
            <span className="chip">{session.role.toUpperCase()}</span>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>

      {loading && <p className="center">Loading...</p>}
      {!loading && error && <p className="alert error">{error}</p>}
      {!loading && notice && <p className="alert success">{notice}</p>}

      {!loading && !session && (
        <section>
          <div className="toggle-row">
            <button className={screen === "login" ? "active" : ""} onClick={() => setScreen("login")}>
              Login
            </button>
            <button className={screen === "signup" ? "active" : ""} onClick={() => setScreen("signup")}>
              Signup
            </button>
          </div>
          {screen === "login" ? (
            <LoginForm onLogin={handleLogin} loading={submitting} />
          ) : (
            <SignupForm onSignup={handleSignup} loading={submitting} />
          )}
        </section>
      )}

      {!loading && session?.role === "candidate" && (
        <CandidateDashboard
          data={dashboard}
          onRefresh={handleRefresh}
          onUploadResume={handleUploadResume}
          onScheduleInterview={handleScheduleInterview}
          onSelectJob={handleSelectCandidateJob}
          uploading={submitting}
        />
      )}

      {!loading && session?.role === "hr" && (
        <HRDashboard
          data={dashboard}
          selectedJobId={selectedHrJob}
          onSelectJob={handleSelectHrJob}
          onRefresh={handleRefresh}
          onUploadJd={handleUploadJd}
          onConfirmJd={handleConfirmJd}
          onUpdateSkillWeights={handleUpdateSkillWeights}
          submitting={submitting}
        />
      )}
    </main>
  );
}

export default App;

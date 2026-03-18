import axios from "axios";

const apiClient = axios.create({
  // NOTE: Keep frontend API calls relative so Vite dev proxy forwards /api to the backend.
  baseURL: "/api",
  withCredentials: true,
});

function buildAvatar(name) {
  const seed = String(name || "user").trim() || "user";
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

function extractErrorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((i) => (typeof i === "string" ? i : i?.msg || JSON.stringify(i))).join(", ");
  }
  return error?.message || "Request failed";
}

async function request(config) {
  try {
    const response = await apiClient(config);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

function toStatusObject(status) {
  if (status && typeof status === "object" && status.label) return status;
  const raw = String(status || "").trim().toLowerCase();
  const map = {
    analyzed: { key: "analyzed", label: "Analyzed", tone: "success" },
    pending: { key: "pending", label: "Pending", tone: "secondary" },
    scheduled: { key: "scheduled", label: "Scheduled", tone: "primary" },
    completed: { key: "completed", label: "Completed", tone: "dark" },
    shortlisted: { key: "shortlisted", label: "Shortlisted", tone: "success" },
    rejected: { key: "rejected", label: "Rejected", tone: "danger" },
    interview_scheduled: { key: "interview_scheduled", label: "Interview Scheduled", tone: "primary" },
    applied: { key: "applied", label: "Applied", tone: "secondary" },
    selected: { key: "selected", label: "Selected", tone: "success" },
    not_started: { key: "not_started", label: "Not Started", tone: "secondary" },
    in_progress: { key: "in_progress", label: "In Progress", tone: "primary" },
  };
  return map[raw] || {
    key: raw || "unknown",
    label: raw ? raw.split(/[_\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Unknown",
    tone: "secondary",
  };
}

function deriveDecision({ status, shortlisted, sessionStatus, finalScore }) {
  const normalizedStatus = toStatusObject(status);
  const sessionKey = String(sessionStatus || "").trim().toLowerCase();
  if (sessionKey === "selected") return { key: "selected", label: "Selected", tone: "success" };
  if (sessionKey === "rejected") return { key: "rejected", label: "Rejected", tone: "danger" };
  if (normalizedStatus.key === "rejected") return { key: "rejected", label: "Rejected", tone: "danger" };
  if (shortlisted || normalizedStatus.key === "shortlisted" || normalizedStatus.key === "interview_scheduled")
    return { key: "shortlisted", label: "Shortlisted", tone: "success" };
  if (normalizedStatus.key === "completed" && typeof finalScore === "number" && finalScore >= 75)
    return { key: "selected", label: "Selected", tone: "success" };
  return { key: "pending", label: "Pending", tone: "secondary" };
}

function normalizeCandidateSummary(item) {
  const status = toStatusObject(item?.status);
  const decision = deriveDecision({ status, shortlisted: false, sessionStatus: status.key, finalScore: item?.score });
  return {
    ...item,
    uid: item?.candidate_uid,
    candidate_uid: item?.candidate_uid,
    avatar: buildAvatar(item?.name),
    role: item?.job?.title || "Candidate",
    resumeScore: Number(item?.score || 0),
    score: Number(item?.score || 0),
    interviewStatus: status,
    status,
    finalDecision: decision,
  };
}

function normalizeApplication(application) {
  const explanation = application?.explanation || {};
  const interviewScoring = explanation?.interview_scoring || {};
  const status = toStatusObject(application?.status);
  const decision = deriveDecision({ status, shortlisted: application?.shortlisted, sessionStatus: application?.latest_session?.status, finalScore: interviewScoring?.final_score });
  return {
    ...application,
    explanation,
    status,
    finalDecision: decision,
    resumeScore: typeof explanation?.final_resume_score === "number" ? explanation.final_resume_score : typeof application?.score === "number" ? application.score : 0,
    semanticScore: typeof explanation?.semantic_score === "number" ? explanation.semantic_score : 0,
    skillMatchScore: typeof explanation?.matched_percentage === "number" ? explanation.matched_percentage : typeof explanation?.weighted_skill_score === "number" ? explanation.weighted_skill_score : 0,
    interviewScore: typeof interviewScoring?.technical_score === "number" ? interviewScoring.technical_score : null,
    finalAIScore: typeof interviewScoring?.final_score === "number" ? interviewScoring.final_score : typeof application?.score === "number" ? application.score : 0,
  };
}

function normalizeCandidateDetail(data) {
  const applications = (data?.applications || []).map(normalizeApplication);
  const latestApplication = applications[0] || null;
  const candidate = data?.candidate || {};
  const skillGap = data?.skill_gap || null;
  const resumeAdvice = data?.resume_advice || null;
  return {
    ...data,
    candidate: {
      ...candidate,
      uid: candidate?.candidate_uid,
      avatar: buildAvatar(candidate?.name),
      role: latestApplication?.job?.title || "Candidate",
      finalDecision: latestApplication?.finalDecision || deriveDecision({ status: candidate?.current_status }),
      resumeScore: latestApplication?.resumeScore ?? 0,
      semanticScore: latestApplication?.semanticScore ?? 0,
      skillMatchScore: latestApplication?.skillMatchScore ?? 0,
      interviewScore: latestApplication?.interviewScore ?? null,
      finalAIScore: latestApplication?.finalAIScore ?? 0,
      matchedSkills: skillGap?.matched_skills || latestApplication?.explanation?.matched_skills || [],
      missingSkills: skillGap?.missing_skills || latestApplication?.explanation?.missing_skills || [],
      strengths: resumeAdvice?.strengths || [],
      rewriteTips: resumeAdvice?.rewrite_tips || [],
    },
    applications,
    resume_advice: resumeAdvice,
    skill_gap: skillGap,
  };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (payload) => request({ method: "post", url: "/auth/login", data: { email: payload.email, password: payload.password } }),
  signup: (payload) => request({ method: "post", url: "/auth/signup", data: payload }),
  logout: () => request({ method: "post", url: "/auth/logout" }),
  me: () => request({ method: "get", url: "/auth/me" }),
};

// ── Candidate ────────────────────────────────────────────────────────────────
export const candidateApi = {
  dashboard: (jobId) => request({ method: "get", url: "/candidate/dashboard", params: jobId ? { job_id: jobId } : undefined }),
  jds: () => request({ method: "get", url: "/candidate/jds" }),
  selectJd: (jdId) => request({ method: "post", url: "/candidate/select-jd", data: { jd_id: jdId } }),
  uploadResume: (file, jobId) => {
    const formData = new FormData();
    formData.append("resume", file);
    if (jobId) formData.append("job_id", String(jobId));
    return request({ method: "post", url: "/candidate/upload-resume", data: formData });
  },
  scheduleInterview: (resultId, interviewDate) => request({ method: "post", url: "/candidate/select-interview-date", data: { result_id: resultId, interview_date: interviewDate } }),
  practiceKit: (jobId) => request({ method: "get", url: "/candidate/practice-kit", params: jobId ? { job_id: jobId } : undefined }),
};

// ── HR ───────────────────────────────────────────────────────────────────────
export const hrApi = {
  dashboard: (jobId) => request({ method: "get", url: "/hr/dashboard", params: jobId ? { job_id: jobId } : undefined }),

  // JDs
  listJds: () => request({ method: "get", url: "/hr/jds" }),
  getJd: (jdId) => request({ method: "get", url: `/hr/jds/${jdId}` }),
  createJd: (payload) => request({ method: "post", url: "/hr/jds", data: payload }),
  updateJd: (jdId, payload) => request({ method: "put", url: `/hr/jds/${jdId}`, data: payload }),
  toggleJdActive: (jdId) => request({ method: "post", url: `/hr/jds/${jdId}/toggle-active` }),
  deleteJd: (jdId) => request({ method: "delete", url: `/hr/jds/${jdId}` }),

  // JD file upload + LLM skill extraction
  uploadJd: (file, options = {}) => {
    const formData = new FormData();
    formData.append("jd_file", file);
    if (options.jd_title) formData.append("jd_title", String(options.jd_title));
    if (options.education_requirement) formData.append("education_requirement", String(options.education_requirement));
    if (options.experience_requirement != null) formData.append("experience_requirement", String(options.experience_requirement));
    if (options.cutoff_score != null) formData.append("cutoff_score", String(options.cutoff_score));
    if (options.question_count != null) formData.append("question_count", String(options.question_count));
    if (options.project_question_ratio != null) formData.append("project_question_ratio", String(options.project_question_ratio));
    return request({ method: "post", url: "/hr/upload-jd", data: formData });
  },
  confirmJd: (payload) => request({ method: "post", url: "/hr/confirm-jd", data: payload }),
  updateSkillWeights: (payload) => request({ method: "post", url: "/hr/update-skill-weights", data: payload }),

  // Candidates
  async listCandidates(params = {}) {
    const response = await request({ method: "get", url: "/hr/candidates", params });
    return { ...response, candidates: (response?.candidates || []).map(normalizeCandidateSummary) };
  },
  async candidateDetail(candidateUid) {
    const response = await request({ method: "get", url: `/hr/candidates/${candidateUid}` });
    return normalizeCandidateDetail(response);
  },
  skillGap: (candidateUid, jobId) => request({ method: "get", url: `/hr/candidates/${candidateUid}/skill-gap`, params: jobId ? { job_id: jobId } : undefined }),
  deleteCandidate: (candidateUid) => request({ method: "post", url: `/hr/candidates/${candidateUid}/delete` }),
  generateQuestions: (candidateId) => request({ method: "post", url: `/hr/candidate/${candidateId}/generate-questions` }),

  // Interviews
  interviews: () => request({ method: "get", url: "/hr/interviews" }),
  interviewDetail: (interviewId) => request({ method: "get", url: `/hr/interviews/${interviewId}` }),
  finalizeInterview: (interviewId, payload) => request({ method: "post", url: `/hr/interviews/${interviewId}/finalize`, data: payload }),
  // FIX C1: Added missing reEvaluateInterview — was causing JS crash on HR interview review page
  reEvaluateInterview: (interviewId) => request({ method: "post", url: `/hr/interviews/${interviewId}/re-evaluate` }),
  proctoringTimeline: (sessionId) => request({ method: "get", url: `/hr/proctoring/${sessionId}` }),

  // Backup
  async localBackup() {
    const response = await apiClient({ method: "get", url: "/hr/local-backup", responseType: "blob" });
    return response.data;
  },
};

// ── Interview ─────────────────────────────────────────────────────────────────
export const interviewApi = {
  access: (resultId) => request({ method: "get", url: `/interview/${resultId}/access` }),
  start: (payload) => request({ method: "post", url: "/interview/start", data: payload }),
  submitAnswer: (payload) => request({ method: "post", url: "/interview/answer", data: payload }),
  transcribe: (formData) => request({ method: "post", url: "/interview/transcribe", data: formData }),
  evaluate: (sessionId) => request({ method: "post", url: `/interview/${sessionId}/evaluate` }),
};

export const proctorApi = {
  uploadFrame: (sessionId, frameData, eventType = "scan") => {
    const formData = new FormData();
    formData.append("file", frameData, "frame.jpg");
    formData.append("session_id", String(sessionId));
    formData.append("event_type", eventType);
    return request({ method: "post", url: "/proctor/frame", data: formData });
  },
};

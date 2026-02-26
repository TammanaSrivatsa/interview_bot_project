import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

function getErrorMessage(error) {
  const fallback = "Request failed. Please try again.";
  if (!error) return fallback;
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

async function unwrap(promise) {
  try {
    const response = await promise;
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}

export const authApi = {
  login(payload) {
    return unwrap(apiClient.post("/auth/login", payload));
  },
  signup(payload) {
    return unwrap(apiClient.post("/auth/signup", payload));
  },
  logout() {
    return unwrap(apiClient.post("/auth/logout"));
  },
  me() {
    return unwrap(apiClient.get("/auth/me"));
  },
};

export const candidateApi = {
  dashboard(jobId) {
    const params = jobId ? { job_id: jobId } : undefined;
    return unwrap(apiClient.get("/candidate/dashboard", { params }));
  },
  uploadResume(file, jobId) {
    const formData = new FormData();
    formData.append("resume", file);
    if (jobId) formData.append("job_id", String(jobId));
    return unwrap(apiClient.post("/candidate/upload-resume", formData));
  },
  scheduleInterview(payload) {
    return unwrap(apiClient.post("/candidate/select-interview-date", payload));
  },
  skillMatch(jobId) {
    return unwrap(apiClient.get(`/candidate/skill-match/${jobId}`));
  },
};

export const hrApi = {
  interviews() {
    return unwrap(apiClient.get("/hr/interviews"));
  },
  interviewDetail(id) {
    return unwrap(apiClient.get(`/hr/interviews/${id}`));
  },
  finalizeInterview(id, payload) {
    return unwrap(apiClient.post(`/hr/interviews/${id}/finalize`, payload));
  },
  dashboard(jobId) {
    const params = jobId ? { job_id: jobId } : undefined;
    return unwrap(apiClient.get("/hr/dashboard", { params }));
  },
  uploadJd({
    file,
    jdTitle,
    educationRequirement,
    experienceRequirement,
    genderRequirement,
  }) {
    const formData = new FormData();
    formData.append("jd_file", file);
    formData.append("jd_title", jdTitle || "");
    formData.append("education_requirement", educationRequirement || "");
    formData.append("experience_requirement", experienceRequirement || "");
    formData.append("gender_requirement", genderRequirement || "");
    return unwrap(apiClient.post("/hr/upload-jd", formData));
  },
  confirmJd(skillScores) {
    return unwrap(apiClient.post("/hr/confirm-jd", { skill_scores: skillScores }));
  },
  updateSkillWeights(skillScores, jobId) {
    return unwrap(
      apiClient.post("/hr/update-skill-weights", {
        skill_scores: skillScores,
        job_id: jobId ?? null,
      }),
    );
  },
  submitInterviewScore(resultId, technicalScore) {
    return unwrap(
      apiClient.post("/hr/interview-score", {
        result_id: resultId,
        technical_score: technicalScore,
      }),
    );
  },
};

export const interviewApi = {
  start(payload = {}) {
    return unwrap(apiClient.post("/interview/start", payload));
  },
  submitAnswer(payload) {
    return unwrap(apiClient.post("/interview/answer", payload));
  },
  uploadProctorFrame(formData) {
    return unwrap(
      apiClient.post("/proctor/frame", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  },
  hrProctoring(sessionId) {
    return unwrap(apiClient.get(`/hr/proctoring/${sessionId}`));
  },
};

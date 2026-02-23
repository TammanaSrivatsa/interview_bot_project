const API_BASE = "/api";

// Base request wrapper:
// - includes cookie/session credentials
// - parses JSON safely
// - normalizes API errors into thrown Error objects
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.detail || `Request failed: ${response.status}`);
  }

  return data;
}

// JSON helper used by most routes (multipart uploads bypass this).
function requestJson(path, options = {}) {
  return request(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
}

// API surface consumed by React pages.
export const api = {
  login(payload) {
    return requestJson("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  signup(payload) {
    return requestJson("/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  me() {
    return requestJson("/auth/me");
  },

  logout() {
    return requestJson("/auth/logout", { method: "POST" });
  },

  candidateDashboard(jobId) {
    const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
    return requestJson(`/candidate/dashboard${query}`);
  },

  uploadResume(file, jobId) {
    const formData = new FormData();
    formData.append("resume", file);
    if (jobId) {
      formData.append("job_id", String(jobId));
    }
    return request("/candidate/upload-resume", {
      method: "POST",
      body: formData,
    });
  },

  scheduleInterview(payload) {
    return requestJson("/candidate/select-interview-date", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  hrDashboard(jobId) {
    const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
    return requestJson(`/hr/dashboard${query}`);
  },

  uploadJd({ file, jdTitle, educationRequirement, experienceRequirement, genderRequirement }) {
    const formData = new FormData();
    formData.append("jd_file", file);
    formData.append("jd_title", jdTitle || "");
    formData.append("education_requirement", educationRequirement || "");
    formData.append("experience_requirement", experienceRequirement || "");
    formData.append("gender_requirement", genderRequirement || "");
    return request("/hr/upload-jd", {
      method: "POST",
      body: formData,
    });
  },

  confirmJd(skillScores) {
    return requestJson("/hr/confirm-jd", {
      method: "POST",
      body: JSON.stringify({ skill_scores: skillScores }),
    });
  },

  updateSkillWeights(skillScores, jobId) {
    return requestJson("/hr/update-skill-weights", {
      method: "POST",
      body: JSON.stringify({ skill_scores: skillScores, job_id: jobId || null }),
    });
  },

  interviewInfo(resultId, token) {
    return requestJson(`/interview/${resultId}?token=${encodeURIComponent(token)}`);
  },

  interviewNextQuestion(payload) {
    return requestJson("/interview/next-question", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

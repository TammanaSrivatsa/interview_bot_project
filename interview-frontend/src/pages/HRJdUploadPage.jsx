import { useState } from "react";
import { ArrowLeft, Upload, Check, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { hrApi } from "../services/api";

export default function HRJdUploadPage() {
  const [step, setStep] = useState("upload"); // upload, review, confirm, success
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [confirmData, setConfirmData] = useState({
    title: "",
    jd_text: "",
    department: "",
    location: "",
    total_questions: 8,
    project_question_ratio: 0.8,
  });

  async function handleFileUpload(e) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setError("");
    setFile(selectedFile);
    setLoading(true);

    try {
      const result = await hrApi.uploadJd(selectedFile, {
        jd_title: confirmData.title,
        question_count: confirmData.total_questions,
        project_question_ratio: confirmData.project_question_ratio,
      });
      setExtractedData(result);
      setConfirmData({
        title: result?.jd_title || "",
        jd_text: result?.jd_text || "",
        department: result?.department || "",
        location: result?.location || "",
        total_questions: Number(result?.question_count ?? 8),
        project_question_ratio: Number(result?.project_question_ratio ?? 0.8),
      });
      setStep("review");
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmJd() {
    setLoading(true);
    setError("");

    try {
      await hrApi.confirmJd(confirmData);
      setStep("success");
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleResetUpload() {
    setStep("upload");
    setFile(null);
    setExtractedData(null);
    setConfirmData({
      title: "",
      jd_text: "",
      department: "",
      location: "",
      total_questions: 8,
      project_question_ratio: 0.8,
    });
    setError("");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Link to="/hr/jds" className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 transition-colors font-medium">
          <ArrowLeft size={20} />
          <span>Back to JD Management</span>
        </Link>
      </div>

      {step === "upload" && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 shadow-sm">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Upload Job Description</h1>
            <p className="text-lg text-slate-600 dark:text-slate-400 mb-10">Upload a JD file (PDF, DOCX, or TXT) to automatically extract job details and skills.</p>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-12 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors">
              <Upload size={48} className="mx-auto text-slate-400 dark:text-slate-500 mb-4" />
              <label className="cursor-pointer">
                <span className="text-xl font-bold text-blue-600 hover:text-blue-700">Click to upload</span>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={loading}
                  accept=".pdf,.docx,.txt"
                  className="hidden"
                />
              </label>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-3">or drag and drop</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">PDF, DOCX, or TXT • up to 10MB</p>
            </div>

            {file && !loading && (
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50">
                <p className="text-sm font-bold text-blue-900 dark:text-blue-300">File selected: {file.name}</p>
              </div>
            )}

            {loading && (
              <div className="mt-6 text-center">
                <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-600 dark:text-slate-400 mt-3">Processing file...</p>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800/50">
                <p className="text-sm font-bold text-red-900 dark:text-red-300">{error}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "review" && extractedData && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">Review Extracted Data</h1>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">Job Title</label>
              <input
                type="text"
                value={confirmData.title}
                onChange={(e) => setConfirmData({ ...confirmData, title: e.target.value })}
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">Department</label>
                <input
                  type="text"
                  value={confirmData.department}
                  onChange={(e) => setConfirmData({ ...confirmData, department: e.target.value })}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">Location</label>
                <input
                  type="text"
                  value={confirmData.location}
                  onChange={(e) => setConfirmData({ ...confirmData, location: e.target.value })}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">No. of Questions</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={confirmData.total_questions}
                  onChange={(e) => setConfirmData({ ...confirmData, total_questions: Number(e.target.value) || 8 })}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">Project Question Ratio (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  value={Math.round(Number(confirmData.project_question_ratio || 0) * 100)}
                  onChange={(e) => setConfirmData({ ...confirmData, project_question_ratio: Math.max(0, Math.min(1, (Number(e.target.value) || 0) / 100)) })}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <p className="text-xs text-slate-400 mt-2">Rest = HR/general questions.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2">Job Description Text</label>
              <textarea
                value={confirmData.jd_text}
                onChange={(e) => setConfirmData({ ...confirmData, jd_text: e.target.value })}
                rows={10}
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-sm"
              />
            </div>

            {extractedData?.extracted_skills && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Extracted Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {extractedData.extracted_skills.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-bold border border-blue-100 dark:border-blue-800/50"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800/50">
                <p className="text-sm font-bold text-red-900 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={handleResetUpload}
                className="flex-1 px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                Upload Different File
              </button>
              <button
                onClick={handleConfirmJd}
                disabled={loading}
                className="flex-1 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all disabled:opacity-50"
              >
                {loading ? "Confirming..." : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "success" && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 shadow-sm">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center mx-auto mb-6">
              <Check size={32} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">JD Uploaded Successfully</h1>
            <p className="text-lg text-slate-600 dark:text-slate-400 mb-10">{confirmData.title} has been added to your job descriptions.</p>

            <div className="flex gap-4 justify-center">
              <Link
                to="/hr/jds"
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all"
              >
                View All JDs
              </Link>
              <button
                onClick={handleResetUpload}
                className="px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                Upload Another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

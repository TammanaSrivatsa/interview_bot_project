import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Save, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { hrApi } from "../services/api";

export default function HRSkillWeightsPage() {
  const [jds, setJds] = useState([]);
  const [selectedJdId, setSelectedJdId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [skills, setSkills] = useState([]);
  const [cutoffScore, setCutoffScore] = useState(65);

  const loadJds = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await hrApi.listJds();
      setJds(response?.jds || []);
      if (response?.jds?.length > 0) {
        setSelectedJdId(response.jds[0].id);
        initializeSkills(response.jds[0]);
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJds();
  }, [loadJds]);

  function initializeSkills(jd) {
    try {
      const weights = jd?.weights_json || {};
      const skillList = Object.entries(weights).map(([skill, weight]) => ({
        skill,
        weight: Number(weight) || 1,
      }));
      setSkills(skillList.length > 0 ? skillList : [{ skill: "", weight: 1 }]);
      setCutoffScore(jd?.qualify_score || 65);
    } catch {
      setSkills([{ skill: "", weight: 1 }]);
      setCutoffScore(65);
    }
  }

  function handleJdChange(jdId) {
    setSelectedJdId(jdId);
    const selectedJd = jds.find((jd) => jd.id === jdId);
    if (selectedJd) {
      initializeSkills(selectedJd);
    }
  }

  function handleSkillChange(index, field, value) {
    const updated = [...skills];
    updated[index] = { ...updated[index], [field]: value };
    setSkills(updated);
  }

  function handleAddSkill() {
    setSkills([...skills, { skill: "", weight: 1 }]);
  }

  function handleRemoveSkill(index) {
    setSkills(skills.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!selectedJdId) {
      setError("Please select a job description");
      return;
    }

    const validSkills = skills.filter((s) => s.skill.trim());
    if (validSkills.length === 0) {
      setError("Please add at least one skill");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const weights = {};
      validSkills.forEach((s) => {
        weights[s.skill] = s.weight;
      });

      await hrApi.updateSkillWeights({
        jd_id: selectedJdId,
        weights: weights,
        cutoff_score: cutoffScore,
      });

      setMessage("Skill weights updated successfully!");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="center muted">Loading job descriptions...</p>;
  }

  if (!jds.length) {
    return (
      <div className="space-y-8">
        <Link to="/hr/jds" className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 transition-colors font-medium">
          <ArrowLeft size={20} />
          <span>Back to JD Management</span>
        </Link>
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          <p className="text-center text-slate-600 dark:text-slate-400">No job descriptions available. Please create one first.</p>
        </div>
      </div>
    );
  }

  const selectedJd = jds.find((jd) => jd.id === selectedJdId);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Link to="/hr/jds" className="flex items-center space-x-2 text-slate-500 hover:text-blue-600 transition-colors font-medium">
          <ArrowLeft size={20} />
          <span>Back to JD Management</span>
        </Link>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Configure Skill Weights</h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">Set importance weights for skills and qualification cutoff scores.</p>

        <div className="mb-8">
          <label className="block text-sm font-bold text-slate-900 dark:text-white mb-3">Select Job Description</label>
          <select
            value={selectedJdId || ""}
            onChange={(e) => handleJdChange(Number(e.target.value))}
            className="w-full md:w-96 px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
          >
            {jds.map((jd) => (
              <option key={jd.id} value={jd.id}>
                {jd.title} (ID: {jd.id})
              </option>
            ))}
          </select>
        </div>

        {selectedJd && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-2xl p-6 mb-8">
            <p className="text-sm text-blue-900 dark:text-blue-300">
              <span className="font-bold">Job Title:</span> {selectedJd.title}
            </p>
            {selectedJd.department && (
              <p className="text-sm text-blue-900 dark:text-blue-300">
                <span className="font-bold">Department:</span> {selectedJd.department}
              </p>
            )}
          </div>
        )}

        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Skills & Weights</h3>
            <div className="space-y-4">
              {skills.map((skill, index) => (
                <div key={index} className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-white mb-2 uppercase tracking-wider">Skill Name</label>
                    <input
                      type="text"
                      value={skill.skill}
                      onChange={(e) => handleSkillChange(index, "skill", e.target.value)}
                      placeholder="e.g., JavaScript, React, Node.js"
                      className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-bold text-slate-900 dark:text-white mb-2 uppercase tracking-wider">Weight</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="0.5"
                      value={skill.weight}
                      onChange={(e) => handleSkillChange(index, "weight", Number(e.target.value))}
                      className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveSkill(index)}
                    className="px-4 py-3 rounded-xl border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleAddSkill}
              className="mt-4 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
              + Add Skill
            </button>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-900 dark:text-white mb-3">Qualification Cutoff Score</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                value={cutoffScore}
                onChange={(e) => setCutoffScore(Number(e.target.value))}
                className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-full cursor-pointer"
              />
              <div className="w-20 px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-center">
                {cutoffScore}%
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Minimum score for a candidate to be qualified</p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800/50">
              <p className="text-sm font-bold text-red-900 dark:text-red-300 flex items-start">
                <AlertCircle size={18} className="mr-2 flex-shrink-0 mt-0.5" />
                {error}
              </p>
            </div>
          )}

          {message && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-800/50">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-300">{message}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center"
          >
            <Save size={20} className="mr-2" />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}

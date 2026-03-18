import { useState, useEffect, useRef } from "react";
import {
  Lock, Bell, Moon, Sun, Shield, LogOut, Camera,
  CheckCircle2, Eye, EyeOff, Save, Monitor, Smartphone,
  ToggleLeft, AlertCircle, Loader2, User, Mail
} from "lucide-react";
import { useAuth } from "../context/useAuth";
import { authApi } from "../services/api";
import { cn } from "../utils/utils";

// ── Theme hook ─────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const toggle = (t) => {
    const root = document.documentElement;
    if (t === "dark") { root.classList.add("dark"); setTheme("dark"); localStorage.setItem("theme", "dark"); }
    else { root.classList.remove("dark"); setTheme("light"); localStorage.setItem("theme", "light"); }
  };
  return { theme, toggle };
}

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  if (!msg) return null;
  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-bold animate-in slide-in-from-bottom-4 duration-300",
      type === "success" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-red-600 border-red-500 text-white"
    )}>
      {type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange, label, sub }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div>
        <p className="text-sm font-bold text-slate-800 dark:text-white">{label}</p>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-11 h-6 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
          checked ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"
        )}
      >
        <span className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300",
          checked ? "translate-x-5" : "translate-x-0"
        )} />
      </button>
    </div>
  );
}

// ── Password field ────────────────────────────────────────────────────────
function PasswordField({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pr-11 pl-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-white transition-all"
        />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────
function Section({ title, sub, children, icon: Icon }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
        {Icon && <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400"><Icon size={16} /></div>}
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </div>
      <div className="px-8 py-6">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout, refreshSession } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const fileInputRef = useRef(null);

  // Profile state
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Notifications state
  const [notifs, setNotifs] = useState({
    emailOnSchedule: true,
    emailOnReview: true,
    emailOnShortlist: false,
    browserAlerts: true,
    weeklyDigest: false,
  });

  // Appearance state
  const [fontSize, setFontSize] = useState("normal");
  const [compactMode, setCompactMode] = useState(false);

  // Toast
  const [toast, setToast] = useState({ msg: "", type: "success" });

  const showToast = (msg, type = "success") => setToast({ msg, type });

  // Sync user data when auth loads
  useEffect(() => {
    if (user) { setName(user.name || ""); setEmail(user.email || ""); }
  }, [user]);

  // Load saved preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("interviewbot_notifs");
      if (saved) setNotifs(JSON.parse(saved));
      const savedFs = localStorage.getItem("interviewbot_fontsize");
      if (savedFs) setFontSize(savedFs);
      const savedCompact = localStorage.getItem("interviewbot_compact");
      if (savedCompact) setCompactMode(savedCompact === "true");
    } catch {}
  }, []);

  // Profile save — calls PUT /api/auth/profile (we add a simple endpoint)
  async function handleSaveProfile(e) {
    e.preventDefault();
    if (!name.trim()) { showToast("Name cannot be empty", "error"); return; }
    setSavingProfile(true);
    try {
      // Try to update via API; fall back gracefully if endpoint isn't wired yet
      await fetch("/api/auth/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      });
      await refreshSession();
      showToast("Profile updated successfully!");
    } catch {
      // If endpoint doesn't exist yet, just show success (name updated locally)
      showToast("Profile saved locally. Backend endpoint needed for persistence.", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  // Password change
  async function handleChangePassword(e) {
    e.preventDefault();
    if (!currentPw || !newPw || !confirmPw) { showToast("All password fields are required", "error"); return; }
    if (newPw.length < 6) { showToast("New password must be at least 6 characters", "error"); return; }
    if (newPw !== confirmPw) { showToast("New passwords do not match", "error"); return; }
    setSavingPw(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.detail || "Password change failed");
      }
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      showToast("Password changed successfully!");
    } catch (err) {
      showToast(err.message || "Failed to change password", "error");
    } finally {
      setSavingPw(false);
    }
  }

  // Notification prefs — stored locally (extend to backend if needed)
  function handleNotifChange(key, value) {
    const next = { ...notifs, [key]: value };
    setNotifs(next);
    localStorage.setItem("interviewbot_notifs", JSON.stringify(next));
    showToast("Notification preference saved");
  }

  // Appearance
  function handleFontSize(size) {
    setFontSize(size);
    localStorage.setItem("interviewbot_fontsize", size);
    const root = document.documentElement;
    root.style.fontSize = size === "small" ? "14px" : size === "large" ? "17px" : "16px";
    showToast("Font size updated");
  }
  function handleCompact(val) {
    setCompactMode(val);
    localStorage.setItem("interviewbot_compact", String(val));
    showToast("Layout preference saved");
  }

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "security", label: "Security", icon: Lock },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "appearance", label: "Appearance", icon: Monitor },
  ];
  const [activeTab, setActiveTab] = useState("profile");

  return (
    <div className="space-y-8 pb-12">
      {/* Toast */}
      <Toast msg={toast.msg} type={toast.type} onClose={() => setToast({ msg: "", type: "success" })} />

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Manage your account, security, notifications, and appearance.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <aside className="lg:w-56 flex-shrink-0">
          {/* Avatar card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 mb-4 text-center">
            <div className="relative inline-block mb-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-black mx-auto shadow-lg">
                {(user?.name?.[0] || "U").toUpperCase()}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-md hover:bg-blue-700 transition-colors"
              >
                <Camera size={13} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={() => showToast("Avatar upload coming soon", "error")} />
            </div>
            <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{user?.name || "User"}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
            <span className="mt-2 inline-block px-2.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wider rounded-full capitalize">{user?.role || "user"}</span>
          </div>

          {/* Nav */}
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                  activeTab === tab.id
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-100 dark:shadow-none"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white"
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 space-y-6 min-w-0">

          {/* ── PROFILE TAB ─────────────────────────────────────────── */}
          {activeTab === "profile" && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <Section title="Personal Information" sub="Update your display name and email" icon={User}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-white transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      disabled
                      className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed"
                    />
                    <p className="text-[11px] text-slate-400">Email cannot be changed after signup</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role</label>
                    <input
                      type="text"
                      value={user?.role === "hr" ? "HR / Recruiter" : "Candidate"}
                      disabled
                      className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed capitalize"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Account ID</label>
                    <input
                      type="text"
                      value={`#${user?.id || "—"}`}
                      disabled
                      className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed font-mono"
                    />
                  </div>
                </div>
                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="flex items-center gap-2 px-7 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-200 dark:shadow-none transition-all disabled:opacity-60"
                  >
                    {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {savingProfile ? "Saving…" : "Save Profile"}
                  </button>
                </div>
              </Section>
            </form>
          )}

          {/* ── SECURITY TAB ────────────────────────────────────────── */}
          {activeTab === "security" && (
            <div className="space-y-6">
              <form onSubmit={handleChangePassword}>
                <Section title="Change Password" sub="Use a strong password of at least 6 characters" icon={Lock}>
                  <div className="space-y-4 max-w-md">
                    <PasswordField label="Current Password" value={currentPw} onChange={setCurrentPw} placeholder="Enter current password" />
                    <PasswordField label="New Password" value={newPw} onChange={setNewPw} placeholder="At least 6 characters" />
                    <PasswordField label="Confirm New Password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat new password" />

                    {/* Password strength indicator */}
                    {newPw.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4].map((i) => {
                            const strength = newPw.length < 6 ? 1 : newPw.length < 10 ? 2 : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 4 : 3;
                            return <div key={i} className={cn("h-1 flex-1 rounded-full transition-all", i <= strength ? strength >= 4 ? "bg-emerald-500" : strength >= 3 ? "bg-blue-500" : strength >= 2 ? "bg-amber-500" : "bg-red-400" : "bg-slate-200 dark:bg-slate-700")} />;
                          })}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {newPw.length < 6 ? "Too short" : newPw.length < 10 ? "Weak — add more characters" : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? "Strong password ✓" : "Good — add uppercase & numbers for strong"}
                        </p>
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={savingPw}
                        className="flex items-center gap-2 px-7 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-200 dark:shadow-none transition-all disabled:opacity-60"
                      >
                        {savingPw ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                        {savingPw ? "Updating…" : "Update Password"}
                      </button>
                    </div>
                  </div>
                </Section>
              </form>

              <Section title="Session Info" sub="Your current login session details" icon={Shield}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: "Logged in as", value: user?.email || "—" },
                    { label: "Role", value: user?.role === "hr" ? "HR / Recruiter" : "Candidate" },
                    { label: "Session", value: "Active" },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={logout}
                    className="flex items-center gap-2 px-5 py-2.5 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-bold rounded-xl text-sm transition-all"
                  >
                    <LogOut size={15} />Sign out everywhere
                  </button>
                </div>
              </Section>
            </div>
          )}

          {/* ── NOTIFICATIONS TAB ───────────────────────────────────── */}
          {activeTab === "notifications" && (
            <div className="space-y-6">
              <Section title="Email Notifications" sub="Control which emails are sent to your inbox" icon={Mail}>
                <div>
                  <ToggleSwitch checked={notifs.emailOnSchedule} onChange={(v) => handleNotifChange("emailOnSchedule", v)} label="Interview Scheduled" sub="Receive email when an interview is confirmed" />
                  <ToggleSwitch checked={notifs.emailOnReview} onChange={(v) => handleNotifChange("emailOnReview", v)} label="Interview Reviewed" sub="When HR finalizes your interview decision" />
                  <ToggleSwitch checked={notifs.emailOnShortlist} onChange={(v) => handleNotifChange("emailOnShortlist", v)} label="Shortlist Updates" sub="Notify when resume is shortlisted or rejected" />
                  <ToggleSwitch checked={notifs.weeklyDigest} onChange={(v) => handleNotifChange("weeklyDigest", v)} label="Weekly Digest" sub="Summary of your recruitment pipeline every Monday" />
                </div>
              </Section>

              <Section title="In-App Alerts" sub="Real-time notifications inside the platform" icon={Bell}>
                <ToggleSwitch checked={notifs.browserAlerts} onChange={(v) => handleNotifChange("browserAlerts", v)} label="Browser Notifications" sub="Push alerts when tab is in the background" />
                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                  <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">Preferences saved locally. To persist across devices, a backend profile API endpoint needs to be wired to <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">POST /api/auth/preferences</code>.</p>
                </div>
              </Section>
            </div>
          )}

          {/* ── APPEARANCE TAB ──────────────────────────────────────── */}
          {activeTab === "appearance" && (
            <div className="space-y-6">
              <Section title="Theme" sub="Choose how InterviewBot looks" icon={Monitor}>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "light", label: "Light", icon: Sun, preview: "bg-white border-2" },
                    { id: "dark", label: "Dark", icon: Moon, preview: "bg-slate-900 border-2" },
                    { id: "system", label: "System", icon: Monitor, preview: "bg-gradient-to-br from-white to-slate-900 border-2" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { if (opt.id !== "system") toggleTheme(opt.id); else toggleTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }}
                      className={cn(
                        "flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all",
                        theme === opt.id ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                      )}
                    >
                      <div className={cn("w-full h-16 rounded-xl overflow-hidden border", opt.preview, theme === opt.id ? "border-blue-400" : "border-slate-200 dark:border-slate-700")}>
                        <div className={cn("w-full h-4 flex gap-1 items-center px-2", opt.id === "dark" ? "bg-slate-800" : "bg-slate-100")}>
                          {[1,2,3].map((i) => <div key={i} className={cn("w-2 h-2 rounded-full", opt.id === "dark" ? "bg-slate-600" : "bg-slate-300")} />)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <opt.icon size={14} className={theme === opt.id ? "text-blue-600" : "text-slate-500"} />
                        <span className={cn("text-sm font-bold", theme === opt.id ? "text-blue-600" : "text-slate-600 dark:text-slate-300")}>{opt.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Font Size" sub="Adjust text size across the interface" icon={Monitor}>
                <div className="flex gap-3">
                  {[
                    { id: "small", label: "Small", sample: "text-xs" },
                    { id: "normal", label: "Normal", sample: "text-sm" },
                    { id: "large", label: "Large", sample: "text-base" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleFontSize(opt.id)}
                      className={cn(
                        "flex-1 py-4 rounded-2xl border-2 text-center transition-all",
                        fontSize === opt.id ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      <span className={cn("font-bold block", opt.sample)}>Aa</span>
                      <span className="text-xs font-bold mt-1 block">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Layout" sub="Customize information density" icon={Smartphone}>
                <ToggleSwitch checked={compactMode} onChange={handleCompact} label="Compact Mode" sub="Reduce padding and spacing for more information density" />
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

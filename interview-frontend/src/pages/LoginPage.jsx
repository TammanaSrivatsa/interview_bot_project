import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { Video, Mail, Lock, ArrowRight, ShieldCheck, UserCircle } from "lucide-react";
import { cn } from "../utils/utils";

export default function LoginPage() {
  const navigate = useNavigate();
  // FIX: useLocation so we can read state.from (set by ProtectedRoute)
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loginType, setLoginType] = useState("candidate");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password, role: loginType });

      // FIX: If the user came from a protected page (e.g. email interview link),
      // send them back there instead of to the generic dashboard.
      const fromPath = location.state?.from;
      if (fromPath && typeof fromPath === "string") {
        navigate(fromPath, { replace: true });
        return;
      }
      // Default: go to home which HomeRedirect resolves to the correct dashboard
      navigate("/", { replace: true });
    } catch (submitError) {
      setError(
        submitError?.message || "Login failed. Please check your credentials."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 font-sans">
      <div className="max-w-5xl w-full grid md:grid-cols-2 bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">

        {/* Left Side: Branding */}
        <div className="hidden md:flex flex-col justify-between bg-blue-600 p-12 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center space-x-2 mb-12">
              <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm">
                <Video className="text-white w-6 h-6" />
              </div>
              <span className="text-2xl font-bold font-display tracking-tight">
                Interview<span className="opacity-80">Bot</span>
              </span>
            </div>
            <h1 className="text-4xl font-bold font-display leading-tight mb-6">
              The AI-Powered Recruitment Revolution.
            </h1>
            <p className="text-blue-100 text-lg mb-8">
              Streamline your hiring process with automated AI interviews,
              real-time analysis, and deep candidate insights.
            </p>
            <div className="space-y-4">
              <div className="flex items-center space-x-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                  <ShieldCheck size={14} />
                </div>
                <span>99.9% AI Accuracy in Scoring</span>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                  <ShieldCheck size={14} />
                </div>
                <span>Real-time Technical Assessments</span>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-blue-500 rounded-full opacity-20"></div>
          <div className="absolute top-1/2 -right-12 w-32 h-32 bg-indigo-500 rounded-full opacity-20"></div>
        </div>

        {/* Right Side: Login Form */}
        <div className="p-8 md:p-12 lg:p-16">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Welcome back
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Please enter your details to sign in.
            </p>
          </div>

          {/* Login Type Toggle */}
          <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-8">
            <button
              onClick={() => setLoginType("candidate")}
              className={cn(
                "flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                loginType === "candidate"
                  ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              <UserCircle size={18} />
              <span>Candidate</span>
            </button>
            <button
              onClick={() => setLoginType("hr")}
              className={cn(
                "flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                loginType === "hr"
                  ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              <ShieldCheck size={18} />
              <span>HR / Recruiter</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm border border-red-100 dark:border-red-900/30">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <a
                  href="#"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-200 dark:shadow-none flex items-center justify-center space-x-2 group disabled:opacity-70"
            >
              <span>{loading ? "Signing in..." : "Sign In"}</span>
              {!loading && (
                <ArrowRight
                  size={18}
                  className="group-hover:translate-x-1 transition-transform"
                />
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Don&apos;t have an account?{" "}
            <Link
              to="/signup"
              className="text-blue-600 dark:text-blue-400 font-bold hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./layout/DashboardLayout";
import { useAuth } from "./context/useAuth";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import HRDashboardPage from "./pages/HRDashboardPage";
import HRCandidatesPage from "./pages/HRCandidatesPage";
import HRCandidateDetailPage from "./pages/HRCandidateDetailPage";
import HRInterviewListPage from "./pages/HRInterviewListPage";
import HRInterviewDetailPage from "./pages/HRInterviewDetailPage";
import HRScoreMatrixPage from "./pages/HRScoreMatrixPage";
import HRJdManagementPage from "./pages/HRJdManagementPage";
import HRJdDetailPage from "./pages/HRJdDetailPage";
import HRAnalyticsPage from "./pages/HRAnalyticsPage";
import HRBackupPage from "./pages/HRBackupPage";
import HRProctoringPage from "./pages/HRProctoringPage";
import CandidateDashboardPage from "./pages/CandidateDashboardPage";
import PracticeInterviewPage from "./pages/PracticeInterviewPage";
import PreCheck from "./pages/PreCheck";
import Interview from "./pages/Interview";
import Completed from "./pages/Completed";
import FinalResultPage from "./pages/FinalResultPage";
import SettingsPage from "./pages/SettingsPage";
import "./App.css";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "hr" ? "/hr" : "/candidate"} replace />;
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={user.role === "hr" ? "/hr" : "/candidate"} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/signup" element={<PublicOnlyRoute><SignupPage /></PublicOnlyRoute>} />

      {/* ── INTERVIEW ROUTES — NO LOGIN REQUIRED ─────────────────────────────
          These are accessed directly from the email link.
          The backend validates the candidate via session cookie if present,
          or handles it in PreCheck. No frontend auth guard needed. */}
      <Route path="/interview/:resultId" element={<PreCheck />} />
      <Route path="/interview/:resultId/live" element={<Interview />} />
      <Route path="/interview/:resultId/completed" element={<Completed />} />

      {/* HR routes — login required */}
      <Route element={<ProtectedRoute role="hr" />}>
        <Route element={<DashboardLayout />}>
          <Route path="/hr" element={<HRDashboardPage />} />
          <Route path="/hr/jds" element={<HRJdManagementPage />} />
          <Route path="/hr/jds/:jdId" element={<HRJdDetailPage />} />
          <Route path="/hr/candidates" element={<HRCandidatesPage />} />
          <Route path="/hr/candidates/:candidateUid" element={<HRCandidateDetailPage />} />
          <Route path="/hr/interviews" element={<HRInterviewListPage />} />
          <Route path="/hr/interviews/:id" element={<HRInterviewDetailPage />} />
          <Route path="/hr/matrix" element={<HRScoreMatrixPage />} />
          <Route path="/hr/analytics" element={<HRAnalyticsPage />} />
          <Route path="/hr/backup" element={<HRBackupPage />} />
          <Route path="/hr/proctoring/:sessionId" element={<HRProctoringPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Candidate dashboard routes — login required */}
      <Route element={<ProtectedRoute role="candidate" />}>
        <Route element={<DashboardLayout />}>
          <Route path="/candidate" element={<CandidateDashboardPage />} />
          <Route path="/candidate/practice" element={<PracticeInterviewPage />} />
          <Route path="/interview/result" element={<FinalResultPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import CandidateDashboardPage from "./pages/CandidateDashboardPage";
import Completed from "./pages/Completed";
import HRDashboardPage from "./pages/HRDashboardPage";
import HRInterviewListPage from "./pages/HRInterviewListPage";
import HRInterviewDetailPage from "./pages/HRInterviewDetailPage";
import Interview from "./pages/Interview";
import CandidateInterviewPage from "./pages/CandidateInterviewPage";
import LoginPage from "./pages/LoginPage";
import PreCheck from "./pages/PreCheck";
import SignupPage from "./pages/SignupPage";
import "./App.css";

function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Interview Bot</h1>
        {user && (
          <div className="header-actions">
            <span className="chip">{user.role.toUpperCase()}</span>
            <button onClick={logout}>Logout</button>
          </div>
        )}
      </header>
      <Outlet />
    </main>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center muted">Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "hr" ? "/hr" : "/candidate"} replace />;
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="center muted">Loading...</p>;
  if (user) return <Navigate to={user.role === "hr" ? "/hr" : "/candidate"} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomeRedirect />} />
        <Route
          path="login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="signup"
          element={
            <PublicOnlyRoute>
              <SignupPage />
            </PublicOnlyRoute>
          }
        />
        <Route path="interview/:token" element={<CandidateInterviewPage />} />
        <Route element={<ProtectedRoute role="candidate" />}>
          <Route path="candidate" element={<CandidateDashboardPage />} />
          <Route path="interview/:resultId" element={<PreCheck />} />
          <Route path="interview/:resultId/live" element={<Interview />} />
          <Route path="interview/:resultId/completed" element={<Completed />} />
        </Route>
        <Route element={<ProtectedRoute role="hr" />}>
          <Route path="hr" element={<HRDashboardPage />} />
          <Route path="hr/interviews" element={<HRInterviewListPage />} />
          <Route path="hr/interviews/:id" element={<HRInterviewDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

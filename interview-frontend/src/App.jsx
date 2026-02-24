import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import CandidateDashboardPage from "./pages/CandidateDashboardPage";
import HRDashboardPage from "./pages/HRDashboardPage";
import InterviewPage from "./pages/InterviewPage";
import LoginPage from "./pages/LoginPage";
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
        <Route path="interview/:resultId" element={<InterviewPage />} />
        <Route element={<ProtectedRoute role="candidate" />}>
          <Route path="candidate" element={<CandidateDashboardPage />} />
        </Route>
        <Route element={<ProtectedRoute role="hr" />}>
          <Route path="hr" element={<HRDashboardPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

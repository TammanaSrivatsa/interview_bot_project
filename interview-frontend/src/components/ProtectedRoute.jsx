import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function LoadingState() {
  return <p className="center muted">Checking session...</p>;
}

export default function ProtectedRoute({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (role && user.role !== role) {
    const redirectPath = user.role === "hr" ? "/hr" : "/candidate";
    return <Navigate to={redirectPath} replace />;
  }
  return <Outlet />;
}

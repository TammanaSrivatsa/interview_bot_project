import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password });
      const fromPath = location.state?.from;
      if (fromPath && typeof fromPath === "string") {
        navigate(fromPath, { replace: true });
        return;
      }
      navigate("/", { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="card form" onSubmit={handleSubmit}>
        <h2>Login</h2>
        {error && <p className="alert error">{error}</p>}
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
        <p className="muted">
          New user? <Link to="/signup">Create account</Link>
        </p>
      </form>
    </section>
  );
}

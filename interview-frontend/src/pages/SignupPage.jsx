import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [role, setRole] = useState("candidate");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await signup({
        role,
        name,
        email,
        password,
        gender: role === "candidate" ? gender || null : null,
      });
      setNotice("Signup successful. Please login.");
      setTimeout(() => navigate("/login", { replace: true }), 400);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="card form" onSubmit={handleSubmit}>
        <h2>Signup</h2>
        {error && <p className="alert error">{error}</p>}
        {notice && <p className="alert success">{notice}</p>}
        <label htmlFor="signup-role">Role</label>
        <select id="signup-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="candidate">Candidate</option>
          <option value="hr">HR</option>
        </select>
        <label htmlFor="signup-name">{role === "hr" ? "Company Name" : "Name"}</label>
        <input id="signup-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {role === "candidate" && (
          <>
            <label htmlFor="signup-gender">Gender (optional)</label>
            <select id="signup-gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </>
        )}
        <button type="submit" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </button>
        <p className="muted">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </form>
    </section>
  );
}

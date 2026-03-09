import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);

    try {
      const response = await axios.post('/login', formData);
      if (response.data.success) {
        window.location.href = response.data.redirect;
      }
    } catch (error) {
      alert('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="ib-shell">
        <div className="ib-container ib-grid ib-grid-auth">
          <section className="ib-card ib-p-28">
            <div className="ib-kicker">Real Usage Flow</div>
            <h1 className="ib-title">Run interviews exactly like production</h1>
            <p className="ib-subtitle">
              HR uploads a JD, AI extracts weighted skills, candidates apply with resume,
              shortlisted applicants schedule and join timed interviews.
            </p>
            <ol className="ib-step-list mt-4">
              <li>HR creates role and confirms AI-extracted skill scoring</li>
              <li>Candidate chooses role and uploads resume</li>
              <li>System shortlists and opens interview scheduling</li>
              <li>Candidate completes setup check and starts monitored interview</li>
            </ol>
            <div className="mt-4 d-flex gap-2 flex-wrap">
              <span className="ib-chip ib-chip-brand">AI Screening</span>
              <span className="ib-chip ib-chip-brand">Dynamic Questions</span>
              <span className="ib-chip ib-chip-brand">Interview Tracking</span>
            </div>
          </section>

          <section className="ib-card ib-p-28">
            <h4 className="mb-3">Login</h4>
            <form onSubmit={handleSubmit}>
              <label className="ib-label">Work Email</label>
              <input
                className="form-control mb-3"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <label className="ib-label">Password</label>
              <input
                type="password"
                className="form-control mb-2"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <div className="ib-help">Use the account role you want to continue with.</div>

              <button disabled={loading} className="btn btn-dark w-100 mt-4">
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="text-center mt-3">
              <small>
                New here?{' '}
                <Link to="/signup" className="text-decoration-none">
                  Create account
                </Link>
              </small>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default Login;

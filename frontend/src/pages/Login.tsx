import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AxiosError } from 'axios';
import api from '../lib/api';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);

    try {
      const response = await api.post('/login', formData);
      if (response.data.success) {
        window.location.href = response.data.redirect;
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      console.error('Login failed', axiosError);
      alert('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="ib-login-shell">
        <div className="ib-login-bg" />
        <div className="ib-login-grid">
          <section className="ib-login-hero">
            <div className="ib-login-overlay" />
            <div className="ib-login-brand">
              <div className="ib-login-brand-mark">I</div>
              <div>
                <div className="ib-login-brand-name">InterviewBot</div>
              </div>
            </div>

            <div className="ib-login-panel">
              <div className="ib-login-badge">AI-Powered Efficiency</div>
              <h1 className="ib-login-title">
                Streamline your hiring <span>workflow.</span>
              </h1>
              <p className="ib-login-copy">
                Experience the future of recruitment with structured screening, interview
                scheduling, AI-led sessions, and recruiter-grade reporting in one platform.
              </p>
              <div className="ib-login-proof">
                <div className="ib-login-avatars">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="small">Trusted by <strong>500+</strong> industry leaders</div>
              </div>
            </div>

            <div className="ib-login-footer small">
              <span>© 2024 InterviewBot AI. All rights reserved.</span>
              <span>Privacy</span>
              <span>Terms</span>
            </div>
          </section>

          <section className="ib-login-form-wrap">
            <div className="ib-login-form">
            <div>
                <h2 className="ib-login-heading">Welcome back</h2>
                <p className="ib-login-subheading">Please enter your details to access your dashboard</p>
              </div>

              <form onSubmit={handleSubmit} className="ib-auth-form">
                <div>
                  <label className="ib-login-label">Email Address</label>
                  <input
                    className="ib-login-input"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="ib-login-password-row">
                    <label className="ib-login-label">Password</label>
                    <button type="button" className="ib-login-link" disabled>
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    className="ib-login-input"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <label className="ib-login-remember">
                  <input type="checkbox" disabled />
                  <span>Keep me logged in for 30 days</span>
                </label>

                <button disabled={loading} className="btn ib-login-submit w-100">
                  {loading ? 'Signing in...' : 'Sign In to Dashboard'}
                </button>
              </form>

              <div className="text-center ib-auth-footer">
                Don't have an account?{' '}
                <Link to="/signup" className="ib-login-signup">
                  Create an account
                </Link>
              </div>

              <div className="ib-login-security">
                <span className="ib-login-security-icon">✓</span>
                <span>Enterprise-grade security & GDPR compliant</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default Login;

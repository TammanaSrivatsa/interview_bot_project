import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { AxiosError } from 'axios';
import api from '../lib/api';

function Signup() {
  const [role, setRole] = useState('candidate');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('role', role);
    formData.append('name', name);
    formData.append('email', email);
    formData.append('password', password);
    formData.append('gender', gender);

    try {
      const response = await api.post('/signup', formData);
      if (response.data.success) {
        navigate('/');
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      alert(axiosError.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="ib-login-shell ib-signup-shell">
        <div className="ib-login-bg" />
        <div className="ib-login-grid">
          <section className="ib-signup-hero">
            <div className="ib-login-overlay" />
            <div className="ib-login-brand">
              <div className="ib-login-brand-mark ib-signup-brand-mark">I</div>
              <div>
                <div className="ib-login-brand-name">InterviewBot Live</div>
              </div>
            </div>

            <div className="ib-signup-copy-wrap">
              <h1 className="ib-signup-title">
                Elevate your hiring <span>experience.</span>
              </h1>
              <p className="ib-signup-copy">
                Join 500+ companies using AI-driven live interviews to find their next
                superstar candidates.
              </p>
            </div>

            <div className="ib-signup-quote">
              <div className="ib-signup-stars">★★★★★</div>
              <p>
                "The platform transformed our recruitment process. The interface is incredibly
                intuitive for both HR and candidates."
              </p>
              <div className="ib-signup-author">
                <span className="ib-signup-avatar">JD</span>
                <div>
                  <strong>Jane Doe</strong>
                  <div>Talent Acquisition, TechCorp</div>
                </div>
              </div>
            </div>
          </section>

          <section className="ib-login-form-wrap">
            <div className="ib-login-form">
              <div>
                <h2 className="ib-login-heading ib-signup-heading">Create your account</h2>
                <p className="ib-login-subheading">Join the future of professional interviewing</p>
              </div>

              <form onSubmit={handleSubmit} className="ib-auth-form">
                <div>
                  <label className="ib-login-label">Select your role</label>
                  <div className="ib-signup-role-switch">
                    <button
                      type="button"
                      className={`ib-signup-role-btn ${role === 'candidate' ? 'active' : ''}`}
                      onClick={() => setRole('candidate')}
                    >
                      Candidate
                    </button>
                    <button
                      type="button"
                      className={`ib-signup-role-btn ${role === 'hr' ? 'active' : ''}`}
                      onClick={() => setRole('hr')}
                    >
                      HR Manager
                    </button>
                  </div>
                </div>

                <div>
                  <label className="ib-login-label">{role === 'hr' ? 'Company Name' : 'Full Name'}</label>
                  <input
                    className="ib-login-input"
                    placeholder={role === 'hr' ? 'Acme Inc.' : 'John Doe'}
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="ib-login-label">Email Address</label>
                  <input
                    type="email"
                    className="ib-login-input"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="ib-login-label">Password</label>
                  <input
                    type="password"
                    className="ib-login-input"
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {role === 'candidate' && (
                  <div>
                    <label className="ib-login-label">Gender (Optional)</label>
                    <select
                      className="ib-login-input ib-signup-select"
                      value={gender}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGender(e.target.value)}
                    >
                      <option value="">Select gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                )}

                <button disabled={loading} className="btn ib-login-submit w-100">
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </form>

              <div className="text-center ib-auth-footer">
                Already have an account?{' '}
                <Link to="/" className="ib-login-signup">
                  Log in
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default Signup;

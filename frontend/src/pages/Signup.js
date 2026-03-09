import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

function Signup() {
  const [role, setRole] = useState('candidate');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('role', role);
    formData.append('name', name);
    formData.append('email', email);
    formData.append('password', password);
    formData.append('gender', gender);

    try {
      const response = await axios.post('/signup', formData);
      if (response.data.success) {
        navigate('/');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Signup failed');
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
            <div className="ib-kicker">Account Setup</div>
            <h2 className="ib-title">Create your role in the interview workflow</h2>
            <p className="ib-subtitle mb-0">
              HR accounts create and evaluate positions. Candidate accounts apply and complete the
              timed interview process.
            </p>
          </section>

          <section className="ib-card ib-p-28">
            <h4 className="mb-3">Create Account</h4>
            <form onSubmit={handleSubmit}>
              <label className="ib-label">Role</label>
              <select
                className="form-select mb-3"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="candidate">Candidate</option>
                <option value="hr">HR / Recruiter</option>
              </select>

              <label className="ib-label">{role === 'hr' ? 'Company Name' : 'Full Name'}</label>
              <input
                className="form-control mb-3"
                placeholder={role === 'hr' ? 'Company Name' : 'Candidate Name'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <label className="ib-label">Email</label>
              <input
                type="email"
                className="form-control mb-3"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <label className="ib-label">Password</label>
              <input
                type="password"
                className="form-control mb-3"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {role === 'candidate' && (
                <>
                  <label className="ib-label">Gender (optional)</label>
                  <input
                    className="form-control mb-3"
                    placeholder="Male / Female / Prefer not to say"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  />
                </>
              )}

              <button disabled={loading} className="btn ib-btn-brand btn-primary w-100 mt-2">
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="text-center mt-3">
              <small>
                Already have an account?{' '}
                <Link to="/" className="text-decoration-none">
                  Login
                </Link>
              </small>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default Signup;

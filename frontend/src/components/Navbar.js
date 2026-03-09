import React from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function Navbar({ showLogout = false }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await axios.get('/logout');
    navigate('/');
  };

  return (
    <nav className="navbar navbar-expand-lg px-4" style={{ background: '#0f172a' }}>
      <span className="navbar-brand mb-0 h1 fw-bold text-white">
        InterviewBot Live
      </span>
      {showLogout && (
        <div className="ms-auto">
          <button onClick={handleLogout} className="btn btn-outline-light btn-sm">
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}

export default Navbar;

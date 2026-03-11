import React from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

type NavbarProps = {
  showLogout?: boolean;
};

function Navbar({ showLogout = false }: NavbarProps) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.get('/logout');
    navigate('/');
  };

  return (
    <nav className="ib-nav navbar navbar-expand-lg">
      <div className="ib-nav-brand">
        <span className="ib-nav-mark">I</span>
        <div className="ib-nav-copy">
          <span className="navbar-brand ib-nav-title">InterviewBot Live</span>
          <span className="ib-nav-subtitle">AI screening, guided interviews, recruiter review</span>
        </div>
      </div>

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

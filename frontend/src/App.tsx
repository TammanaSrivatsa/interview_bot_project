import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import DashboardCandidate from './pages/DashboardCandidate';
import DashboardHR from './pages/DashboardHR';
import InterviewSetup from './pages/InterviewSetup';
import InterviewSession from './pages/InterviewSession';
import CandidateReport from './pages/CandidateReport';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/candidate/dashboard" element={<DashboardCandidate />} />
        <Route path="/hr/dashboard" element={<DashboardHR />} />
        <Route path="/hr/report/:resultId" element={<CandidateReport />} />
        <Route path="/interview/:resultId" element={<InterviewSetup />} />
        <Route path="/interview-session/:resultId" element={<InterviewSession />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;

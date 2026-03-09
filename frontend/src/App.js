import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import DashboardCandidate from './pages/DashboardCandidate';
import DashboardHR from './pages/DashboardHR';
import InterviewSetup from "./pages/InterviewSetup";
import InterviewSession from './pages/InterviewSession';
import axios from 'axios';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

// Configure axios to send cookies
axios.defaults.withCredentials = true;

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/candidate/dashboard" element={<DashboardCandidate />} />
        <Route path="/hr/dashboard" element={<DashboardHR />} />
        <Route path="/interview/:resultId" element={<InterviewSetup />} />
        <Route path="/interview-session/:resultId" element={<InterviewSession />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;

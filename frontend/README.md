# React Frontend Setup Guide

## Overview
This React frontend is a complete conversion of the HTML templates while maintaining 100% of the original logic, flow, and functionality.

## Features Preserved
✅ All authentication flows (Login/Signup)
✅ Candidate Dashboard with resume upload
✅ HR Dashboard with JD upload and candidate management
✅ Complete Interview system with:
  - Live countdown timer
  - Speech-to-text recognition
  - Text-to-speech questions
  - Camera integration
  - Silence detection
  - Auto question progression
  - Time-based interview completion

## Installation

### 1. Navigate to frontend directory
```bash
cd frontend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start React development server
```bash
npm start
```

The React app will run on `http://localhost:3000`

### 4. Keep FastAPI backend running
```bash
# In the root directory
uvicorn main:app --reload
```

The backend API runs on `http://localhost:8000`

## Project Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   └── Navbar.js          # Reusable navigation bar
│   ├── pages/
│   │   ├── Login.js           # Login page
│   │   ├── Signup.js          # Signup page
│   │   ├── DashboardCandidate.js  # Candidate dashboard
│   │   ├── DashboardHR.js     # HR dashboard
│   │   └── Interview.js       # Interview session
│   ├── App.js                 # Main app with routing
│   └── index.js               # Entry point
└── package.json
```

## Key Components

### Login.js
- Email/password authentication
- Redirects based on user role
- Form validation

### Signup.js
- Role selection (Candidate/HR)
- User registration
- Gender field for candidates

### DashboardCandidate.js
- Resume upload functionality
- AI evaluation results display
- Interview date selection
- Detailed score breakdown

### DashboardHR.js
- Job description upload
- AI skill extraction
- Skill scoring interface
- Shortlisted candidates table
- Detailed candidate evaluation view

### Interview.js
- **Complete interview logic preserved:**
  - Live countdown timer with color transitions
  - Camera and microphone access
  - Speech recognition for answers
  - Text-to-speech for questions
  - Silence detection (5 seconds)
  - Hard question timeout (15s for short interviews, 25s for longer)
  - Auto progression to next question
  - Interview completion on timeout
  - All state management and timers

## API Integration

The React app communicates with FastAPI backend using:
- `axios` for HTTP requests
- Form data for file uploads
- Session-based authentication
- Proxy configuration in package.json

## Browser Compatibility

Requires modern browser with support for:
- Web Speech API (Speech Recognition)
- Speech Synthesis API
- MediaDevices API (Camera/Microphone)
- ES6+ JavaScript features

## Development Notes

### State Management
- Uses React hooks (useState, useEffect, useRef)
- Refs for timers and recognition objects
- Proper cleanup in useEffect

### Styling
- Bootstrap 5.3.0 for UI components
- Inline styles for background colors
- Responsive design maintained

### Logic Preservation
All JavaScript logic from HTML templates has been converted to React:
- Timer intervals → useRef + setInterval
- Speech recognition → useRef for recognition object
- Silence detection → useRef for timeout
- Hard question timer → useRef for timeout
- All event handlers preserved
- All API calls maintained

## Production Build

```bash
npm run build
```

This creates an optimized production build in the `build/` directory.

## Troubleshooting

### CORS Issues
If you encounter CORS errors, ensure FastAPI has CORS middleware:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Speech Recognition Not Working
- Ensure HTTPS or localhost
- Grant microphone permissions
- Use Chrome/Edge (best support)

### Camera Not Showing
- Grant camera permissions
- Check if camera is in use by another app
- Verify HTTPS or localhost

## Comparison with HTML Version

| Feature | HTML | React | Status |
|---------|------|-------|--------|
| Login/Signup | ✅ | ✅ | Identical |
| Resume Upload | ✅ | ✅ | Identical |
| JD Upload | ✅ | ✅ | Identical |
| AI Matching | ✅ | ✅ | Identical |
| Interview Timer | ✅ | ✅ | Identical |
| Speech Recognition | ✅ | ✅ | Identical |
| TTS Questions | ✅ | ✅ | Identical |
| Silence Detection | ✅ | ✅ | Identical |
| Auto Progression | ✅ | ✅ | Identical |
| Camera Integration | ✅ | ✅ | Identical |

## Next Steps

1. Install dependencies: `npm install`
2. Start development server: `npm start`
3. Test all features
4. Build for production: `npm run build`
5. Deploy React build to hosting service

## Notes

- Backend remains unchanged (FastAPI)
- All API endpoints work as-is
- Session management handled by backend
- File uploads use FormData
- No breaking changes to existing functionality

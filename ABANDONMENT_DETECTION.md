# Interview Abandonment Detection Feature

## Overview
Automatically detects and flags when a candidate closes the interview tab, navigates away, or logs out before completing the interview.

## Changes Made

### 1. Database Schema (models.py)
- Added `interview_abandoned` BOOLEAN column to Result model (default: FALSE)

### 2. Backend API (routes/interview.py)
- New endpoint: `/mark-interview-abandoned`
  - Marks interview as abandoned
  - Records end time
  - Adds abandonment note to explanation

### 3. Frontend Detection (Interview.js)
- Added `beforeunload` event listener
- Detects when candidate:
  - Closes browser tab
  - Closes browser window
  - Navigates to different URL
  - Refreshes page during active interview
- Uses `navigator.sendBeacon()` for reliable notification even during page unload

### 4. HR Dashboard Display (DashboardHR.js)
- **In Candidate Table:**
  - Yellow "⚠️ ABANDONED" badge next to score
- **In Candidate Details:**
  - Red warning in Interview Timing section
  - Shows: "⚠️ Status: Interview Abandoned (Candidate closed tab/logged out)"

## How It Works

1. **Interview Starts** → `interviewStarted` flag set to true
2. **Candidate Closes Tab** → `beforeunload` event fires
3. **Check Conditions:**
   - Interview started? ✓
   - Time remaining? ✓
4. **Send Beacon** → POST to `/mark-interview-abandoned`
5. **Backend Updates:**
   - `interview_abandoned = TRUE`
   - `interview_end_time = current timestamp`
   - `explanation.abandonment_note = "Candidate closed interview tab..."`
6. **HR Sees:**
   - Yellow ABANDONED badge in table
   - Red warning in details section

## Display Examples

### Candidate List Table:
```
Name    Email           Score                           Interview Date
John    john@email.com  75% ⚠️ ABANDONED 🚨 3          2024-01-15
```

### Candidate Details:
```
⏰ Interview Timing
• Date: 2024-01-15
• Started At: 2024-01-15 14:30:25
• Ended At: 2024-01-15 14:35:10
• ⚠️ Status: Interview Abandoned (Candidate closed tab/logged out)
```

## Technical Notes

- Uses `navigator.sendBeacon()` for reliability (works even during page unload)
- Only triggers if interview has started and time remaining > 0
- Prevents false positives for completed interviews
- Works across all modern browsers

## Migration

Run the migration script:
```bash
python add_abandoned_flag.py
```

This adds the `interview_abandoned` column to existing database.

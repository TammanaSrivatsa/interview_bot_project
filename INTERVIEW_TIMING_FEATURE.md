# Interview Timing & Suspicious Activities Feature

## Changes Made

### 1. Database Schema (models.py)
- Added `interview_start_time` column to Result model
- Added `interview_end_time` column to Result model

### 2. Backend API (routes/interview.py)
- Saves interview start time when interview initializes
- Saves interview end time when interview completes or times out
- Format: "YYYY-MM-DD HH:MM:SS"

### 3. Backend API (routes/hr.py)
- Returns `interview_start_time` and `interview_end_time` in dashboard response
- HR can now see exact timing of each interview

### 4. Frontend (DashboardHR.js)
- Added "⏰ Interview Timing" section in candidate details
- Shows:
  - Interview Date
  - Started At (timestamp)
  - Ended At (timestamp)
- Renamed "Behavior Violations" to "🚨 Suspicious Activities & Behavior Violations"
- Displays all suspicious actions with severity badges

### 5. Migration Script (add_interview_timing.py)
- Run this to add new columns to existing database:
  ```bash
  python add_interview_timing.py
  ```

## How It Works

1. When candidate starts interview → `interview_start_time` saved
2. When interview ends (timeout or completion) → `interview_end_time` saved
3. HR opens candidate details → sees complete timing + suspicious activities
4. Suspicious activities include:
   - Looking away (up/down/left/right)
   - Poor eye contact
   - Head turning
   - Poor posture
   - Face not visible

## Display Format

```
⏰ Interview Timing
• Date: 2024-01-15
• Started At: 2024-01-15 14:30:25
• Ended At: 2024-01-15 14:50:25

🚨 Suspicious Activities & Behavior Violations
⚠️ HIGH Looking Away (Down) (15 times)
⚠️ MEDIUM Poor Eye Contact (5 times)
```

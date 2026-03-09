import cv2
import numpy as np

try:
    import mediapipe as mp

    MEDIAPIPE_AVAILABLE = True
except:
    MEDIAPIPE_AVAILABLE = False


class InterviewAnalyzer:
    def __init__(self):
        if not MEDIAPIPE_AVAILABLE:
            print("Warning: MediaPipe not available. Video analysis disabled.")
            return

        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def analyze_frame(self, frame):
        """Analyze single video frame for facial expressions and posture"""
        if not MEDIAPIPE_AVAILABLE:
            return {
                "face_detected": False,
                "eye_contact": 0,
                "smile_score": 0,
                "head_pose": "neutral",
                "posture_score": 0,
                "violations": [],
                "error": "MediaPipe not available",
            }

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Face analysis
        face_results = self.face_mesh.process(rgb_frame)

        # Pose analysis
        pose_results = self.pose.process(rgb_frame)

        analysis = {
            "face_detected": False,
            "eye_contact": 0,
            "smile_score": 0,
            "head_pose": "neutral",
            "posture_score": 0,
            "violations": [],  # Track bad behaviors
        }

        if face_results.multi_face_landmarks:
            analysis["face_detected"] = True
            landmarks = face_results.multi_face_landmarks[0].landmark

            # Eye contact (looking at camera)
            left_eye = landmarks[33]
            right_eye = landmarks[263]
            nose = landmarks[1]

            eye_y_avg = (left_eye.y + right_eye.y) / 2
            eye_contact_score = 1.0 - abs(nose.y - eye_y_avg) * 2
            analysis["eye_contact"] = max(0, min(1, eye_contact_score))

            # Smile detection
            mouth_left = landmarks[61]
            mouth_right = landmarks[291]
            mouth_top = landmarks[13]
            mouth_bottom = landmarks[14]

            mouth_width = abs(mouth_right.x - mouth_left.x)
            mouth_height = abs(mouth_bottom.y - mouth_top.y)
            smile_ratio = mouth_width / (mouth_height + 0.001)
            analysis["smile_score"] = min(1, smile_ratio / 3)

            # Head pose
            if nose.y < 0.4:
                analysis["head_pose"] = "looking_up"
                analysis["violations"].append("Looking away from camera (up)")
            elif nose.y > 0.6:
                analysis["head_pose"] = "looking_down"
                analysis["violations"].append("Looking away from camera (down)")
            elif nose.x < 0.35:
                analysis["head_pose"] = "looking_left"
                analysis["violations"].append("Head turned left - possible distraction")
            elif nose.x > 0.65:
                analysis["head_pose"] = "looking_right"
                analysis["violations"].append("Head turned right - possible distraction")
            
            # Poor eye contact detection
            if analysis["eye_contact"] < 0.3:
                analysis["violations"].append("Poor eye contact - not looking at camera")

        if pose_results.pose_landmarks:
            landmarks = pose_results.pose_landmarks.landmark

            # Posture analysis (shoulder alignment)
            left_shoulder = landmarks[11]
            right_shoulder = landmarks[12]

            shoulder_diff = abs(left_shoulder.y - right_shoulder.y)
            posture_score = 1.0 - (shoulder_diff * 5)
            analysis["posture_score"] = max(0, min(1, posture_score))

            # Bad posture detection
            if posture_score < 0.5:
                analysis["violations"].append("Poor posture - slouching or leaning")

        # No face detected - major violation
        if not analysis["face_detected"]:
            analysis["violations"].append("Face not visible - candidate left camera view")

        return analysis

    def get_overall_score(self, frame_analyses):
        """Calculate overall interview performance from frame analyses"""
        if not frame_analyses:
            return {"overall_score": 0, "violations": []}

        avg_eye_contact = np.mean([a["eye_contact"] for a in frame_analyses])
        avg_smile = np.mean([a["smile_score"] for a in frame_analyses])
        avg_posture = np.mean([a["posture_score"] for a in frame_analyses])

        overall = (avg_eye_contact * 0.4 + avg_smile * 0.3 + avg_posture * 0.3) * 100

        # Collect all violations
        all_violations = []
        violation_counts = {}

        for analysis in frame_analyses:
            for violation in analysis.get("violations", []):
                if violation not in violation_counts:
                    violation_counts[violation] = 0
                violation_counts[violation] += 1

        # Only report violations that occurred multiple times (threshold: 3+ times)
        for violation, count in violation_counts.items():
            if count >= 3:
                all_violations.append({
                    "violation": violation,
                    "count": count,
                    "severity": "high" if count > 10 else "medium",
                })

        return {
            "overall_score": round(overall, 2),
            "eye_contact": round(avg_eye_contact * 100, 2),
            "confidence": round(avg_smile * 100, 2),
            "posture": round(avg_posture * 100, 2),
            "violations": all_violations,
            "total_frames_analyzed": len(frame_analyses),
        }

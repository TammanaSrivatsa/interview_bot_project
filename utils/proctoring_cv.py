"""OpenCV-based frame analysis for interview proctoring."""

from __future__ import annotations

import time
from typing import Any

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover - runtime dependency fallback
    cv2 = None
    np = None

_CASCADE = None
if cv2 is not None:
    _CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

_LAST_FRAMES: dict[int, Any] = {}
_LAST_PERIODIC_SAVE: dict[int, float] = {}


def analyze_frame(session_id: int, raw_bytes: bytes) -> dict[str, object]:
    if cv2 is None or np is None or _CASCADE is None:
        return {
            "ok": True,
            "faces_count": 1,
            "motion_score": 0.0,
            "face_signature": None,
            "error": None,
            "opencv_enabled": False,
        }

    frame = _decode_frame(raw_bytes)
    if frame is None:
        return {
            "ok": False,
            "faces_count": 0,
            "motion_score": 0.0,
            "face_signature": None,
            "error": "Invalid frame payload",
            "opencv_enabled": True,
        }

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = _CASCADE.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(50, 50))
    faces_count = int(len(faces))
    face_signature = _face_signature(gray, faces[0]) if faces_count == 1 else None
    motion_score = _motion_score(session_id, gray)

    return {
        "ok": True,
        "faces_count": faces_count,
        "motion_score": float(motion_score),
        "face_signature": face_signature,
        "error": None,
        "opencv_enabled": True,
    }


def compare_signatures(signature_a: list[float], signature_b: list[float]) -> float | None:
    if np is None:
        return None
    if not signature_a or not signature_b:
        return None
    a = np.asarray(signature_a, dtype=np.float32)
    b = np.asarray(signature_b, dtype=np.float32)
    if a.shape != b.shape:
        return None
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-8:
        return None
    return float(np.dot(a, b) / denom)


def should_store_periodic(session_id: int, interval_seconds: int) -> bool:
    now_ts = time.time()
    last = _LAST_PERIODIC_SAVE.get(session_id, 0.0)
    if (now_ts - last) >= float(interval_seconds):
        _LAST_PERIODIC_SAVE[session_id] = now_ts
        return True
    return False


def _decode_frame(raw_bytes: bytes):
    if np is None or cv2 is None:
        return None
    if not raw_bytes:
        return None
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _motion_score(session_id: int, gray_frame: Any) -> float:
    if cv2 is None or np is None:
        return 0.0
    small = cv2.resize(gray_frame, (160, 90))
    previous = _LAST_FRAMES.get(session_id)
    _LAST_FRAMES[session_id] = small
    if previous is None:
        return 0.0
    diff = cv2.absdiff(previous, small)
    return float(np.mean(diff) / 255.0)


def _face_signature(gray_frame: Any, face_box: Any) -> list[float] | None:
    if cv2 is None or np is None:
        return None
    x, y, width, height = [int(v) for v in face_box]
    if width <= 0 or height <= 0:
        return None
    roi = gray_frame[y : y + height, x : x + width]
    if roi.size == 0:
        return None
    roi = cv2.resize(roi, (64, 64))
    hist = cv2.calcHist([roi], [0], None, [32], [0, 256])
    cv2.normalize(hist, hist)
    return [float(v) for v in hist.flatten()]

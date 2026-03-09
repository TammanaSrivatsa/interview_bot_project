import asyncio

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ai_engine.speech_to_text import transcribe_audio_bytes
from database import SessionLocal

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Lazy load analyzers to avoid startup errors
video_analyzer = None


def get_video_analyzer():
    global video_analyzer
    if video_analyzer is None:
        from ai_engine.video_analyzer import InterviewAnalyzer

        video_analyzer = InterviewAnalyzer()
    return video_analyzer


@router.post("/analyze-video-frame")
async def analyze_video_frame(
    frame: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Analyze single video frame for facial expressions and posture"""
    try:
        analyzer = get_video_analyzer()
        contents = await frame.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        analysis = analyzer.analyze_frame(img)

        return JSONResponse(analysis)
    except Exception as e:
        return JSONResponse({"error": str(e), "face_detected": False})


@router.post("/transcribe-audio")
async def transcribe_audio(
    audio: UploadFile = File(...),
    sequence_id: int = Form(None),
    context_hint: str = Form(""),
    db: Session = Depends(get_db),
):
    """Transcribe audio chunk quickly for live interview text updates."""
    try:
        contents = await audio.read()
        suffix = ".webm"
        if audio.filename and "." in audio.filename:
            suffix = "." + audio.filename.rsplit(".", 1)[-1]

        result = await asyncio.to_thread(
            transcribe_audio_bytes,
            contents,
            suffix,
            context_hint,
        )

        return JSONResponse({
            "success": True,
            "transcription": result.get("text", ""),
            "confidence": result.get("confidence", 0.5),
            "low_confidence": result.get("low_confidence", False),
            "sequence_id": sequence_id,
        })
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})


@router.post("/submit-interview-analysis")
async def submit_interview_analysis(
    result_id: int = Form(...),
    video_scores: str = Form(...),
    db: Session = Depends(get_db),
):
    """Submit final interview analysis scores with violation detection"""
    import json

    from ai_engine.video_analyzer import InterviewAnalyzer
    from models import Result

    scores_data = json.loads(video_scores)
    analyses = scores_data.get("analyses", [])

    # Calculate overall scores and violations
    analyzer = InterviewAnalyzer()
    overall_analysis = analyzer.get_overall_score(analyses)

    result = db.query(Result).filter(Result.id == result_id).first()
    if result:
        if not result.explanation:
            result.explanation = {}

        result.explanation["video_analysis"] = overall_analysis
        result.explanation["behavior_violations"] = overall_analysis.get("violations", [])
        db.commit()

    return JSONResponse(
        {
            "success": True,
            "message": "Analysis saved",
            "violations": len(overall_analysis.get("violations", [])),
        }
    )

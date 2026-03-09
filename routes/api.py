from database import SessionLocal
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from models import Candidate, Result
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/candidate/dashboard")
def get_candidate_dashboard(db: Session = Depends(get_db)):
    # Return JSON data for candidate dashboard
    pass


@router.get("/hr/dashboard")
def get_hr_dashboard(db: Session = Depends(get_db)):
    # Return JSON data for HR dashboard
    pass


@router.get("/interview/{result_id}")
def get_interview_data(result_id: int, db: Session = Depends(get_db)):
    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Interview not found")

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()

    return JSONResponse({
        "candidate_name": candidate.name,
        "interview_duration": result.interview_duration or 2,
        "result_id": result.id,
    })

"""Health and authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import hash_password, password_needs_upgrade, verify_password
from database import get_db
from models import Candidate, HR
from routes.common import get_candidate_or_404, get_hr_or_404
from routes.dependencies import SessionUser, get_current_user
from routes.schemas import LoginBody, SignupBody

router = APIRouter()


@router.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "status": "healthy"}


@router.post("/auth/signup")
def signup(payload: SignupBody, db: Session = Depends(get_db)) -> dict[str, object]:
    role = payload.role.strip().lower()
    if role not in {"candidate", "hr"}:
        raise HTTPException(status_code=400, detail="Role must be candidate or hr")

    existing = db.query(Candidate).filter(Candidate.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    existing_hr = db.query(HR).filter(HR.email == payload.email).first()
    if existing_hr:
        raise HTTPException(status_code=400, detail="Email already registered")

    if role == "candidate":
        user = Candidate(
            name=payload.name,
            email=payload.email,
            password=hash_password(payload.password),
            gender=payload.gender,
        )
    else:
        user = HR(
            company_name=payload.name,
            email=payload.email,
            password=hash_password(payload.password),
        )

    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    db.refresh(user)
    return {"ok": True, "id": user.id, "role": role}


@router.post("/auth/login")
def login(
    payload: LoginBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = db.query(Candidate).filter(Candidate.email == payload.email).first()
    if candidate and verify_password(payload.password, candidate.password):
        if password_needs_upgrade(candidate.password):
            candidate.password = hash_password(payload.password)
            db.commit()
        request.session["user_id"] = candidate.id
        request.session["role"] = "candidate"
        return {"ok": True, "role": "candidate", "user_id": candidate.id}

    hr_user = db.query(HR).filter(HR.email == payload.email).first()
    if hr_user and verify_password(payload.password, hr_user.password):
        if password_needs_upgrade(hr_user.password):
            hr_user.password = hash_password(payload.password)
            db.commit()
        request.session["user_id"] = hr_user.id
        request.session["role"] = "hr"
        return {"ok": True, "role": "hr", "user_id": hr_user.id}

    raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/auth/logout")
def logout(request: Request) -> dict[str, object]:
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me")
def me(
    current_user: SessionUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if current_user.role == "candidate":
        candidate = get_candidate_or_404(db, current_user.user_id)
        return {
            "ok": True,
            "user_id": candidate.id,
            "role": "candidate",
            "name": candidate.name,
            "email": candidate.email,
        }
    hr_user = get_hr_or_404(db, current_user.user_id)
    return {
        "ok": True,
        "user_id": hr_user.id,
        "role": "hr",
        "name": hr_user.company_name,
        "email": hr_user.email,
    }

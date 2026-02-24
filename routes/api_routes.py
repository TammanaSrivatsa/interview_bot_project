"""Aggregate API router mounted by main.py."""

from fastapi import APIRouter

from routes.auth_routes import router as auth_router
from routes.candidate_routes import router as candidate_router
from routes.hr_routes import router as hr_router
from routes.interview_routes import router as interview_router

api_router = APIRouter(prefix="/api", tags=["api"])
api_router.include_router(auth_router)
api_router.include_router(candidate_router)
api_router.include_router(hr_router)
api_router.include_router(interview_router)

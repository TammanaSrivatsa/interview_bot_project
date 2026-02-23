"""Pydantic schemas used for request body validation."""

from pydantic import BaseModel, EmailStr

class CandidateSignup(BaseModel):
    """Signup payload for candidate accounts."""
    name: str
    email: EmailStr
    password: str
    gender: str

class HRSignup(BaseModel):
    """Signup payload for HR accounts."""
    company_name: str
    email: EmailStr
    password: str

class LoginSchema(BaseModel):
    """Login payload for email/password authentication."""
    email: EmailStr
    password: str

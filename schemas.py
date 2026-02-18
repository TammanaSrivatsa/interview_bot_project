from pydantic import BaseModel, EmailStr

class CandidateSignup(BaseModel):
    name: str
    email: EmailStr
    password: str
    gender: str

class HRSignup(BaseModel):
    company_name: str
    email: EmailStr
    password: str

class LoginSchema(BaseModel):
    email: EmailStr
    password: str
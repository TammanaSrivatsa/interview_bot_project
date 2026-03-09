import os

from auth import verify_password, hash_password
from database import SessionLocal, engine
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from models import Base, Candidate, HR
from routes import candidate, hr, interview, analysis
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware


# --------------------------------------------------
# Load Environment Variables
# --------------------------------------------------
load_dotenv()


# --------------------------------------------------
# App Initialization
# --------------------------------------------------
app = FastAPI(docs_url=None, redoc_url=None)


# --------------------------------------------------
# CORS Middleware (React Frontend)
# --------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Session Middleware
# --------------------------------------------------
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", "supersecretkey"),
    same_site="lax",
    https_only=False,
)


# --------------------------------------------------
# Ensure Upload Folder Exists
# --------------------------------------------------
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# --------------------------------------------------
# Static Files (Resumes / JD Files)
# --------------------------------------------------
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# --------------------------------------------------
# Database Setup
# --------------------------------------------------
Base.metadata.create_all(bind=engine)


# --------------------------------------------------
# DB Dependency
# --------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------
# API Home
# --------------------------------------------------
@app.get("/")
def home():
    return {
        "message": "AI Interview Platform API running",
        "frontend": "http://localhost:3000",
    }


# --------------------------------------------------
# Login
# --------------------------------------------------
@app.post("/login")
def login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):

    user = db.query(Candidate).filter(Candidate.email == email).first()
    role = "candidate"

    if not user:
        user = db.query(HR).filter(HR.email == email).first()
        role = "hr"

    if not user or not verify_password(password, user.password):

        return JSONResponse(
            status_code=401,
            content={"error": "Invalid credentials"},
        )

    # Save session
    request.session["user_id"] = user.id
    request.session["role"] = role

    return JSONResponse({
        "success": True,
        "role": role,
        "redirect": f"/{role}/dashboard",
    })


# --------------------------------------------------
# Signup
# --------------------------------------------------
@app.post("/signup")
def signup(
    role: str = Form(...),
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    gender: str = Form(None),
    db: Session = Depends(get_db),
):

    # Prevent duplicate accounts
    existing_candidate = db.query(Candidate).filter(Candidate.email == email).first()
    existing_hr = db.query(HR).filter(HR.email == email).first()

    if existing_candidate or existing_hr:
        return JSONResponse(
            status_code=400,
            content={"error": "Email already registered"},
        )

    if role == "candidate":

        user = Candidate(
            name=name,
            email=email,
            password=hash_password(password),
            gender=gender,
        )

    else:

        user = HR(
            company_name=name,
            email=email,
            password=hash_password(password),
        )

    db.add(user)
    db.commit()

    return JSONResponse({
        "success": True,
        "message": "Account created successfully",
    })


# --------------------------------------------------
# Logout
# --------------------------------------------------
@app.get("/logout")
def logout(request: Request):

    request.session.clear()

    return JSONResponse({
        "success": True,
        "message": "Logged out successfully",
    })


# --------------------------------------------------
# Include Routers
# --------------------------------------------------
app.include_router(candidate.router)
app.include_router(hr.router)
app.include_router(interview.router)
app.include_router(analysis.router)

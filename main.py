from fastapi import FastAPI, Request, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv
import os

from database import engine, SessionLocal
from models import Base, Candidate, HR
from auth import verify_password
from routes import candidate, hr, interview   # ✅ Added interview router


# --------------------------------------------------
# Load environment variables
# --------------------------------------------------
load_dotenv()


# --------------------------------------------------
# App Initialization
# --------------------------------------------------
app = FastAPI(docs_url=None, redoc_url=None)


# --------------------------------------------------
# Static Files (Uploads)
# --------------------------------------------------
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# --------------------------------------------------
# Session Middleware
# --------------------------------------------------
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", "supersecretkey")  # fallback safe
)


templates = Jinja2Templates(directory="templates")


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
# Home (Login Page)
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        "login.html",
        {"request": request}
    )


# --------------------------------------------------
# Login
# --------------------------------------------------
@app.post("/login")
def login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    user = db.query(Candidate).filter(Candidate.email == email).first()
    role = "candidate"

    if not user:
        user = db.query(HR).filter(HR.email == email).first()
        role = "hr"

    if not user or not verify_password(password, user.password):
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": "Invalid credentials"
            }
        )

    # Store session
    request.session["user_id"] = user.id
    request.session["role"] = role

    # Redirect based on role
    if role == "candidate":
        return RedirectResponse("/candidate/dashboard", status_code=303)
    else:
        return RedirectResponse("/hr/dashboard", status_code=303)


# --------------------------------------------------
# Signup Page
# --------------------------------------------------
@app.get("/signup", response_class=HTMLResponse)
def signup_page(request: Request):
    return templates.TemplateResponse(
        "signup.html",
        {"request": request}
    )


# --------------------------------------------------
# Signup Submission
# --------------------------------------------------
@app.post("/signup")
def signup(
    request: Request,
    role: str = Form(...),
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    gender: str = Form(None),
    db: Session = Depends(get_db)
):
    from auth import hash_password

    if role == "candidate":
        user = Candidate(
            name=name,
            email=email,
            password=hash_password(password),
            gender=gender
        )
    else:
        user = HR(
            company_name=name,
            email=email,
            password=hash_password(password)
        )

    db.add(user)
    db.commit()

    return RedirectResponse("/", status_code=303)


# --------------------------------------------------
# Logout
# --------------------------------------------------
@app.get("/logout")
def logout(request: Request):
    request.session.clear()  # 🔥 Clear entire session
    return RedirectResponse("/", status_code=303)


# --------------------------------------------------
# Include Routers
# --------------------------------------------------
app.include_router(candidate.router)
app.include_router(hr.router)
app.include_router(interview.router)   # ✅ NEW
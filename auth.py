"""Authentication helpers for password hashing and JWT token creation."""

from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import PasswordValueError, UnknownHashError
import os
from dotenv import load_dotenv

# ---------------------------
# Auth Config
# ---------------------------
load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set in environment.")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# Use bcrypt_sha256 to avoid bcrypt's 72-byte password limit while keeping
# compatibility with older bcrypt hashes if they already exist in DB.
pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")

# ---------------------------
# Password + Token Helpers
# ---------------------------
def hash_password(password: str):
    """Hash a plain-text password before storing in DB."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, stored_password: str | None) -> bool:
    """Validate login password against stored hash.

    Legacy fallback:
    If an existing row contains non-hash/plain-text password data, avoid a 500
    and allow equality match so login can continue and be rehashed.
    """
    if not stored_password:
        return False
    try:
        return pwd_context.verify(plain_password, stored_password)
    except (UnknownHashError, PasswordValueError, TypeError, ValueError):
        return plain_password == stored_password


def password_needs_upgrade(stored_password: str | None) -> bool:
    """Return True when password should be re-hashed with current policy."""
    if not stored_password:
        return True
    try:
        scheme = pwd_context.identify(stored_password)
        if not scheme:
            return True
        return bool(pwd_context.needs_update(stored_password))
    except (UnknownHashError, PasswordValueError, TypeError, ValueError):
        return True

def create_access_token(data: dict):
    """Create signed JWT with expiry based on env configuration."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

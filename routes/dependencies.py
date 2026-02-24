"""Reusable auth/session dependencies for role-protected API routes."""

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request


@dataclass
class SessionUser:
    """Authenticated user details stored in session cookies."""

    user_id: int
    role: str


def get_current_user(request: Request) -> SessionUser:
    """Load logged-in user from session and reject anonymous requests."""

    user_id = request.session.get("user_id")
    role = request.session.get("role")
    if not user_id or not role:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return SessionUser(user_id=int(user_id), role=str(role))


def require_role(role: str):
    """Factory dependency to enforce role-based access on route handlers."""

    def _dependency(current_user: SessionUser = Depends(get_current_user)) -> SessionUser:
        if current_user.role != role:
            raise HTTPException(status_code=403, detail=f"{role} access required")
        return current_user

    return _dependency

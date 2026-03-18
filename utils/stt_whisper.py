"""
utils/stt_whisper.py

Replaces faster-whisper with Groq Whisper API.
Drop-in replacement — same function signature as before.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from groq import Groq

logger = logging.getLogger(__name__)

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set in .env")
        _client = Groq(api_key=api_key)
    return _client


def _whisper_model() -> str:
    return os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")


def _resolve_suffix(filename: str | None) -> str:
    if filename:
        s = Path(filename).suffix.strip().lower()
        if s in {".webm", ".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".oga"}:
            return s
    return ".webm"


def _mime(suffix: str) -> str:
    return {
        ".webm": "audio/webm",
        ".wav":  "audio/wav",
        ".mp3":  "audio/mpeg",
        ".m4a":  "audio/mp4",
        ".mp4":  "audio/mp4",
        ".ogg":  "audio/ogg",
        ".oga":  "audio/ogg",
    }.get(suffix, "audio/webm")


def transcribe_audio_bytes(
    audio_bytes: bytes,
    language: str | None = None,
    *,
    filename: str | None = None,
    context_hint: str | None = None,
) -> dict[str, object]:
    """
    Transcribe audio bytes using Groq Whisper API.
    Returns same shape as the old faster-whisper version:
      { text, confidence, low_confidence, language }
    """
    if not audio_bytes:
        return {
            "text": "",
            "confidence": 0.0,
            "low_confidence": True,
            "language": language or "en",
        }

    suffix = _resolve_suffix(filename)

    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)

    try:
        client = _get_client()
        with open(tmp_path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model=_whisper_model(),
                file=(tmp_path.name, f, _mime(suffix)),
                language=(language or "en").split("-")[0],
                prompt=(context_hint or "").strip() or None,
                response_format="json",
            )

        text = (getattr(transcription, "text", "") or "").strip()
        return {
            "text": text,
            "confidence": 0.92 if text else 0.0,
            "low_confidence": not bool(text),
            "language": language or "en",
        }

    except Exception as exc:
        logger.error("Groq Whisper transcription failed: %s", exc)
        raise RuntimeError(f"Transcription failed: {exc}") from exc

    finally:
        tmp_path.unlink(missing_ok=True)

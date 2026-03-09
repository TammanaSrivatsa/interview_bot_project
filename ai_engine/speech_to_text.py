import os
import tempfile
from typing import Any

from faster_whisper import WhisperModel

# Higher default for interview realism; can be overridden in .env.
MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small.en")
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")


def _collect_text(segments) -> str:
    text_parts = []
    for segment in segments:
        if segment and segment.text:
            text_parts.append(segment.text.strip())
    return " ".join([p for p in text_parts if p]).strip()


def _estimate_confidence(segments) -> float:
    # avg_logprob typically around [-2.0, 0.0]. We map this to [0, 1].
    logprobs = []
    for segment in segments:
        if segment is not None and getattr(segment, "avg_logprob", None) is not None:
            logprobs.append(float(segment.avg_logprob))
    if not logprobs:
        return 0.5

    avg_lp = sum(logprobs) / len(logprobs)
    confidence = (avg_lp + 2.0) / 2.0
    return max(0.0, min(1.0, confidence))


def transcribe_audio(file_path: str, context_hint: str = "") -> dict[str, Any]:
    contextual_prompt = (
        "Interview response. Candidate discussing project work, role ownership, "
        "technical skills, architecture, implementation details, debugging approach, "
        "system design, APIs, databases, deployment, tradeoffs, and outcomes. "
    )
    if context_hint:
        contextual_prompt += f"Current question context: {context_hint[:280]}."

    segments_iter, _ = model.transcribe(
        file_path,
        beam_size=3,
        best_of=3,
        condition_on_previous_text=False,
        language="en",
        initial_prompt=contextual_prompt,
        vad_filter=True,
    )
    segments = list(segments_iter)
    text = _collect_text(segments)
    confidence = _estimate_confidence(segments)

    return {
        "text": text,
        "confidence": round(confidence, 3),
        "low_confidence": confidence < 0.55,
    }


def transcribe_audio_bytes(
    audio_bytes: bytes,
    suffix: str = ".webm",
    context_hint: str = "",
) -> dict[str, Any]:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        return transcribe_audio(temp_path, context_hint=context_hint)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

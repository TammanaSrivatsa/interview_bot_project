try:
    import whisper

    WHISPER_AVAILABLE = True
except:
    WHISPER_AVAILABLE = False

class WhisperTranscriber:
    def __init__(self, model_size="base"):
        """Initialize Whisper model (base, small, medium, large)"""
        if not WHISPER_AVAILABLE:
            print("Warning: Whisper not available. Audio transcription disabled.")
            self.model = None
            return
        self.model = whisper.load_model(model_size)
    
    def transcribe_audio(self, audio_file_path):
        """Transcribe audio file to text"""
        if not WHISPER_AVAILABLE or self.model is None:
            return {
                "text": "Whisper not available",
                "language": "en",
                "segments": [],
            }
        result = self.model.transcribe(audio_file_path)
        return {
            "text": result["text"],
            "language": result["language"],
            "segments": result["segments"],
        }

    def transcribe_audio_bytes(self, audio_bytes):
        """Transcribe audio from bytes"""
        # Save temporarily
        temp_path = "temp_audio.wav"
        with open(temp_path, "wb") as f:
            f.write(audio_bytes)

        result = self.transcribe_audio(temp_path)

        # Clean up
        import os

        os.remove(temp_path)

        return result

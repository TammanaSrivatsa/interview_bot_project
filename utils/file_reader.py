import PyPDF2
import pdfplumber


def extract_text_from_pdf(file_path):
    text = ""

    # --------------------------------------------------
    # First try pdfplumber (better extraction)
    # --------------------------------------------------
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text

        if text.strip():
            return text

    except Exception as e:
        print("pdfplumber extraction failed:", e)

    # --------------------------------------------------
    # Fallback to PyPDF2
    # --------------------------------------------------
    try:
        with open(file_path, "rb") as file:
            reader = PyPDF2.PdfReader(file)

            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text

    except Exception as e:
        print("PyPDF2 extraction failed:", e)

    return text

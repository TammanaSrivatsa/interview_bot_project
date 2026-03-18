"""SMTP helper for sending interview schedule emails."""

import os
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587


def send_interview_email(to_email, candidate_name, interview_date, interview_link):
    """Send interview details to candidate using Gmail SMTP."""
    load_dotenv()
    email_address = os.getenv("EMAIL_ADDRESS")
    email_password = os.getenv("EMAIL_PASSWORD")
    if not email_address or not email_password:
        raise ValueError("EMAIL_ADDRESS / EMAIL_PASSWORD is missing in environment.")

    subject = "Interview Scheduled - AI Recruitment Platform"
    body = f"""
Hello {candidate_name},

Congratulations! You have been shortlisted.

Your Interview Details:

Date & Time: {interview_date}
Meeting Link: {interview_link}

Please join the meeting 5 minutes before the scheduled time.

Best Regards,
HR Team
"""

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = email_address
    msg["To"] = to_email

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(email_address, email_password)
        server.send_message(msg)

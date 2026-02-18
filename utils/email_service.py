import smtplib
from email.mime.text import MIMEText
import os

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")


def send_interview_email(to_email, candidate_name, interview_date, interview_link):

    subject = "Interview Scheduled - AI Recruitment Platform"

    body = f"""
Hello {candidate_name},

Congratulations 🎉 You have been shortlisted.

Your Interview Details:

Date & Time: {interview_date}
Meeting Link: {interview_link}

Please join the meeting 5 minutes before the scheduled time.

Best Regards,
HR Team
"""

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = EMAIL_ADDRESS
    msg["To"] = to_email

    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
    server.starttls()
    server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
    server.send_message(msg)
    server.quit()
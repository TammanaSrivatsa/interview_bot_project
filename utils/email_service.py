import smtplib
import os
from email.mime.text import MIMEText


SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")


def send_interview_email(to_email, candidate_name, interview_date, interview_link):
    if not EMAIL_ADDRESS or not EMAIL_PASSWORD:
        print("Email credentials not configured.")
        return

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

    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)

        server.send_message(msg)

        server.quit()

        print(f"Interview email sent to {to_email}")

    except Exception as e:
        print("Email sending failed:", e)

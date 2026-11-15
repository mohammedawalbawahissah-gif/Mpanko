"""Email over Resend's HTTPS API (port 443).

Railway blocks outbound SMTP (ports 25, 465, 587) on every plan below Pro, so sending through smtp.resend.com
times out there. The HTTPS API works on every plan and needs the same RESEND_API_KEY and verified domain.
"""
import base64

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

API_URL = "https://api.resend.com/emails"


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        sent = 0
        for msg in email_messages or []:
            if not msg.recipients():
                continue
            try:
                self._send(msg)
                sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return sent

    def _send(self, msg):
        payload = {
            "from": msg.from_email or settings.DEFAULT_FROM_EMAIL,
            "to": list(msg.to),
            "subject": msg.subject,
        }
        if msg.cc:
            payload["cc"] = list(msg.cc)
        if msg.bcc:
            payload["bcc"] = list(msg.bcc)
        if msg.reply_to:
            payload["reply_to"] = list(msg.reply_to)
        html = next((c for c, mime in getattr(msg, "alternatives", []) if mime == "text/html"), None)
        if msg.content_subtype == "html":
            payload["html"] = msg.body
        else:
            payload["text"] = msg.body
            if html:
                payload["html"] = html
        attachments = []
        for att in msg.attachments:
            if isinstance(att, tuple) and len(att) == 3:
                name, content, _mime = att
                raw = content.encode() if isinstance(content, str) else content
                attachments.append({"filename": name, "content": base64.b64encode(raw).decode()})
        if attachments:
            payload["attachments"] = attachments
        resp = requests.post(
            API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            timeout=getattr(settings, "EMAIL_TIMEOUT", 15),
        )
        if not resp.ok:
            try:
                detail = resp.json().get("message") or resp.text
            except ValueError:
                detail = resp.text
            raise RuntimeError(f"Resend said {resp.status_code}: {str(detail)[:300]}")

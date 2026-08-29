"""Transactional + admin digest email — sent via Resend (HTTP API), falling
back to raw SMTP if RESEND_API_KEY is not set.

Required env vars — Resend (preferred):
  RESEND_API_KEY    — Resend API key
  RESEND_FROM_EMAIL — verified sender, e.g. "CRRNT <noreply@yourdomain.com>"
                       (defaults to Resend's sandbox sender if unset — only
                       deliverable to the address on your Resend account)

Required env vars — SMTP (fallback):
  SMTP_HOST  — e.g. smtp.gmail.com
  SMTP_PORT  — 587 (STARTTLS, default) or 465 (SSL)
  SMTP_USER  — sender address / login
  SMTP_PASS  — SMTP password or app-specific password

Recipients for the admin digest are stored in the app_settings table under
the key "admin_emails" and managed via the admin portal Settings page.
"""
from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx

from services import app_settings

log = logging.getLogger("crrnt.email")

RESEND_API_URL = "https://api.resend.com/emails"
_DEFAULT_RESEND_FROM = "CRRNT <onboarding@resend.dev>"


def _smtp_config() -> tuple[str, int, str, str]:
    return (
        os.environ.get("SMTP_HOST", ""),
        int(os.environ.get("SMTP_PORT", "587")),
        os.environ.get("SMTP_USER", ""),
        os.environ.get("SMTP_PASS", ""),
    )


def _send_via_resend(to: list[str], subject: str, text: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return False

    from_addr = os.environ.get("RESEND_FROM_EMAIL", _DEFAULT_RESEND_FROM)
    try:
        resp = httpx.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"from": from_addr, "to": to, "subject": subject, "text": text, "html": html},
            timeout=15.0,
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        log.warning("Resend send failed (to=%s): %s", to, exc)
        return False


def _send_via_smtp(to: list[str], subject: str, text: str, html: str) -> bool:
    smtp_host, smtp_port, smtp_user, smtp_pass = _smtp_config()
    if not (smtp_host and smtp_user and smtp_pass):
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = ", ".join(to)
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, to, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.ehlo()
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, to, msg.as_string())
        return True
    except Exception as exc:
        log.warning("SMTP send failed (to=%s): %s", to, exc)
        return False


def send_email(to: str, subject: str, text: str, html: str) -> bool:
    """Send a single transactional email (password reset, etc). Returns True on success."""
    recipients = [to]
    if _send_via_resend(recipients, subject, text, html):
        return True
    if _send_via_smtp(recipients, subject, text, html):
        return True
    log.warning("send_email(%s) skipped — no email provider configured", to)
    return False


def send_password_reset(to: str, reset_url: str) -> bool:
    subject = "Reset your CRRNT password"
    text = (
        f"We received a request to reset your CRRNT password.\n\n"
        f"Reset it here: {reset_url}\n\n"
        f"This link expires in 1 hour. If you didn't request this, ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;max-width:480px;margin:0 auto;padding:32px 24px">
  <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Reset your password</h2>
  <p style="color:#94a3b8;font-size:14px;line-height:1.5">
    We received a request to reset your CRRNT password. This link expires in 1 hour.
  </p>
  <p style="margin:24px 0">
    <a href="{reset_url}" style="background:#f97316;color:#0f172a;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a>
  </p>
  <p style="color:#64748b;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
</body></html>"""
    return send_email(to, subject, text, html)


async def send_digest(stories: list[dict[str, Any]], cleanup: dict[str, int]) -> None:
    """Send the morning ingestion digest to all admin_emails recipients."""
    recipients = await app_settings.get_admin_emails()
    if not recipients:
        log.warning("Email digest skipped — no admin_emails configured in app_settings")
        return

    now = datetime.now(timezone.utc)
    subject = f"CRRNT Daily Digest — {now.strftime('%B')} {now.day}, {now.year}"
    text = _build_text(stories, cleanup, now)
    html = _build_html(stories, cleanup, now)

    log.info("Sending digest: subject=%r to=%s stories=%d", subject, recipients, len(stories))

    if _send_via_resend(recipients, subject, text, html):
        log.info("Digest email sent via Resend to %s (%d stories)", recipients, len(stories))
        return
    if _send_via_smtp(recipients, subject, text, html):
        log.info("Digest email sent via SMTP to %s (%d stories)", recipients, len(stories))
        return
    log.warning("Digest email skipped — no email provider configured")


def _build_text(stories: list[dict], cleanup: dict, now: datetime) -> str:
    lines = [
        f"CRRNT Daily Digest — {now.strftime('%B')} {now.day}, {now.year} {now.strftime('%H:%M')} UTC",
        "",
        f"Stories added: {len(stories)}",
    ]
    for s in stories:
        cat = (s.get("category") or "?").upper()
        lines.append(f"  [{cat}] {s.get('title') or 'Untitled'}")
    lines += [
        "",
        "Cleanup:",
        f"  Deleted:  {cleanup.get('deleted', 0)} expired stories",
        f"  Extended: {cleanup.get('extended', 0)} saved stories",
    ]
    return "\n".join(lines)


def _build_html(stories: list[dict], cleanup: dict, now: datetime) -> str:
    rows = ""
    for s in stories:
        cat = (s.get("category") or "?").capitalize()
        title = s.get("title") or "Untitled"
        rows += (
            f"<tr>"
            f"<td style='padding:6px 10px;color:#9ca3af;white-space:nowrap'>{cat}</td>"
            f"<td style='padding:6px 10px'>{title}</td>"
            f"</tr>"
        )

    deleted = cleanup.get("deleted", 0)
    extended = cleanup.get("extended", 0)
    timestamp = f"{now.strftime('%B')} {now.day}, {now.year} — {now.strftime('%H:%M')} UTC"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;max-width:640px;margin:0 auto;padding:32px 24px">
  <h2 style="margin:0 0 4px;color:#f1f5f9;font-size:20px">CRRNT Daily Digest</h2>
  <p style="margin:0 0 28px;color:#64748b;font-size:13px">{timestamp}</p>

  <h3 style="font-size:14px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:0 0 10px">
    Stories Added — {len(stories)}
  </h3>
  <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;margin-bottom:28px">
    <thead>
      <tr style="border-bottom:1px solid #334155">
        <th style="padding:8px 10px;text-align:left;color:#64748b;font-size:12px;font-weight:500">Category</th>
        <th style="padding:8px 10px;text-align:left;color:#64748b;font-size:12px;font-weight:500">Title</th>
      </tr>
    </thead>
    <tbody>{rows if rows else '<tr><td colspan="2" style="padding:16px 10px;color:#4b5563;text-align:center">No new stories</td></tr>'}</tbody>
  </table>

  <h3 style="font-size:14px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:0 0 10px">
    Cleanup
  </h3>
  <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden">
    <tr style="border-bottom:1px solid #334155">
      <td style="padding:10px;color:#94a3b8">Expired stories deleted</td>
      <td style="padding:10px;font-weight:600;color:#f87171">{deleted}</td>
    </tr>
    <tr>
      <td style="padding:10px;color:#94a3b8">Saved stories extended 30d</td>
      <td style="padding:10px;font-weight:600;color:#34d399">{extended}</td>
    </tr>
  </table>
</body>
</html>"""

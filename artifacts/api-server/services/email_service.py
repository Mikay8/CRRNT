"""Admin email digest — sent after the morning ingestion cron.

Required env vars (SMTP credentials only — recipients are managed in app_settings):
  SMTP_HOST  — e.g. smtp.gmail.com
  SMTP_PORT  — 587 (STARTTLS, default) or 465 (SSL)
  SMTP_USER  — sender address / login
  SMTP_PASS  — SMTP password or app-specific password

Recipients are stored in the app_settings table under the key "admin_emails"
and managed via the admin portal Settings page.
"""
from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from services import app_settings

log = logging.getLogger("crrnt.email")


def send_digest(stories: list[dict[str, Any]], cleanup: dict[str, int]) -> None:
    """Send the morning ingestion digest to all admin_emails recipients."""
    recipients = app_settings.get_admin_emails()
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")

    if not recipients:
        log.info("Email digest skipped — no admin_emails configured")
        return
    if not all([smtp_host, smtp_user, smtp_pass]):
        log.info("Email digest skipped — SMTP env vars not fully configured")
        return

    now = datetime.now(timezone.utc)
    subject = f"CRRNT Daily Digest — {now.strftime('%B')} {now.day}, {now.year}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(_build_text(stories, cleanup, now), "plain"))
    msg.attach(MIMEText(_build_html(stories, cleanup, now), "html"))

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, recipients, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.ehlo()
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, recipients, msg.as_string())
        log.info("Digest email sent to %s (%d stories)", recipients, len(stories))
    except Exception as exc:
        log.warning("Failed to send digest email: %s", exc)


def _build_text(stories: list[dict], cleanup: dict, now: datetime) -> str:
    lines = [
        f"CRRNT Daily Digest — {now.strftime('%B')} {now.day}, {now.year} {now.strftime('%H:%M')} UTC",
        "",
        f"Stories added: {len(stories)}",
    ]
    for s in stories:
        cat = (s.get("category") or "?").upper()
        tier = "PRO" if s.get("tier") == "paid" else "free"
        lines.append(f"  [{cat}] [{tier}] {s.get('title') or 'Untitled'}")
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
        tier = s.get("tier") or "free"
        tier_badge = (
            "<span style='background:#78350f;color:#fcd34d;padding:1px 6px;border-radius:4px;font-size:11px'>PRO</span>"
            if tier == "paid"
            else "<span style='color:#6b7280;font-size:11px'>free</span>"
        )
        rows += (
            f"<tr>"
            f"<td style='padding:6px 10px;color:#9ca3af;white-space:nowrap'>{cat}</td>"
            f"<td style='padding:6px 10px'>{title}</td>"
            f"<td style='padding:6px 10px;text-align:center'>{tier_badge}</td>"
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
        <th style="padding:8px 10px;text-align:center;color:#64748b;font-size:12px;font-weight:500">Tier</th>
      </tr>
    </thead>
    <tbody>{rows if rows else '<tr><td colspan="3" style="padding:16px 10px;color:#4b5563;text-align:center">No new stories</td></tr>'}</tbody>
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

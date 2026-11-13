"""Turns the plain-text email body staff edit into a branded HTML email. The text version is always sent too."""
import re
from html import escape

from django.conf import settings

TAGLINE = "Rooted in Africa. Made for the World."
URL = re.compile(r"(https?://[^\s<>\"]+)")


def _inline(line):
    out, last = [], 0
    for m in URL.finditer(line):
        out.append(escape(line[last:m.start()]))
        url = m.group(1).rstrip(".,)")
        out.append(f'<a href="{escape(url, quote=True)}" style="color:#2b3a8f">{escape(url)}</a>')
        last = m.start() + len(url)
    out.append(escape(line[last:]))
    return "".join(out)


def to_html(subject, body):
    blocks = []
    for para in re.split(r"\n{2,}", body.strip()):
        lines = [ln.rstrip() for ln in para.split("\n") if ln.strip()]
        if not lines:
            continue
        if len(lines) == 1 and URL.fullmatch(lines[0].strip()):
            url = lines[0].strip()
            blocks.append(
                f'<p style="margin:20px 0"><a href="{escape(url, quote=True)}" style="background:#2b3a8f;color:#ffffff;text-decoration:none;'
                f'padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block">Open</a></p>'
                f'<p style="font-size:12px;color:#666">If the button does not work, copy this link:<br>{_inline(url)}</p>'
            )
        else:
            blocks.append('<p style="margin:0 0 14px;line-height:1.5">' + "<br>".join(_inline(ln) for ln in lines) + "</p>")
    name = escape(getattr(settings, "STORE_LEGAL_NAME", "Mpanko"))
    return (
        '<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1c1f33">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden">'
        f'<tr><td style="background:#1c1f33;padding:18px 24px"><span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:-0.5px">Mpanko</span></td></tr>'
        f'<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 16px">{escape(subject)}</h1>{"".join(blocks)}</td></tr>'
        f'<tr><td style="padding:16px 24px;background:#f4f1ec;font-size:12px;color:#666">{escape(TAGLINE)}<br>{name}</td></tr>'
        "</table></td></tr></table></body></html>"
    )

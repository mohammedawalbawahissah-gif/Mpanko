from unittest import mock

import pytest
from django.core.mail import EmailMultiAlternatives, get_connection


def _conn():
    return get_connection("apps.notifications.resend_backend.ResendEmailBackend")


def test_posts_text_and_html_to_resend(settings):
    settings.RESEND_API_KEY = "re_test"
    msg = EmailMultiAlternatives("Hi", "plain", "Mpanko <shop@x.com>", ["a@b.com"])
    msg.attach_alternative("<p>html</p>", "text/html")
    with mock.patch("apps.notifications.resend_backend.requests.post") as post:
        post.return_value.ok = True
        assert _conn().send_messages([msg]) == 1
    args, kw = post.call_args
    assert args[0] == "https://api.resend.com/emails"
    assert kw["headers"]["Authorization"] == "Bearer re_test"
    assert kw["json"] == {"from": "Mpanko <shop@x.com>", "to": ["a@b.com"], "subject": "Hi", "text": "plain", "html": "<p>html</p>"}


def test_error_message_is_shown(settings):
    settings.RESEND_API_KEY = "re_test"
    msg = EmailMultiAlternatives("Hi", "plain", "x@y.com", ["a@b.com"])
    with mock.patch("apps.notifications.resend_backend.requests.post") as post:
        post.return_value.ok = False
        post.return_value.status_code = 403
        post.return_value.json.return_value = {"message": "The y.com domain is not verified."}
        with pytest.raises(RuntimeError, match="not verified"):
            _conn().send_messages([msg])
        assert _conn().__class__(fail_silently=True).send_messages([msg]) == 0

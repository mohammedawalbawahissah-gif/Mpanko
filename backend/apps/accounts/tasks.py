from celery import shared_task
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from apps.notifications.services import send_notification

from .models import User
from .tokens import email_verification_token


def _uid(user):
    return urlsafe_base64_encode(force_bytes(user.pk))


@shared_task
def send_verification_email(user_id):
    user = User.objects.filter(pk=user_id, email_verified=False).first()
    if not user:
        return
    link = f"{settings.FRONTEND_URL}/verify-email?uid={_uid(user)}&token={email_verification_token.make_token(user)}"
    send_notification("account_verification", user.email, {"link": link})


@shared_task
def send_password_reset_email(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if not user:
        return
    link = f"{settings.FRONTEND_URL}/reset-password?uid={_uid(user)}&token={default_token_generator.make_token(user)}"
    send_notification("password_reset", user.email, {"link": link})


@shared_task
def send_staff_invite(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if not user:
        return
    link = f"{settings.FRONTEND_URL}/reset-password?uid={_uid(user)}&token={default_token_generator.make_token(user)}"
    send_notification("staff_invite", user.email, {"role": user.get_role_display(), "link": link}, ref=f"invite:{user.pk}", dedupe=False)

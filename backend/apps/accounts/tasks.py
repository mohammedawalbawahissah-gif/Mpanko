from celery import shared_task
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

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
    send_mail(
        "Confirm your Mpanko email",
        f"Welcome to Mpanko — Rooted in Africa. Made for the World.\n\nConfirm your email address:\n{link}\n\n"
        "If you did not create this account you can ignore this message.",
        settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True,
    )


@shared_task
def send_password_reset_email(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if not user:
        return
    link = f"{settings.FRONTEND_URL}/reset-password?uid={_uid(user)}&token={default_token_generator.make_token(user)}"
    send_mail(
        "Reset your Mpanko password",
        f"We received a request to reset your password:\n{link}\n\n"
        "This link expires in 24 hours and works once. If you did not ask for this, ignore this email.",
        settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True,
    )

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send one test email to confirm the email service is set up. Usage: python manage.py check_email you@example.com"

    def add_arguments(self, parser):
        parser.add_argument("to")

    def handle(self, *args, to, **opts):
        backend = settings.EMAIL_BACKEND.rsplit(".", 2)[-2]
        self.stdout.write(f"Sending through: {backend} ({settings.EMAIL_HOST or 'no host'}) from {settings.DEFAULT_FROM_EMAIL}")
        try:
            send_mail("Mpanko email check", "If you can read this, Mpanko can send email.", settings.DEFAULT_FROM_EMAIL, [to])
        except Exception as exc:  # noqa: BLE001 — show any provider error plainly
            raise CommandError(f"Sending failed: {exc}")
        self.stdout.write(self.style.SUCCESS(f"Sent to {to}. Check the inbox (and spam)."))

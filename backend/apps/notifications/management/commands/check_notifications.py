from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.notifications import sms, whatsapp
from apps.notifications.models import DeviceToken, WebPushSubscription
from apps.notifications.push import send_push, send_web_push


class Command(BaseCommand):
    help = (
        "Send one real test message on each channel and show the provider's answer, so you know each one works before launch.\n"
        "  python manage.py check_notifications --phone +233240000000 --user buyer@example.com\n"
        "--phone tests SMS and WhatsApp. --user tests phone push and browser push for that customer (they must have signed in on a device)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--phone", help="A number with country code, for the SMS and WhatsApp tests")
        parser.add_argument("--user", help="A customer's email, for the push tests")

    def handle(self, *args, phone=None, user=None, **opts):
        if not phone and not user:
            raise CommandError("Give --phone and/or --user.")
        if phone:
            self._try(f"SMS ({settings.SMS_BACKEND})", lambda: sms.BACKENDS[settings.SMS_BACKEND](phone, "Mpanko test: if you can read this, SMS works."))
            self._try(f"WhatsApp ({settings.WHATSAPP_BACKEND})", lambda: whatsapp.BACKENDS[settings.WHATSAPP_BACKEND](phone, "Mpanko test: if you can read this, WhatsApp works."))
        if user:
            from apps.accounts.models import User

            u = User.objects.filter(email__iexact=user).first()
            if not u:
                raise CommandError(f"No customer with the email {user}.")
            n = DeviceToken.objects.filter(user=u).count()
            self._count("Phone push", n, lambda: send_push(u.pk, "Mpanko test", "If you can read this, push works.", {}))
            w = WebPushSubscription.objects.filter(user=u).count()
            if not settings.VAPID_PRIVATE_KEY:
                self.stdout.write(self.style.WARNING("Browser push: VAPID keys are not set (run generate_vapid_keys)."))
            else:
                self._count("Browser push", w, lambda: send_web_push(u.pk, "Mpanko test", "If you can read this, browser push works.", "/"))

    def _try(self, name, fn):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 — show any provider error plainly
            self.stdout.write(self.style.ERROR(f"{name}: FAILED. {exc}"))
        else:
            self.stdout.write(self.style.SUCCESS(f"{name}: accepted by the provider."))

    def _count(self, name, registered, fn):
        if not registered:
            self.stdout.write(self.style.WARNING(f"{name}: none registered. Sign in on a device and allow notifications first."))
            return
        sent = fn()
        style = self.style.SUCCESS if sent else self.style.ERROR
        self.stdout.write(style(f"{name}: {sent} of {registered} accepted."))

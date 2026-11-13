from django.core.management.base import BaseCommand

from apps.privacy.services import apply_retention


class Command(BaseCommand):
    help = "Remove data past its retention period (also runs daily through the scheduler)."

    def handle(self, *args, **options):
        for rule, n in apply_retention().items():
            self.stdout.write(f"{rule}: {n}")

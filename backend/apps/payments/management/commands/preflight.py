import json

from django.core.management.base import BaseCommand

from apps.payments.preflight import FAIL, PASS, SKIP, WARN, run_all

MARK = {PASS: "PASS", WARN: "WARN", FAIL: "FAIL", SKIP: "skip"}


class Command(BaseCommand):
    help = "Check that the live accounts and settings are ready for customers. Exit code 1 if anything must be fixed."

    def add_arguments(self, parser):
        parser.add_argument("--offline", action="store_true", help="Check settings only; make no network calls.")
        parser.add_argument("--json", action="store_true", help="Print the results as JSON.")

    def handle(self, *args, offline=False, json=False, **opts):  # noqa: A002
        import json as jsonlib

        results = run_all(offline=offline)
        failed = [r for r in results if r.level == FAIL]
        if json:
            self.stdout.write(jsonlib.dumps([r.__dict__ for r in results], indent=2))
        else:
            group = None
            for r in results:
                if r.group != group:
                    group = r.group
                    self.stdout.write(f"\n{group}")
                line = f"  {MARK[r.level]:4}  {r.name}" + (f" - {r.detail}" if r.detail else "")
                style = {PASS: self.style.SUCCESS, WARN: self.style.WARNING, FAIL: self.style.ERROR, SKIP: lambda s: s}[r.level]
                self.stdout.write(style(line))
                if r.level in (FAIL, WARN) and r.fix:
                    self.stdout.write(f"        Fix: {r.fix}")
            counts = {k: sum(1 for r in results if r.level == k) for k in (PASS, WARN, FAIL, SKIP)}
            self.stdout.write(f"\n{counts[PASS]} passed, {counts[WARN]} warnings, {counts[FAIL]} to fix, {counts[SKIP]} not configured.")
            if failed:
                self.stdout.write(self.style.ERROR("Not ready: fix the FAIL lines above, then run this again."))
            else:
                self.stdout.write(self.style.SUCCESS("No blockers found. Warnings are worth reading before launch."))
        if failed:
            raise SystemExit(1)

"""Scheduled re-check of pending MTN MoMo / Hubtel payments, and provider failure modes (fake HTTP only)."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.orders.models import Order, OrderStatus
from apps.payments import tasks
from apps.payments.models import AttemptStatus, PaymentAttempt
from apps.payments.providers import ProviderError, Verification

from .conftest import place_order

pytestmark = pytest.mark.django_db


@pytest.fixture
def attempt_factory(customer, address, product, settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock", "mtn_momo", "hubtel"]
    _, variant = product
    address.country, address.region = "GH", "Northern"
    address.save()
    made = []

    def make(provider="mtn_momo", age_minutes=10, key=None):
        _, r = place_order(customer, variant, address, currency="GHS", key=key or f"k{len(made)}")
        assert r.status_code == 201, r.content
        order = Order.objects.get(number=r.json()["number"])
        a = PaymentAttempt.objects.create(order=order, provider=provider, amount=order.grand_total, currency="GHS", idempotency_key=f"i{len(made)}")
        PaymentAttempt.objects.filter(pk=a.pk).update(created_at=timezone.now() - timedelta(minutes=age_minutes))
        made.append(a)
        a.refresh_from_db()
        return a

    return make


def fake_provider(monkeypatch, result):
    class P:
        def verify(self, attempt):
            if isinstance(result, Exception):
                raise result
            return result(attempt) if callable(result) else result

    monkeypatch.setattr(tasks, "get_provider", lambda name: P())


def test_a_missed_callback_is_recovered_by_the_poll(attempt_factory, monkeypatch):
    a = attempt_factory("mtn_momo")
    fake_provider(monkeypatch, lambda at: Verification("succeeded", at.amount, "GHS", "FT1"))
    assert tasks.reverify_pending_payments() == 1
    a.refresh_from_db()
    assert a.status == AttemptStatus.SUCCEEDED and a.order.status == OrderStatus.PAID
    assert a.status_events.filter(source="poll").exists()


def test_running_the_poll_twice_pays_once(attempt_factory, monkeypatch):
    a = attempt_factory("hubtel")
    fake_provider(monkeypatch, lambda at: Verification("succeeded", at.amount, "GHS", "T1"))
    assert tasks.reverify_pending_payments() == 1
    assert tasks.reverify_pending_payments() == 0
    assert a.status_events.filter(to_status="succeeded").count() == 1


def test_still_pending_stays_pending(attempt_factory, monkeypatch):
    a = attempt_factory("mtn_momo")
    fake_provider(monkeypatch, Verification("pending"))
    assert tasks.reverify_pending_payments() == 0
    a.refresh_from_db()
    assert a.status == AttemptStatus.PENDING


def test_failed_payment_is_recorded(attempt_factory, monkeypatch):
    a = attempt_factory("mtn_momo")
    fake_provider(monkeypatch, Verification("failed", a.amount, "GHS"))
    assert tasks.reverify_pending_payments() == 1
    a.refresh_from_db()
    assert a.status == AttemptStatus.FAILED


def test_wrong_amount_is_not_confirmed(attempt_factory, monkeypatch):
    a = attempt_factory("hubtel")
    fake_provider(monkeypatch, Verification("succeeded", Decimal("0.01"), "GHS", "T2"))
    tasks.reverify_pending_payments()
    a.refresh_from_db()
    assert a.status == AttemptStatus.MISMATCH and a.order.status != OrderStatus.PAID


def test_wrong_currency_is_not_confirmed(attempt_factory, monkeypatch):
    a = attempt_factory("mtn_momo")
    fake_provider(monkeypatch, lambda at: Verification("succeeded", at.amount, "USD", "T3"))
    tasks.reverify_pending_payments()
    a.refresh_from_db()
    assert a.status == AttemptStatus.MISMATCH


def test_provider_outage_is_survived_and_other_payments_still_checked(attempt_factory, monkeypatch):
    bad, good = attempt_factory("mtn_momo", 20), attempt_factory("hubtel", 10)
    calls = []

    class P:
        def verify(self, attempt):
            calls.append(attempt.reference)
            if attempt.pk == bad.pk:
                raise ProviderError("MTN MoMo is not reachable")
            return Verification("succeeded", attempt.amount, "GHS", "T4")

    monkeypatch.setattr(tasks, "get_provider", lambda name: P())
    assert tasks.reverify_pending_payments() == 1
    bad.refresh_from_db(), good.refresh_from_db()
    assert bad.status == AttemptStatus.PENDING and good.status == AttemptStatus.SUCCEEDED
    assert len(calls) == 2


def test_an_unexpected_crash_does_not_stop_the_run(attempt_factory, monkeypatch):
    attempt_factory("mtn_momo")
    fake_provider(monkeypatch, RuntimeError("boom"))
    assert tasks.reverify_pending_payments() == 0


def test_too_new_too_old_and_other_providers_are_left_alone(attempt_factory, monkeypatch):
    new = attempt_factory("mtn_momo", age_minutes=1)
    old = attempt_factory("hubtel", age_minutes=60 * 24 * 4)
    other = attempt_factory("mock", age_minutes=10)
    called = []
    monkeypatch.setattr(tasks, "get_provider", lambda n: called.append(n) or (_ for _ in ()).throw(AssertionError("should not be asked")))
    assert tasks.reverify_pending_payments() == 0
    assert not called
    for a in (new, old, other):
        a.refresh_from_db()
        assert a.status == AttemptStatus.PENDING


def test_payment_after_the_reservation_expired_is_recorded_not_dropped(attempt_factory, monkeypatch):
    a = attempt_factory("mtn_momo")
    Order.objects.filter(pk=a.order_id).update(expires_at=timezone.now() - timedelta(hours=1))
    from apps.orders.services import expire_unpaid_orders

    assert expire_unpaid_orders() >= 1
    fake_provider(monkeypatch, lambda at: Verification("succeeded", at.amount, "GHS", "T5"))
    tasks.reverify_pending_payments()
    a.refresh_from_db()
    assert a.status == AttemptStatus.SUCCEEDED  # late success is real money; it must not be dropped
    assert a.order.status == OrderStatus.EXPIRED  # but the order is not silently revived: finance reviews it
    assert tasks.reverify_pending_payments() == 0


def test_the_task_is_scheduled():
    from django.conf import settings

    entry = settings.CELERY_BEAT_SCHEDULE["reverify-pending-payments"]
    assert entry["task"] == "apps.payments.tasks.reverify_pending_payments_task" and entry["schedule"] <= 600

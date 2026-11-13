"""
Provider-neutral payment layer (FR-PAY-01). Checkout/order code never imports a specific gateway.
To add another gateway: subclass PaymentProvider, implement its methods, and register it in _registry() below.
Stripe, PayPal and Flutterwave live in providers_extra.py.
"""
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from decimal import Decimal

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    pass


class InvalidSignature(Exception):
    pass


@dataclass
class Verification:
    status: str  # "succeeded" | "failed" | "cancelled" | "expired" | "reversed" | "pending"
    amount: Decimal | None = None
    currency: str = ""
    provider_reference: str = ""


@dataclass
class WebhookEventData:
    event_id: str
    event_type: str
    reference: str
    status: str
    amount: Decimal | None
    currency: str
    provider_reference: str
    payload: dict
    dispute: dict | None = None  # set for chargeback events: id, status, category, amount, currency, respond_by, resolution


class PaymentProvider:
    name = "base"
    currencies: set = set()

    def supports_currency(self, currency):
        return currency.upper() in self.currencies

    def initiate(self, attempt, email, return_url):
        """Return {'authorization_url': str, 'provider_reference': str, 'raw': dict}."""
        raise NotImplementedError

    def verify(self, attempt):
        """Ask the provider for the authoritative status of an attempt. Returns Verification."""
        raise NotImplementedError

    def parse_webhook(self, raw_body, headers):
        """Validate the signature and return WebhookEventData, or raise InvalidSignature."""
        raise NotImplementedError

    @staticmethod
    def _dispute_event(payload, event, d):
        """charge.dispute.create / remind / resolve. Field names follow Paystack's docs; confirm with a sandbox dispute."""
        txn = d.get("transaction") or {}
        amount = d.get("refund_amount", txn.get("amount"))
        return WebhookEventData(
            event_id=f"{event}:{d.get('id', '')}:{d.get('status', '')}", event_type=event, reference=txn.get("reference", ""),
            status="pending", amount=None, currency="", provider_reference=str(txn.get("id", "")), payload=payload,
            dispute={
                "id": str(d.get("id", "")), "status": d.get("status", ""), "category": d.get("category", "") or d.get("reason", ""),
                "amount": _from_minor(amount) if amount is not None else None,
                "currency": (d.get("currency") or txn.get("currency") or "").upper(), "respond_by": d.get("due_at", ""),
                "resolution": d.get("resolution", ""), "resolved": event.endswith(".resolve"),
            },
        )

    def refund(self, attempt, amount, reason=""):
        """Return provider refund reference, or raise ProviderError."""
        raise NotImplementedError

    def list_transactions(self, start, end):
        """Provider's own transaction list for reconciliation: [{reference, status, amount, currency}]."""
        raise NotImplementedError


def _to_minor(amount):
    return int((Decimal(amount) * 100).quantize(Decimal("1")))


def _from_minor(value):
    return (Decimal(int(value)) / 100).quantize(Decimal("0.01"))


class PaystackProvider(PaymentProvider):
    """Paystack: cards plus Ghana Mobile Money (MTN / Vodafone / AirtelTigo) on GHS transactions."""

    name = "paystack"
    currencies = {"GHS", "NGN", "ZAR", "USD", "KES"}
    base_url = "https://api.paystack.co"

    def _headers(self):
        if not settings.PAYSTACK_SECRET_KEY:
            raise ProviderError("PAYSTACK_SECRET_KEY is not configured.")
        return {"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}", "Content-Type": "application/json"}

    def initiate(self, attempt, email, return_url):
        body = {
            "email": email,
            "amount": _to_minor(attempt.amount),
            "currency": attempt.currency,
            "reference": attempt.reference,
            "callback_url": return_url,
        }
        if attempt.currency == "GHS":
            body["channels"] = ["mobile_money", "card"]
        try:
            resp = requests.post(f"{self.base_url}/transaction/initialize", json=body, headers=self._headers(), timeout=20)
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            raise ProviderError(f"Paystack unreachable: {exc}")
        if not resp.ok or not data.get("status"):
            raise ProviderError(data.get("message", "Paystack rejected the request."))
        d = data["data"]
        return {"authorization_url": d["authorization_url"], "provider_reference": d.get("access_code", ""), "raw": d}

    def verify(self, attempt):
        try:
            resp = requests.get(f"{self.base_url}/transaction/verify/{attempt.reference}", headers=self._headers(), timeout=20)
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            raise ProviderError(f"Paystack unreachable: {exc}")
        if not resp.ok or not data.get("status"):
            return Verification("pending")
        d = data["data"]
        status = {"success": "succeeded", "failed": "failed", "abandoned": "cancelled", "reversed": "reversed"}.get(d.get("status"), "pending")
        return Verification(status, _from_minor(d.get("amount", 0)), (d.get("currency") or "").upper(), str(d.get("id", "")))

    def parse_webhook(self, raw_body, headers):
        signature = headers.get("x-paystack-signature", "")
        expected = hmac.new(settings.PAYSTACK_SECRET_KEY.encode(), raw_body, hashlib.sha512).hexdigest()
        if not settings.PAYSTACK_SECRET_KEY or not hmac.compare_digest(signature, expected):
            raise InvalidSignature()
        payload = json.loads(raw_body)
        d = payload.get("data", {})
        event = payload.get("event", "")
        if event.startswith("charge.dispute."):
            return self._dispute_event(payload, event, d)
        status = "succeeded" if event == "charge.success" else "failed" if event == "charge.failed" else "pending"
        return WebhookEventData(
            event_id=f"{event}:{d.get('id', d.get('reference', ''))}",
            event_type=event,
            reference=d.get("reference", ""),
            status=status,
            amount=_from_minor(d["amount"]) if "amount" in d else None,
            currency=(d.get("currency") or "").upper(),
            provider_reference=str(d.get("id", "")),
            payload=payload,
        )

    def refund(self, attempt, amount, reason=""):
        body = {"transaction": attempt.reference, "amount": _to_minor(amount), "merchant_note": reason[:200]}
        try:
            resp = requests.post(f"{self.base_url}/refund", json=body, headers=self._headers(), timeout=20)
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            raise ProviderError(f"Paystack unreachable: {exc}")
        if not resp.ok or not data.get("status"):
            raise ProviderError(data.get("message", "Refund rejected."))
        return str(data.get("data", {}).get("id", ""))


    def list_transactions(self, start, end):
        out, page = [], 1
        while True:
            try:
                resp = requests.get(
                    f"{self.base_url}/transaction", headers=self._headers(), timeout=30,
                    params={"perPage": 100, "page": page, "from": start.isoformat(), "to": end.isoformat()},
                )
                data = resp.json()
            except (requests.RequestException, ValueError) as exc:
                raise ProviderError(f"Paystack unreachable: {exc}")
            if not resp.ok or not data.get("status"):
                raise ProviderError(data.get("message", "Could not list Paystack transactions."))
            for t in data.get("data", []):
                status = {"success": "succeeded", "failed": "failed", "abandoned": "cancelled", "reversed": "reversed"}.get(t.get("status"), "pending")
                out.append({"reference": t.get("reference", ""), "status": status, "amount": _from_minor(t.get("amount", 0)), "currency": (t.get("currency") or "").upper()})
            if page >= int(data.get("meta", {}).get("pageCount", 1) or 1):
                return out
            page += 1


class MockProvider(PaymentProvider):
    """Development/test gateway. Enabled only when 'mock' is in PAYMENT_PROVIDERS_ENABLED."""

    name = "mock"
    currencies = {"USD", "GHS", "EUR", "GBP"}

    @staticmethod
    def sign(raw_body):
        return hmac.new(settings.SECRET_KEY.encode(), raw_body, hashlib.sha256).hexdigest()

    def initiate(self, attempt, email, return_url):
        return {"authorization_url": f"{return_url}?reference={attempt.reference}&mock=1", "provider_reference": "mock-" + attempt.reference, "raw": {}}

    def verify(self, attempt):
        outcome = attempt.raw_response.get("mock_status", "succeeded")
        return Verification(outcome, attempt.amount, attempt.currency, "mock-" + attempt.reference)

    def parse_webhook(self, raw_body, headers):
        if not hmac.compare_digest(headers.get("x-mock-signature", ""), self.sign(raw_body)):
            raise InvalidSignature()
        p = json.loads(raw_body)
        return WebhookEventData(
            event_id=p["event_id"], event_type=p.get("type", "payment"), reference=p["reference"], status=p["status"],
            amount=Decimal(str(p["amount"])) if "amount" in p else None, currency=p.get("currency", ""),
            provider_reference=p.get("provider_reference", ""), payload=p, dispute=p.get("dispute"),
        )

    def refund(self, attempt, amount, reason=""):
        return "mock-refund-" + attempt.reference

    # Tests can set MockProvider.ledger to simulate the provider's side of the books.
    ledger = None

    def list_transactions(self, start, end):
        return list(self.ledger or [])


def _registry():
    from .providers_extra import FlutterwaveProvider, PayPalProvider, StripeProvider

    return {"paystack": PaystackProvider, "mock": MockProvider, "stripe": StripeProvider, "paypal": PayPalProvider, "flutterwave": FlutterwaveProvider}


def enabled_providers():
    registry = _registry()
    return {name: registry[name]() for name in settings.PAYMENT_PROVIDERS_ENABLED if name in registry}


def chargeable_currencies():
    """Currencies at least one enabled gateway can charge, and that we hold a usable exchange rate for."""
    from apps.orders import pricing

    base = settings.BASE_CURRENCY.upper()
    out = set()
    for provider in enabled_providers().values():
        for code in provider.currencies:
            if code == base:
                out.add(code)
                continue
            try:
                pricing.rate(code)
            except pricing.PricingError:
                continue
            out.add(code)
    return out


def get_provider(name):
    provider = enabled_providers().get(name)
    if not provider:
        raise ProviderError(f"Payment provider '{name}' is not available.")
    return provider

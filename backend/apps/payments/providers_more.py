"""
Hubtel, Cash, Zelle and Cash App.

Hubtel is a Ghana gateway (Mobile Money and cards, GHS only). It was written from Hubtel's public documentation and
tested with mocked responses only: it has NOT been run against a Hubtel account. Hubtel's callbacks carry no
signature, so this adapter never trusts one: it re-asks Hubtel's status API before acting on a callback.

Cash, Zelle and Cash App are manual methods for USD. No money moves through Mpanko: the customer is told how to pay, the order
waits, and finance staff press "Payment received" in the admin once the money has really arrived.
"""
import base64
import json
from decimal import Decimal

from django.conf import settings

from .providers import InvalidSignature, PaymentProvider, ProviderError, Verification, WebhookEventData
from .providers_extra import _call, _dec, _with_reference

# ------------------------------------------------------------------ Cash and Zelle


class ManualProvider(PaymentProvider):
    """Base for methods a person confirms by hand. The shopper sees instructions, not a payment page."""

    manual = True
    label = ""

    def instructions(self, attempt):
        raise NotImplementedError

    def initiate(self, attempt, email, return_url):
        # The "payment page" is our own confirmation page, which shows the instructions for a pending manual payment.
        return {
            "authorization_url": _with_reference(return_url, attempt.reference),
            "provider_reference": "",
            "raw": {"manual": True, "instructions": self.instructions(attempt)},
        }

    def verify(self, attempt):
        return Verification("pending")  # only staff can confirm; see ConfirmManualView

    def parse_webhook(self, raw_body, headers):
        raise InvalidSignature()  # there is no provider to call us

    def refund(self, attempt, amount, reason=""):
        # Mpanko cannot send the money. Finance pays the customer back by hand first, then records it here.
        return f"manual-refund-{attempt.reference}"

    def list_transactions(self, start, end):
        raise ProviderError(f"{self.label} has no statement to compare with. Check these payments against your bank or cash book.")


class ZelleProvider(ManualProvider):
    name = "zelle"
    label = "Zelle"
    currencies = {"USD"}

    def instructions(self, attempt):
        who = settings.ZELLE_RECIPIENT or "the email or phone number we will send you"
        name = f" (registered to {settings.ZELLE_NAME})" if settings.ZELLE_NAME else ""
        return (
            f"Send exactly {attempt.currency} {attempt.amount} with Zelle to {who}{name}. "
            f"Write {attempt.order.number} in the memo so we can match your payment. "
            "We will confirm your order as soon as the money arrives."
        )


class CashAppProvider(ManualProvider):
    """Cash App paid by hand to the shop's $cashtag. This is NOT Cash App Pay (Square's API): nothing is confirmed
    automatically, so finance confirms each payment in the admin, exactly as for Zelle."""

    name = "cashapp"
    label = "Cash App"
    currencies = {"USD"}

    def instructions(self, attempt):
        tag = settings.CASHAPP_CASHTAG.strip()
        if tag and not tag.startswith("$"):
            tag = "$" + tag
        who = tag or "the $cashtag we will send you"
        return (
            f"Send exactly {attempt.currency} {attempt.amount} with Cash App to {who}. "
            f"Write {attempt.order.number} in the note so we can match your payment. "
            "We will confirm your order as soon as the money arrives."
        )


class CashProvider(ManualProvider):
    name = "cash"
    label = "Cash"
    currencies = {"USD"}

    def instructions(self, attempt):
        how = settings.CASH_INSTRUCTIONS or "We will contact you to arrange where and when to pay."
        return f"Pay {attempt.currency} {attempt.amount} in cash. {how} Quote order {attempt.order.number}. We will confirm your order once we have the cash."


# ------------------------------------------------------------------ Hubtel


class HubtelProvider(PaymentProvider):
    name = "hubtel"
    currencies = {"GHS"}
    checkout_url = "https://payproxyapi.hubtel.com/items/initiate"
    status_url = "https://api-txnstatus.hubtel.com/transactions"

    def _auth(self):
        if not (settings.HUBTEL_CLIENT_ID and settings.HUBTEL_CLIENT_SECRET and settings.HUBTEL_MERCHANT_ACCOUNT):
            raise ProviderError("Hubtel is not configured.")
        token = base64.b64encode(f"{settings.HUBTEL_CLIENT_ID}:{settings.HUBTEL_CLIENT_SECRET}".encode()).decode()
        return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}

    def initiate(self, attempt, email, return_url):
        base = settings.API_PUBLIC_URL.rstrip("/") if settings.API_PUBLIC_URL else ""
        body = {
            "totalAmount": str(attempt.amount), "description": f"Order {attempt.order.number}", "clientReference": attempt.reference,
            "merchantAccountNumber": settings.HUBTEL_MERCHANT_ACCOUNT,
            "callbackUrl": f"{base}/api/v1/payments/webhooks/hubtel/",
            "returnUrl": _with_reference(return_url, attempt.reference), "cancellationUrl": _with_reference(return_url, attempt.reference),
        }
        resp, data = _call("POST", self.checkout_url, "Hubtel", headers=self._auth(), json=body)
        url = (data.get("data") or {}).get("checkoutUrl")
        if not resp.ok or data.get("responseCode") not in {"0000", None} or not url:
            raise ProviderError(data.get("message") or data.get("status") or "Hubtel could not start the payment.")
        return {"authorization_url": url, "provider_reference": str((data.get("data") or {}).get("checkoutId", "")), "raw": {}}

    @staticmethod
    def _status(value):
        v = str(value or "").lower()
        if v == "paid":
            return "succeeded"
        if v == "refunded":
            return "reversed"
        return "pending"  # "Unpaid" may still be paid a moment later; the order's own timer ends it

    def _lookup(self, reference):
        url = f"{self.status_url}/{settings.HUBTEL_MERCHANT_ACCOUNT}/status"
        resp, data = _call("GET", url, "Hubtel", headers=self._auth(), params={"clientReference": reference})
        d = data.get("data") if resp.ok else None
        return d if isinstance(d, dict) and d else None

    def verify(self, attempt):
        d = self._lookup(attempt.reference)
        if not d:
            return Verification("pending")
        return Verification(self._status(d.get("status")), _dec(d["amount"]) if d.get("amount") is not None else None,
                            (d.get("currencyCode") or "GHS").upper(), str(d.get("transactionId", "")))

    def parse_webhook(self, raw_body, headers):
        payload = json.loads(raw_body)
        data = payload.get("Data") or payload.get("data") or {}
        reference = data.get("ClientReference") or data.get("clientReference") or ""
        if not reference:
            raise KeyError("ClientReference")
        # No signature to check, so ask Hubtel itself. A forged callback cannot make Hubtel say "Paid".
        d = self._lookup(reference)
        if not d:
            raise InvalidSignature()
        status = self._status(d.get("status"))
        return WebhookEventData(
            event_id=f"hubtel:{reference}:{status}", event_type="checkout", reference=reference, status=status,
            amount=_dec(d["amount"]) if d.get("amount") is not None else None, currency=(d.get("currencyCode") or "GHS").upper(),
            provider_reference=str(d.get("transactionId", "")), payload=payload,
        )

    def refund(self, attempt, amount, reason=""):
        raise ProviderError("Hubtel refunds are made in your Hubtel dashboard. Refund there, then record it here once Hubtel allows it.")

    def list_transactions(self, start, end):
        raise ProviderError("Hubtel does not give us a statement to reconcile against yet. Compare with the Hubtel dashboard.")

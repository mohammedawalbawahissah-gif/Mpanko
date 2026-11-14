"""
MTN Mobile Money (MoMo) Collections, charged in GHS.

Written from MTN's public MoMo Developer documentation and tested with mocked responses only: it has NOT been run
against a live MTN account. MoMo is push-based: we ask MTN to prompt the customer's phone, the customer approves with
their PIN, and we then ask MTN for the result. MTN's callback carries no signature, so a callback is never trusted:
this adapter re-asks MTN's status API before acting on one.
"""
import json
import uuid
from decimal import Decimal

from django.conf import settings

from .providers import InvalidSignature, PaymentProvider, ProviderError, Verification, WebhookEventData
from .providers_extra import _call, _dec


def request_id(reference):
    """MTN wants a UUID per request. Derive it from our reference so no extra column is needed."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mpanko:momo:{reference}"))


def msisdn(phone):
    """MTN wants digits only, with country code and no plus sign."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 10:  # local Ghana format 024...
        digits = "233" + digits[1:]
    return digits


class MtnMomoProvider(PaymentProvider):
    name = "mtn_momo"
    currencies = {"GHS"}

    def _base(self):
        return settings.MTN_MOMO_BASE_URL.rstrip("/")

    def _configured(self):
        if not (settings.MTN_MOMO_API_USER and settings.MTN_MOMO_API_KEY and settings.MTN_MOMO_SUBSCRIPTION_KEY):
            raise ProviderError("MTN MoMo is not configured.")

    def _token(self):
        self._configured()
        resp, data = _call("POST", f"{self._base()}/collection/token/", "MTN MoMo",
                           auth=(settings.MTN_MOMO_API_USER, settings.MTN_MOMO_API_KEY),
                           headers={"Ocp-Apim-Subscription-Key": settings.MTN_MOMO_SUBSCRIPTION_KEY})
        token = data.get("access_token")
        if not resp.ok or not token:
            raise ProviderError("MTN MoMo rejected our credentials.")
        return token

    def _headers(self, extra=None):
        h = {"Authorization": f"Bearer {self._token()}", "X-Target-Environment": settings.MTN_MOMO_ENVIRONMENT,
             "Ocp-Apim-Subscription-Key": settings.MTN_MOMO_SUBSCRIPTION_KEY}
        h.update(extra or {})
        return h

    def initiate(self, attempt, email, return_url):
        phone = msisdn(attempt.order.contact_phone)
        if len(phone) < 11:
            raise ProviderError("Add the MTN Mobile Money number to the order's phone number, with country code (for example 233241234567).")
        rid = request_id(attempt.reference)
        headers = self._headers({"X-Reference-Id": rid, "Content-Type": "application/json"})
        if settings.API_PUBLIC_URL.startswith("https://"):
            headers["X-Callback-Url"] = f"{settings.API_PUBLIC_URL.rstrip('/')}/api/v1/payments/webhooks/mtn_momo/"
        body = {
            "amount": str(attempt.amount), "currency": settings.MTN_MOMO_CURRENCY, "externalId": attempt.reference,
            "payer": {"partyIdType": "MSISDN", "partyId": phone},
            "payerMessage": f"Order {attempt.order.number}", "payeeNote": f"Order {attempt.order.number}",
        }
        resp, data = _call("POST", f"{self._base()}/collection/v1_0/requesttopay", "MTN MoMo", headers=headers, json=body)
        if resp.status_code != 202:
            raise ProviderError(data.get("message") or "MTN MoMo could not start the payment. Check the number and try again.")
        # No page to send the shopper to: MTN prompts the phone. The shop shows "approve on your phone".
        return {"authorization_url": "", "provider_reference": rid, "raw": {"push": True, "instructions": "Check your phone and approve the MTN MoMo prompt with your PIN."}}

    @staticmethod
    def _status(value):
        v = str(value or "").upper()
        if v == "SUCCESSFUL":
            return "succeeded"
        if v == "FAILED":
            return "failed"
        return "pending"

    def _lookup(self, reference):
        resp, data = _call("GET", f"{self._base()}/collection/v1_0/requesttopay/{request_id(reference)}", "MTN MoMo", headers=self._headers())
        return data if resp.ok and isinstance(data, dict) and data else None

    def _verification(self, d):
        status = self._status(d.get("status"))
        amount = _dec(d["amount"]) if d.get("amount") is not None else None
        return Verification(status, amount, (d.get("currency") or settings.MTN_MOMO_CURRENCY).upper(), str(d.get("financialTransactionId") or ""))

    def verify(self, attempt):
        d = self._lookup(attempt.reference)
        return self._verification(d) if d else Verification("pending")

    def parse_webhook(self, raw_body, headers):
        payload = json.loads(raw_body)
        reference = payload.get("externalId") or ""
        if not reference:
            raise KeyError("externalId")
        d = self._lookup(reference)  # a forged callback cannot make MTN say SUCCESSFUL
        if not d:
            raise InvalidSignature()
        v = self._verification(d)
        return WebhookEventData(
            event_id=f"mtn_momo:{reference}:{v.status}", event_type="requesttopay", reference=reference, status=v.status,
            amount=v.amount, currency=v.currency, provider_reference=v.provider_reference, payload=payload,
        )

    def refund(self, attempt, amount, reason=""):
        raise ProviderError("MTN MoMo refunds are made in your MTN MoMo portal. Refund there, then record it here.")

    def list_transactions(self, start, end):
        raise ProviderError("MTN MoMo does not give us a statement to reconcile against yet. Compare with the MoMo portal.")

"""
Stripe, PayPal and Flutterwave (FR-PAY-02). Each follows the PaymentProvider contract in providers.py, so checkout,
refunds, chargebacks and reconciliation work the same whichever gateway took the money.

These were written against each gateway's public API documentation and tested with mocked responses. They have not
been run against a live or sandbox account. Run `python manage.py preflight` with real keys, then place a test
payment, before turning one on for customers.
"""
import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from urllib.parse import urlencode

import requests
from django.conf import settings

from .providers import (
    InvalidSignature,
    PaymentProvider,
    ProviderError,
    Verification,
    WebhookEventData,
    _from_minor,
    _to_minor,
)


def _with_reference(return_url, reference):
    sep = "&" if "?" in return_url else "?"
    return f"{return_url}{sep}{urlencode({'reference': reference})}"


def _dec(value):
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _call(method, url, what, **kwargs):
    try:
        resp = requests.request(method, url, timeout=kwargs.pop("timeout", 20), **kwargs)
    except requests.RequestException as exc:
        raise ProviderError(f"{what} unreachable: {exc}")
    try:
        data = resp.json() if resp.content else {}
    except ValueError:
        data = {}
    return resp, data


# ------------------------------------------------------------------ Stripe


class StripeProvider(PaymentProvider):
    """Stripe Checkout: cards and wallets in USD, EUR, GBP, CAD and AUD."""

    name = "stripe"
    currencies = {"USD", "EUR", "GBP", "CAD", "AUD"}
    base_url = "https://api.stripe.com/v1"
    tolerance_seconds = 300

    def _auth(self):
        if not settings.STRIPE_SECRET_KEY:
            raise ProviderError("STRIPE_SECRET_KEY is not configured.")
        return {"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY}"}

    def _get(self, path, params=None):
        resp, data = _call("GET", f"{self.base_url}{path}", "Stripe", headers=self._auth(), params=params)
        if not resp.ok:
            raise ProviderError((data.get("error") or {}).get("message", "Stripe rejected the request."))
        return data

    def initiate(self, attempt, email, return_url):
        done = _with_reference(return_url, attempt.reference)
        body = {
            "mode": "payment",
            "success_url": done,
            "cancel_url": done + "&cancelled=1",
            "client_reference_id": attempt.reference,
            "customer_email": email,
            "metadata[reference]": attempt.reference,
            "payment_intent_data[metadata][reference]": attempt.reference,
            "line_items[0][quantity]": 1,
            "line_items[0][price_data][currency]": attempt.currency.lower(),
            "line_items[0][price_data][unit_amount]": _to_minor(attempt.amount),
            "line_items[0][price_data][product_data][name]": f"Order {attempt.order.number}",
        }
        resp, data = _call("POST", f"{self.base_url}/checkout/sessions", "Stripe", headers={**self._auth(), "Idempotency-Key": attempt.reference}, data=body)
        if not resp.ok or not data.get("url"):
            raise ProviderError((data.get("error") or {}).get("message", "Stripe rejected the request."))
        return {"authorization_url": data["url"], "provider_reference": data["id"], "raw": {"id": data["id"]}}

    @staticmethod
    def _status(session):
        if session.get("payment_status") == "paid":
            return "succeeded"
        if session.get("status") == "expired":
            return "expired"
        return "pending"

    def verify(self, attempt):
        if not attempt.provider_reference:
            return Verification("pending")
        s = self._get(f"/checkout/sessions/{attempt.provider_reference}")
        return Verification(self._status(s), _from_minor(s.get("amount_total") or 0), (s.get("currency") or "").upper(), s.get("id", ""))

    def _check_signature(self, raw_body, headers):
        secret = settings.STRIPE_WEBHOOK_SECRET
        header = headers.get("stripe-signature", "")
        if not secret or not header:
            raise InvalidSignature()
        parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
        stamp = parts.get("t", "")
        signed = hmac.new(secret.encode(), f"{stamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
        candidates = [p.split("=", 1)[1] for p in header.split(",") if p.startswith("v1=")]
        if not any(hmac.compare_digest(signed, c) for c in candidates):
            raise InvalidSignature()
        try:
            age = abs(time.time() - int(stamp))
        except ValueError:
            raise InvalidSignature()
        if age > self.tolerance_seconds:
            raise InvalidSignature()

    def parse_webhook(self, raw_body, headers):
        self._check_signature(raw_body, headers)
        payload = json.loads(raw_body)
        etype = payload.get("type", "")
        obj = (payload.get("data") or {}).get("object") or {}
        if etype.startswith("charge.dispute."):
            return self._dispute(payload, etype, obj)
        if etype.startswith("checkout.session."):
            ref = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("reference", "")
            if etype in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
                status = "succeeded" if obj.get("payment_status") == "paid" else "pending"
            elif etype == "checkout.session.async_payment_failed":
                status = "failed"
            elif etype == "checkout.session.expired":
                status = "expired"
            else:
                status = "pending"
            return WebhookEventData(
                event_id=payload["id"], event_type=etype, reference=ref, status=status,
                amount=_from_minor(obj["amount_total"]) if obj.get("amount_total") is not None else None,
                currency=(obj.get("currency") or "").upper(), provider_reference=obj.get("id", ""), payload=payload,
            )
        return WebhookEventData(payload["id"], etype, "", "pending", None, "", "", payload)

    def _dispute(self, payload, etype, d):
        intent = d.get("payment_intent", "")
        reference = ""
        if intent:
            reference = ((self._get(f"/payment_intents/{intent}").get("metadata")) or {}).get("reference", "")
        due = (d.get("evidence_details") or {}).get("due_by")
        resolved = etype == "charge.dispute.closed"
        return WebhookEventData(
            event_id=f"{payload['id']}", event_type=etype, reference=reference, status="pending", amount=None, currency="",
            provider_reference="", payload=payload,
            dispute={
                "id": d.get("id", ""), "status": d.get("status", ""), "category": d.get("reason", ""),
                "amount": _from_minor(d["amount"]) if d.get("amount") is not None else None,
                "currency": (d.get("currency") or "").upper(),
                "respond_by": datetime.fromtimestamp(due, dt_timezone.utc).isoformat() if due else "",
                # Stripe words: won / lost / warning_closed. "won" is a win; anything else counts as a loss.
                "resolution": d.get("status", "") if resolved else "", "resolved": resolved,
            },
        )

    def refund(self, attempt, amount, reason=""):
        s = self._get(f"/checkout/sessions/{attempt.provider_reference}")
        intent = s.get("payment_intent")
        if not intent:
            raise ProviderError("Stripe has no payment to refund for this order.")
        resp, data = _call("POST", f"{self.base_url}/refunds", "Stripe", headers=self._auth(), data={"payment_intent": intent, "amount": _to_minor(amount)})
        if not resp.ok:
            raise ProviderError((data.get("error") or {}).get("message", "Refund rejected."))
        return data.get("id", "")

    def list_transactions(self, start, end):
        out, after = [], None
        while True:
            params = {"limit": 100, "created[gte]": int(start.timestamp()), "created[lte]": int(end.timestamp())}
            if after:
                params["starting_after"] = after
            data = self._get("/checkout/sessions", params)
            for s in data.get("data", []):
                out.append({
                    "reference": s.get("client_reference_id") or "", "status": self._status(s),
                    "amount": _from_minor(s.get("amount_total") or 0), "currency": (s.get("currency") or "").upper(),
                })
            if not data.get("has_more") or not data.get("data"):
                return out
            after = data["data"][-1]["id"]


# ------------------------------------------------------------------ Flutterwave


class FlutterwaveProvider(PaymentProvider):
    """Flutterwave Standard: cards, mobile money and bank payments across Africa."""

    name = "flutterwave"
    currencies = {"GHS", "NGN", "KES", "ZAR", "USD", "EUR", "GBP"}
    base_url = "https://api.flutterwave.com/v3"

    def _auth(self):
        if not settings.FLUTTERWAVE_SECRET_KEY:
            raise ProviderError("FLUTTERWAVE_SECRET_KEY is not configured.")
        return {"Authorization": f"Bearer {settings.FLUTTERWAVE_SECRET_KEY}"}

    def initiate(self, attempt, email, return_url):
        body = {
            "tx_ref": attempt.reference, "amount": str(_dec(attempt.amount)), "currency": attempt.currency,
            "redirect_url": _with_reference(return_url, attempt.reference), "customer": {"email": email},
            "customizations": {"title": "Mpanko"},
        }
        resp, data = _call("POST", f"{self.base_url}/payments", "Flutterwave", headers=self._auth(), json=body)
        link = (data.get("data") or {}).get("link")
        if not resp.ok or data.get("status") != "success" or not link:
            raise ProviderError(data.get("message", "Flutterwave rejected the request."))
        return {"authorization_url": link, "provider_reference": "", "raw": {}}

    @staticmethod
    def _status(value):
        return {"successful": "succeeded", "failed": "failed", "cancelled": "cancelled"}.get((value or "").lower(), "pending")

    def _by_reference(self, reference):
        resp, data = _call("GET", f"{self.base_url}/transactions/verify_by_reference", "Flutterwave", headers=self._auth(), params={"tx_ref": reference})
        if not resp.ok or data.get("status") != "success":
            return None
        return data.get("data") or None

    def verify(self, attempt):
        d = self._by_reference(attempt.reference)
        if not d:
            return Verification("pending")
        return Verification(self._status(d.get("status")), _dec(d.get("amount", 0)), (d.get("currency") or "").upper(), str(d.get("id", "")))

    def parse_webhook(self, raw_body, headers):
        secret = settings.FLUTTERWAVE_WEBHOOK_HASH
        if not secret or not hmac.compare_digest(headers.get("verif-hash", ""), secret):
            raise InvalidSignature()
        payload = json.loads(raw_body)
        d = payload.get("data") or {}
        etype = payload.get("event") or payload.get("event.type", "")
        return WebhookEventData(
            event_id=f"{etype}:{d.get('id', d.get('tx_ref', ''))}:{d.get('status', '')}", event_type=etype,
            reference=d.get("tx_ref", ""), status=self._status(d.get("status")),
            amount=_dec(d["amount"]) if d.get("amount") is not None else None, currency=(d.get("currency") or "").upper(),
            provider_reference=str(d.get("id", "")), payload=payload,
        )

    def refund(self, attempt, amount, reason=""):
        d = self._by_reference(attempt.reference)
        if not d:
            raise ProviderError("Flutterwave has no payment to refund for this order.")
        resp, data = _call("POST", f"{self.base_url}/transactions/{d['id']}/refund", "Flutterwave", headers=self._auth(), json={"amount": str(_dec(amount))})
        if not resp.ok or data.get("status") != "success":
            raise ProviderError(data.get("message", "Refund rejected."))
        return str((data.get("data") or {}).get("id", ""))

    def list_transactions(self, start, end):
        out, page = [], 1
        while True:
            resp, data = _call("GET", f"{self.base_url}/transactions", "Flutterwave", headers=self._auth(), timeout=30,
                               params={"from": start.date().isoformat(), "to": end.date().isoformat(), "page": page})
            if not resp.ok or data.get("status") != "success":
                raise ProviderError(data.get("message", "Could not list Flutterwave transactions."))
            for t in data.get("data", []):
                out.append({"reference": t.get("tx_ref", ""), "status": self._status(t.get("status")), "amount": _dec(t.get("amount", 0)), "currency": (t.get("currency") or "").upper()})
            info = data.get("meta", {}).get("page_info", {})
            if page >= int(info.get("total_pages", 1) or 1):
                return out
            page += 1


# ------------------------------------------------------------------ PayPal


class PayPalProvider(PaymentProvider):
    """PayPal Checkout (Orders v2): PayPal balance and cards, in USD, EUR, GBP, CAD and AUD."""

    name = "paypal"
    currencies = {"USD", "EUR", "GBP", "CAD", "AUD"}

    @property
    def base_url(self):
        return "https://api-m.paypal.com" if settings.PAYPAL_ENV == "live" else "https://api-m.sandbox.paypal.com"

    def _token(self):
        if not settings.PAYPAL_CLIENT_ID or not settings.PAYPAL_CLIENT_SECRET:
            raise ProviderError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not configured.")
        basic = base64.b64encode(f"{settings.PAYPAL_CLIENT_ID}:{settings.PAYPAL_CLIENT_SECRET}".encode()).decode()
        resp, data = _call("POST", f"{self.base_url}/v1/oauth2/token", "PayPal", headers={"Authorization": f"Basic {basic}"}, data={"grant_type": "client_credentials"})
        if not resp.ok or not data.get("access_token"):
            raise ProviderError("PayPal sign-in failed. Check the client id and secret.")
        return data["access_token"]

    def _headers(self, **extra):
        return {"Authorization": f"Bearer {self._token()}", "Content-Type": "application/json", **extra}

    def initiate(self, attempt, email, return_url):
        done = _with_reference(return_url, attempt.reference)
        body = {
            "intent": "CAPTURE",
            "purchase_units": [{
                "custom_id": attempt.reference, "invoice_id": attempt.reference,
                "amount": {"currency_code": attempt.currency, "value": str(_dec(attempt.amount))},
            }],
            "payment_source": {"paypal": {"email_address": email, "experience_context": {
                "return_url": done, "cancel_url": done + "&cancelled=1", "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING",
            }}},
        }
        resp, data = _call("POST", f"{self.base_url}/v2/checkout/orders", "PayPal", headers=self._headers(**{"PayPal-Request-Id": attempt.reference}), json=body)
        link = next((l["href"] for l in data.get("links", []) if l.get("rel") in {"payer-action", "approve"}), "")
        if not resp.ok or not link:
            raise ProviderError(data.get("message", "PayPal rejected the request."))
        return {"authorization_url": link, "provider_reference": data["id"], "raw": {"id": data["id"]}}

    @staticmethod
    def _capture_of(order):
        for unit in order.get("purchase_units", []):
            for c in (unit.get("payments") or {}).get("captures", []):
                return c
        return None

    def verify(self, attempt):
        if not attempt.provider_reference:
            return Verification("pending")
        headers = self._headers()
        resp, order = _call("GET", f"{self.base_url}/v2/checkout/orders/{attempt.provider_reference}", "PayPal", headers=headers)
        if not resp.ok:
            return Verification("pending")
        if order.get("status") == "APPROVED":
            # The shopper approved it on PayPal. Take the money now.
            resp, order = _call("POST", f"{self.base_url}/v2/checkout/orders/{attempt.provider_reference}/capture", "PayPal", headers={**headers, "PayPal-Request-Id": attempt.reference + "-capture"}, json={})
            if not resp.ok:
                return Verification("pending")
        if order.get("status") == "COMPLETED":
            cap = self._capture_of(order) or {}
            amount = cap.get("amount") or order["purchase_units"][0]["amount"]
            if cap.get("status") == "COMPLETED":
                return Verification("succeeded", _dec(amount["value"]), amount["currency_code"].upper(), order["id"])
            return Verification("failed" if cap.get("status") in {"DECLINED", "FAILED"} else "pending", provider_reference=order["id"])
        if order.get("status") in {"VOIDED"}:
            return Verification("cancelled", provider_reference=order["id"])
        return Verification("pending", provider_reference=order.get("id", ""))

    def _verify_signature(self, raw_body, headers):
        if not settings.PAYPAL_WEBHOOK_ID:
            raise InvalidSignature()
        body = {
            "auth_algo": headers.get("paypal-auth-algo", ""), "cert_url": headers.get("paypal-cert-url", ""),
            "transmission_id": headers.get("paypal-transmission-id", ""), "transmission_sig": headers.get("paypal-transmission-sig", ""),
            "transmission_time": headers.get("paypal-transmission-time", ""), "webhook_id": settings.PAYPAL_WEBHOOK_ID,
            "webhook_event": json.loads(raw_body),
        }
        try:
            resp, data = _call("POST", f"{self.base_url}/v1/notifications/verify-webhook-signature", "PayPal", headers=self._headers(), json=body)
        except ProviderError:
            raise InvalidSignature()
        if not resp.ok or data.get("verification_status") != "SUCCESS":
            raise InvalidSignature()

    def parse_webhook(self, raw_body, headers):
        self._verify_signature(raw_body, headers)
        payload = json.loads(raw_body)
        etype = payload.get("event_type", "")
        r = payload.get("resource") or {}
        if etype.startswith("CUSTOMER.DISPUTE."):
            return self._dispute(payload, etype, r)
        status = {"PAYMENT.CAPTURE.COMPLETED": "succeeded", "PAYMENT.CAPTURE.DENIED": "failed", "PAYMENT.CAPTURE.REVERSED": "reversed"}.get(etype, "pending")
        amount = r.get("amount") or {}
        order_id = ((r.get("supplementary_data") or {}).get("related_ids") or {}).get("order_id", "")
        return WebhookEventData(
            event_id=payload.get("id", ""), event_type=etype, reference=r.get("custom_id", "") or r.get("invoice_id", ""), status=status,
            amount=_dec(amount["value"]) if amount.get("value") else None, currency=(amount.get("currency_code") or "").upper(),
            provider_reference=order_id, payload=payload,
        )

    def _dispute(self, payload, etype, r):
        reference = ""
        txn = (r.get("disputed_transactions") or [{}])[0]
        # The disputed capture's custom id is our reference when PayPal includes it; otherwise look the capture up.
        reference = txn.get("custom") or txn.get("invoice_number") or ""
        if not reference and txn.get("seller_transaction_id"):
            resp, cap = _call("GET", f"{self.base_url}/v2/payments/captures/{txn['seller_transaction_id']}", "PayPal", headers=self._headers())
            if resp.ok:
                reference = cap.get("custom_id") or cap.get("invoice_id") or ""
        amt = r.get("dispute_amount") or {}
        resolved = etype == "CUSTOMER.DISPUTE.RESOLVED"
        outcome = ((r.get("dispute_outcome") or {}).get("outcome_code") or "").lower()
        return WebhookEventData(
            event_id=payload.get("id", ""), event_type=etype, reference=reference, status="pending", amount=None, currency="",
            provider_reference="", payload=payload,
            dispute={
                "id": r.get("dispute_id", ""), "status": (r.get("status") or "").lower(), "category": (r.get("reason") or "").lower(),
                "amount": _dec(amt["value"]) if amt.get("value") else None, "currency": (amt.get("currency_code") or "").upper(),
                "respond_by": r.get("seller_response_due_date", ""),
                # PayPal outcome codes: RESOLVED_SELLER_FAVOUR is a win; RESOLVED_BUYER_FAVOUR is a loss.
                "resolution": "won" if outcome == "resolved_seller_favour" else outcome, "resolved": resolved,
            },
        )

    def refund(self, attempt, amount, reason=""):
        headers = self._headers()
        resp, order = _call("GET", f"{self.base_url}/v2/checkout/orders/{attempt.provider_reference}", "PayPal", headers=headers)
        cap = self._capture_of(order) if resp.ok else None
        if not cap:
            raise ProviderError("PayPal has no captured payment to refund for this order.")
        body = {"amount": {"value": str(_dec(amount)), "currency_code": attempt.currency}, "note_to_payer": reason[:255]}
        resp, data = _call("POST", f"{self.base_url}/v2/payments/captures/{cap['id']}/refund", "PayPal", headers=headers, json=body)
        if not resp.ok:
            raise ProviderError(data.get("message", "Refund rejected."))
        return data.get("id", "")

    def list_transactions(self, start, end):
        out, page = [], 1
        headers = self._headers()
        while True:
            resp, data = _call("GET", f"{self.base_url}/v1/reporting/transactions", "PayPal", headers=headers, timeout=30, params={
                "start_date": start.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%S-0000"),
                "end_date": end.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%S-0000"),
                "fields": "transaction_info", "page_size": 100, "page": page,
            })
            if not resp.ok:
                raise ProviderError(data.get("message", "Could not list PayPal transactions."))
            for t in data.get("transaction_details", []):
                info = t.get("transaction_info", {})
                amt = info.get("transaction_amount", {})
                if not info.get("invoice_id"):
                    continue
                out.append({
                    "reference": info["invoice_id"], "status": {"S": "succeeded", "V": "reversed", "D": "failed"}.get(info.get("transaction_status"), "pending"),
                    "amount": _dec(amt.get("value", 0)), "currency": (amt.get("currency_code") or "").upper(),
                })
            if page >= int(data.get("total_pages", 1) or 1):
                return out
            page += 1

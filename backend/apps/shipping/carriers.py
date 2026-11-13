"""
Live carrier adapters: DHL Express (MyDHL API), FedEx and UPS.

Each adapter can quote rates, book a shipment and return a label, and (FedEx, UPS) fetch tracking. They are only
active when their credentials are set, and a carrier error never blocks checkout: quotes fall back to the other
sources and the problem is logged.

IMPORTANT: written against each carrier's published API documentation and covered by mocked-request tests. They
have NOT been run against live carrier accounts. Run them in the carriers' sandboxes first (CARRIER_SANDBOX=true),
compare a few quotes with the carrier's own rate calculator, then switch to production credentials.

To add another carrier: subclass LiveCarrier, implement rates() / book() (and tracking() if the API has it),
and add it to LIVE_CARRIERS. Create a Carrier row in the admin with the same `provider` code.
"""
import base64
import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)


class CarrierError(Exception):
    pass


@dataclass
class LiveQuote:
    service_code: str
    service_name: str
    price: Decimal
    currency: str
    eta_min: int | None = None
    eta_max: int | None = None


@dataclass
class Booking:
    tracking_number: str
    label_bytes: bytes
    label_format: str  # "pdf", "png", "zpl", "gif"
    reference: str = ""


def origin():
    return dict(settings.SHIP_FROM)


def parcel_for(weight_grams, dims=None):
    """One parcel at the order's total weight, in the packed box if its size is known, else the store's default box. Minimum 100 g."""
    length, width, height = tuple(dims) if dims else (settings.PARCEL_DEFAULT_CM + [30, 20, 10])[:3]
    return {"kg": max(Decimal(weight_grams or 0) / 1000, Decimal("0.1")).quantize(Decimal("0.01")), "l": length, "w": width, "h": height}


def _dec(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


class LiveCarrier:
    code = "base"
    label = "Base"

    def configured(self):
        raise NotImplementedError

    def rates(self, dest, weight_grams, dims=None):
        """dest is an address dict (country, city, postal_code ...). Return a list of LiveQuote."""
        raise NotImplementedError

    def book(self, shipment, dest, weight_grams, service_code, dims=None):
        """Create the shipment with the carrier. Return a Booking (tracking number + label)."""
        raise NotImplementedError

    def tracking(self, shipment):
        raise NotImplementedError

    # --- helpers -------------------------------------------------------------------------------------------------
    def _request(self, method, url, **kw):
        kw.setdefault("timeout", settings.CARRIER_API_TIMEOUT)
        try:
            resp = requests.request(method, url, **kw)
        except requests.RequestException as exc:
            raise CarrierError(f"{self.label} unreachable: {exc}")
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if not resp.ok:
            raise CarrierError(f"{self.label} error {resp.status_code}: {self._error_text(data)}")
        return data

    @staticmethod
    def _error_text(data):
        if not isinstance(data, dict):
            return ""
        return str(data.get("detail") or data.get("message") or data.get("errors") or data.get("response") or data)[:300]


# =================================================================================================================
# DHL Express — MyDHL API
# =================================================================================================================
class DHLExpress(LiveCarrier):
    code = "dhl"
    label = "DHL Express"

    @property
    def base(self):
        root = "https://express.api.dhl.com/mydhlapi"
        return root + "/test" if settings.CARRIER_SANDBOX else root

    def configured(self):
        return bool(settings.DHL_EXPRESS_USER and settings.DHL_EXPRESS_PASSWORD and settings.DHL_EXPRESS_ACCOUNT)

    def _auth(self):
        return (settings.DHL_EXPRESS_USER, settings.DHL_EXPRESS_PASSWORD)

    def rates(self, dest, weight_grams, dims=None):
        o, p = origin(), parcel_for(weight_grams, dims)
        params = {
            "accountNumber": settings.DHL_EXPRESS_ACCOUNT,
            "originCountryCode": o["country"], "originCityName": o["city"], "originPostalCode": o["postal_code"] or "00000",
            "destinationCountryCode": dest["country"], "destinationCityName": dest.get("city") or "",
            "destinationPostalCode": dest.get("postal_code") or "",
            "weight": str(p["kg"]), "length": p["l"], "width": p["w"], "height": p["h"],
            "plannedShippingDate": (date.today() + timedelta(days=1)).isoformat(),
            "isCustomsDeclarable": str(o["country"].upper() != dest["country"].upper()).lower(),
            "unitOfMeasurement": "metric",
        }
        data = self._request("GET", f"{self.base}/rates", params=params, auth=self._auth())
        out = []
        for prod in data.get("products", []):
            prices = prod.get("totalPrice") or []
            # BILLC = price in the account's billing currency.
            chosen = next((x for x in prices if x.get("currencyType") == "BILLC"), prices[0] if prices else None)
            amount = _dec(chosen and chosen.get("price"))
            if amount is None:
                continue
            days = (prod.get("deliveryCapabilities") or {}).get("totalTransitDays")
            days = int(days) if str(days or "").isdigit() else None
            out.append(LiveQuote(prod.get("productCode", ""), prod.get("productName", "DHL Express"), amount, chosen.get("priceCurrency", "USD"), days, days))
        return out

    def book(self, shipment, dest, weight_grams, service_code, dims=None):
        o, p = origin(), parcel_for(weight_grams, dims)
        order = shipment.order
        international = o["country"].upper() != dest["country"].upper()

        def party(a, name, phone, email):
            return {
                "postalAddress": {
                    "postalCode": a.get("postal_code", ""), "cityName": a.get("city", ""), "countryCode": a["country"],
                    "addressLine1": a.get("line1", "") or "-", **({"addressLine2": a["line2"]} if a.get("line2") else {}),
                },
                "contactInformation": {"email": email or "", "phone": phone or "0", "companyName": name or "-", "fullName": name or "-"},
            }

        body = {
            "plannedShippingDateAndTime": (date.today() + timedelta(days=1)).isoformat() + "T12:00:00 GMT+00:00",
            "pickup": {"isRequested": False},
            "productCode": service_code,
            "accounts": [{"typeCode": "shipper", "number": settings.DHL_EXPRESS_ACCOUNT}],
            "customerDetails": {
                "shipperDetails": party(o, o["name"], o["phone"], o["email"]),
                "receiverDetails": party(dest, dest.get("recipient_name"), dest.get("phone"), order.contact_email),
            },
            "content": {
                "packages": [{"weight": float(p["kg"]), "dimensions": {"length": p["l"], "width": p["w"], "height": p["h"]}}],
                "isCustomsDeclarable": international,
                "declaredValue": float(order.subtotal), "declaredValueCurrency": order.currency,
                "description": f"Order {order.number}", "unitOfMeasurement": "metric",
                **({"exportDeclaration": {"lineItems": [
                    {"number": i + 1, "description": it.product_name[:70], "price": float(it.unit_price), "quantity": {"value": it.quantity, "unitOfMeasurement": "PCS"},
                     "manufacturerCountry": o["country"], "weight": {"netValue": float(p["kg"]), "grossValue": float(p["kg"])}}
                    for i, it in enumerate(order.items.all())], "invoice": {"number": order.number, "date": date.today().isoformat()}}} if international else {}),
            },
            "outputImageProperties": {"imageOptions": [{"typeCode": "label", "templateName": "ECOM26_84_A4_001"}], "encodingFormat": "pdf"},
        }
        data = self._request("POST", f"{self.base}/shipments", json=body, auth=self._auth())
        docs = data.get("documents") or []
        label = next((d for d in docs if d.get("typeCode") == "label"), docs[0] if docs else None)
        if not data.get("shipmentTrackingNumber") or not label:
            raise CarrierError("DHL did not return a tracking number and label.")
        return Booking(data["shipmentTrackingNumber"], base64.b64decode(label["content"]), "pdf", data.get("dispatchConfirmationNumber", ""))


# =================================================================================================================
# FedEx
# =================================================================================================================
class FedEx(LiveCarrier):
    code = "fedex"
    label = "FedEx"
    _token = {"value": "", "exp": 0.0}

    @property
    def base(self):
        return "https://apis-sandbox.fedex.com" if settings.CARRIER_SANDBOX else "https://apis.fedex.com"

    def configured(self):
        return bool(settings.FEDEX_CLIENT_ID and settings.FEDEX_CLIENT_SECRET and settings.FEDEX_ACCOUNT)

    def _headers(self):
        tok = FedEx._token
        if tok["exp"] < time.time() + 30:
            data = self._request(
                "POST", f"{self.base}/oauth/token",
                data={"grant_type": "client_credentials", "client_id": settings.FEDEX_CLIENT_ID, "client_secret": settings.FEDEX_CLIENT_SECRET},
            )
            tok["value"], tok["exp"] = data.get("access_token", ""), time.time() + int(data.get("expires_in", 3000))
        return {"Authorization": f"Bearer {tok['value']}", "Content-Type": "application/json", "X-locale": "en_US"}

    @staticmethod
    def _addr(a):
        return {"streetLines": [x for x in (a.get("line1"), a.get("line2")) if x] or ["-"], "city": a.get("city", ""),
                "stateOrProvinceCode": (a.get("region") or "")[:2].upper(), "postalCode": a.get("postal_code", ""), "countryCode": a["country"]}

    def rates(self, dest, weight_grams, dims=None):
        o, p = origin(), parcel_for(weight_grams, dims)
        body = {
            "accountNumber": {"value": settings.FEDEX_ACCOUNT},
            "requestedShipment": {
                "shipper": {"address": {"postalCode": o["postal_code"], "countryCode": o["country"], "city": o["city"]}},
                "recipient": {"address": {"postalCode": dest.get("postal_code", ""), "countryCode": dest["country"], "city": dest.get("city", "")}},
                "pickupType": "DROPOFF_AT_FEDEX_LOCATION", "rateRequestType": ["ACCOUNT"],
                "requestedPackageLineItems": [{
                    "weight": {"units": "KG", "value": float(p["kg"])},
                    "dimensions": {"length": p["l"], "width": p["w"], "height": p["h"], "units": "CM"},
                }],
            },
        }
        data = self._request("POST", f"{self.base}/rate/v1/rates/quotes", json=body, headers=self._headers())
        out = []
        for det in (data.get("output") or {}).get("rateReplyDetails", []):
            shipment_rates = det.get("ratedShipmentDetails") or []
            if not shipment_rates:
                continue
            amount = _dec(shipment_rates[0].get("totalNetCharge"))
            if amount is None:
                continue
            out.append(LiveQuote(det.get("serviceType", ""), det.get("serviceName", "FedEx"), amount, shipment_rates[0].get("currency", "USD")))
        return out

    def book(self, shipment, dest, weight_grams, service_code, dims=None):
        o, p = origin(), parcel_for(weight_grams, dims)
        order = shipment.order
        international = o["country"].upper() != dest["country"].upper()
        body = {
            "labelResponseOptions": "LABEL",
            "accountNumber": {"value": settings.FEDEX_ACCOUNT},
            "requestedShipment": {
                "shipper": {"contact": {"personName": o["name"], "phoneNumber": o["phone"] or "0000000000"}, "address": self._addr(o)},
                "recipients": [{"contact": {"personName": dest.get("recipient_name", "-"), "phoneNumber": dest.get("phone") or "0000000000"}, "address": self._addr(dest)}],
                "shipDatestamp": date.today().isoformat(), "serviceType": service_code, "packagingType": "YOUR_PACKAGING",
                "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
                "shippingChargesPayment": {"paymentType": "SENDER"},
                "labelSpecification": {"imageType": "PDF", "labelStockType": "PAPER_85X11_TOP_HALF_LABEL"},
                "requestedPackageLineItems": [{"weight": {"units": "KG", "value": float(p["kg"])}}],
                **({"customsClearanceDetail": {
                    "dutiesPayment": {"paymentType": "RECIPIENT"},
                    "commodities": [{"description": it.product_name[:90], "countryOfManufacture": o["country"], "quantity": it.quantity, "quantityUnits": "PCS",
                                     "unitPrice": {"amount": float(it.unit_price), "currency": order.currency},
                                     "customsValue": {"amount": float(it.line_total), "currency": order.currency},
                                     "weight": {"units": "KG", "value": float(p["kg"])}} for it in order.items.all()],
                }} if international else {}),
            },
        }
        data = self._request("POST", f"{self.base}/ship/v1/shipments", json=body, headers=self._headers())
        try:
            ts = data["output"]["transactionShipments"][0]
            number = ts["masterTrackingNumber"]
            label = ts["pieceResponses"][0]["packageDocuments"][0]["encodedLabel"]
        except (KeyError, IndexError, TypeError):
            raise CarrierError("FedEx did not return a tracking number and label.")
        return Booking(number, base64.b64decode(label), "pdf")

    STATUS_MAP = {"PU": "in_transit", "IT": "in_transit", "OD": "out_for_delivery", "DL": "delivered", "DE": "exception", "SE": "exception", "OC": "assigned"}

    def tracking(self, shipment):
        data = self._request(
            "POST", f"{self.base}/track/v1/trackingnumbers", headers=self._headers(),
            json={"includeDetailedScans": True, "trackingInfo": [{"trackingNumberInfo": {"trackingNumber": shipment.tracking_number}}]},
        )
        try:
            scans = data["output"]["completeTrackResults"][0]["trackResults"][0].get("scanEvents", [])
        except (KeyError, IndexError, TypeError):
            return []
        out = []
        for sc in scans:
            status = self.STATUS_MAP.get(sc.get("eventType", ""))
            when = parse_datetime(sc.get("date", "") or "")
            if not status or not when:
                continue
            desc = sc.get("eventDescription", "")
            loc = (sc.get("scanLocation") or {}).get("city", "")
            out.append({"status": status, "description": desc[:255], "location": loc[:150], "occurred_at": when,
                        "external_id": hashlib.sha1(f"{shipment.tracking_number}|{sc.get('date')}|{desc}".encode()).hexdigest()[:40]})
        return out


# =================================================================================================================
# UPS
# =================================================================================================================
class UPS(LiveCarrier):
    code = "ups"
    label = "UPS"
    _token = {"value": "", "exp": 0.0}
    SERVICE_NAMES = {
        "07": "UPS Worldwide Express", "08": "UPS Worldwide Expedited", "11": "UPS Standard", "54": "UPS Worldwide Express Plus",
        "65": "UPS Worldwide Saver", "02": "UPS 2nd Day Air", "03": "UPS Ground", "01": "UPS Next Day Air",
    }

    @property
    def base(self):
        return "https://wwwcie.upsapis.com" if settings.CARRIER_SANDBOX else "https://onlinetools.ups.com"

    def configured(self):
        return bool(settings.UPS_CLIENT_ID and settings.UPS_CLIENT_SECRET and settings.UPS_ACCOUNT)

    def _headers(self):
        tok = UPS._token
        if tok["exp"] < time.time() + 30:
            data = self._request(
                "POST", f"{self.base}/security/v1/oauth/token", data={"grant_type": "client_credentials"},
                auth=(settings.UPS_CLIENT_ID, settings.UPS_CLIENT_SECRET), headers={"x-merchant-id": settings.UPS_CLIENT_ID},
            )
            tok["value"], tok["exp"] = data.get("access_token", ""), time.time() + int(data.get("expires_in", 3000))
        return {"Authorization": f"Bearer {tok['value']}", "Content-Type": "application/json", "transId": "mpanko", "transactionSrc": "mpanko"}

    @staticmethod
    def _addr(a):
        return {"AddressLine": [x for x in (a.get("line1"), a.get("line2")) if x] or ["-"], "City": a.get("city", ""),
                "StateProvinceCode": (a.get("region") or "")[:2].upper(), "PostalCode": a.get("postal_code", ""), "CountryCode": a["country"]}

    def _shipment_block(self, dest, p, service_code=None):
        o = origin()
        block = {
            "Shipper": {"Name": o["name"], "ShipperNumber": settings.UPS_ACCOUNT, "Address": self._addr(o)},
            "ShipTo": {"Name": dest.get("recipient_name", "-"), "Address": self._addr(dest)},
            "ShipFrom": {"Name": o["name"], "Address": self._addr(o)},
            "Package": [{
                "PackagingType": {"Code": "02"},
                "Dimensions": {"UnitOfMeasurement": {"Code": "CM"}, "Length": str(p["l"]), "Width": str(p["w"]), "Height": str(p["h"])},
                "PackageWeight": {"UnitOfMeasurement": {"Code": "KGS"}, "Weight": str(p["kg"])},
            }],
        }
        if service_code:
            block["Service"] = {"Code": service_code}
        return block

    def rates(self, dest, weight_grams, dims=None):
        p = parcel_for(weight_grams, dims)
        block = self._shipment_block(dest, p)
        block["ShipmentRatingOptions"] = {"NegotiatedRatesIndicator": "Y"}
        body = {"RateRequest": {"Request": {"RequestOption": "Shop"}, "Shipment": block}}
        data = self._request("POST", f"{self.base}/api/rating/v2409/Shop", json=body, headers=self._headers())
        out = []
        rated = (data.get("RateResponse") or {}).get("RatedShipment", [])
        if isinstance(rated, dict):
            rated = [rated]
        for r in rated:
            charge = (r.get("NegotiatedRateCharges") or {}).get("TotalCharge") or r.get("TotalCharges") or {}
            amount = _dec(charge.get("MonetaryValue"))
            if amount is None:
                continue
            code = (r.get("Service") or {}).get("Code", "")
            days = (r.get("GuaranteedDelivery") or {}).get("BusinessDaysInTransit")
            days = int(days) if str(days or "").isdigit() else None
            out.append(LiveQuote(code, self.SERVICE_NAMES.get(code, f"UPS service {code}"), amount, charge.get("CurrencyCode", "USD"), days, days))
        return out

    def book(self, shipment, dest, weight_grams, service_code, dims=None):
        p = parcel_for(weight_grams, dims)
        o = origin()
        block = self._shipment_block(dest, p, service_code)
        block["Description"] = f"Order {shipment.order.number}"
        block["PaymentInformation"] = {"ShipmentCharge": {"Type": "01", "BillShipper": {"AccountNumber": settings.UPS_ACCOUNT}}}
        block["Shipper"]["Phone"] = {"Number": o["phone"] or "0000000000"}
        block["ShipTo"]["Phone"] = {"Number": dest.get("phone") or "0000000000"}
        body = {"ShipmentRequest": {"Request": {"RequestOption": "nonvalidate"}, "Shipment": block,
                                    "LabelSpecification": {"LabelImageFormat": {"Code": "GIF"}, "LabelStockSize": {"Height": "6", "Width": "4"}}}}
        data = self._request("POST", f"{self.base}/api/shipments/v2409/ship", json=body, headers=self._headers())
        try:
            results = data["ShipmentResponse"]["ShipmentResults"]
            pkg = results["PackageResults"]
            pkg = pkg[0] if isinstance(pkg, list) else pkg
            number = results["ShipmentIdentificationNumber"]
            label = pkg["ShippingLabel"]["GraphicImage"]
        except (KeyError, IndexError, TypeError):
            raise CarrierError("UPS did not return a tracking number and label.")
        return Booking(number, base64.b64decode(label), "gif")

    STATUS_MAP = {"M": "assigned", "I": "in_transit", "D": "delivered", "X": "exception", "P": "in_transit", "O": "out_for_delivery"}

    def tracking(self, shipment):
        data = self._request("GET", f"{self.base}/api/track/v1/details/{shipment.tracking_number}", headers=self._headers(), params={"locale": "en_US"})
        try:
            activity = data["trackResponse"]["shipment"][0]["package"][0].get("activity", [])
        except (KeyError, IndexError, TypeError):
            return []
        out = []
        for a in activity:
            status = self.STATUS_MAP.get((a.get("status") or {}).get("type", ""))
            raw = f"{a.get('date', '')}{a.get('time', '')}"
            try:
                from datetime import datetime, timezone as tz
                when = datetime.strptime(raw, "%Y%m%d%H%M%S").replace(tzinfo=tz.utc)
            except ValueError:
                continue
            if not status:
                continue
            desc = (a.get("status") or {}).get("description", "")
            loc = ((a.get("location") or {}).get("address") or {}).get("city", "")
            out.append({"status": status, "description": desc[:255], "location": loc[:150], "occurred_at": when,
                        "external_id": hashlib.sha1(f"{shipment.tracking_number}|{raw}|{desc}".encode()).hexdigest()[:40]})
        return out


LIVE_CARRIERS = {c.code: c for c in (DHLExpress(), FedEx(), UPS())}


def active_carriers():
    """Carriers with credentials AND an active Carrier row with the matching provider code."""
    from .models import Carrier

    enabled = set(Carrier.objects.filter(is_active=True).values_list("provider", flat=True))
    return [c for code, c in LIVE_CARRIERS.items() if code in enabled and c.configured()]

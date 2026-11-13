from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.orders import pricing
from apps.payments.providers import chargeable_currencies

from . import catalog
from .services import refresh_if_stale


class RatesView(APIView):
    """Public rates for display (price display in the customer's currency). Checkout always recomputes server-side."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        refresh_if_stale()
        base = settings.BASE_CURRENCY.upper()
        rates, notes = {base: "1"}, {}
        for code in sorted(set(catalog.supported()) - {base}):
            try:
                rates[code] = pricing.plain(pricing.rate(code))
                notes[code] = pricing.fx_note(code)
            except pricing.PricingError:
                continue
        return Response({
            "base": base, "rates": rates, "notes": notes, "currencies": sorted(rates),
            "names": {c: catalog.name(c) for c in rates},
            "chargeable": sorted(chargeable_currencies()),
        })

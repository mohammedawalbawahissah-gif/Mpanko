"""Turn the products in an order into one parcel: real weight, packed box, billable weight and a dangerous-goods flag."""
import math
from dataclasses import dataclass

from django.conf import settings


@dataclass
class Parcel:
    actual_grams: int
    chargeable_grams: int  # larger of real and volumetric weight; what carriers bill and rate tables use
    dims_cm: tuple | None  # (length, width, height) of the packed box, or None if any product is unmeasured
    dangerous: bool

    @property
    def volumetric_applied(self):
        return self.chargeable_grams > self.actual_grams


def from_lines(lines):
    """`lines` is an iterable of (product, quantity)."""
    lines = [(p, q) for p, q in lines if q]
    actual = sum(p.weight_grams * q for p, q in lines)
    dangerous = any(p.is_dangerous_goods for p, _ in lines)
    dims = None
    if lines and all(p.length_mm and p.width_mm and p.height_mm for p, _ in lines):
        # Stack the units: the box is as long and wide as the biggest item and as tall as all of them together.
        length = max(p.length_mm for p, _ in lines)
        width = max(p.width_mm for p, _ in lines)
        height = sum(p.height_mm * q for p, q in lines)
        dims = tuple(max(1, math.ceil(v / 10)) for v in (length, width, height))
    chargeable = actual
    if dims:
        volumetric = dims[0] * dims[1] * dims[2] / settings.VOLUMETRIC_DIVISOR * 1000
        chargeable = max(actual, math.ceil(volumetric))
    return Parcel(actual, chargeable, dims, dangerous)

from django.conf import settings
from django.db import models


class Coupon(models.Model):
    """A discount code (S1-02). Money fields are in the store's base currency and converted at checkout."""

    class Kind(models.TextChoices):
        PERCENT = "percent", "Percent off items"
        FIXED = "fixed", "Fixed amount off items"
        FREE_SHIPPING = "free_shipping", "Free shipping"

    code = models.CharField(max_length=40, unique=True, help_text="Customers type this. Saved in capitals.")
    description = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=14, choices=Kind.choices)
    value = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Percent (1-100) or amount in the base currency. Unused for free shipping.")
    min_subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Smallest item total (base currency) the code applies to")
    max_discount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Cap for percent codes (base currency)")
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.PositiveIntegerField(null=True, blank=True, help_text="Total uses allowed. Blank = unlimited")
    per_user_limit = models.PositiveIntegerField(null=True, blank=True, default=1, help_text="Uses per customer. Blank = unlimited")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.code


class CouponRedemption(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    order = models.OneToOneField("orders.Order", on_delete=models.CASCADE, related_name="redemption")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    amount = models.DecimalField(max_digits=12, decimal_places=2, help_text="Discount in the order's currency")
    created_at = models.DateTimeField(auto_now_add=True)

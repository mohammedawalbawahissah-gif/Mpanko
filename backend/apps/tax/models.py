from django.db import models


class TaxRule(models.Model):
    """Sales tax / VAT we charge for orders going to a country (FR-TAX-01). Country "*" is the rule for everywhere else."""

    country = models.CharField(max_length=2, unique=True, help_text='ISO 2-letter code, or "*" for every country without its own rule')
    name = models.CharField(max_length=60, default="VAT")
    rate = models.DecimalField(max_digits=6, decimal_places=4, help_text="0.1250 means 12.5%. Use 0 for zero-rated exports.")
    applies_to_shipping = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["country"]

    def __str__(self):
        return f"{self.country} {self.name} {self.rate}"


class DutyRule(models.Model):
    """What the buyer is likely to owe on import in a country (FR-CHK-04). An estimate, not a customs declaration."""

    country = models.CharField(max_length=2, unique=True)
    de_minimis = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Goods value (in the store currency) at or below which no duty is charged",
    )
    duty_rate = models.DecimalField(max_digits=6, decimal_places=4, default=0, help_text="Share of goods value, 0.0500 = 5%")
    import_vat_rate = models.DecimalField(max_digits=6, decimal_places=4, default=0, help_text="VAT/GST charged on goods + duty at import")
    note = models.CharField(max_length=200, blank=True, help_text="Shown to the buyer, e.g. who collects it")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["country"]

    def __str__(self):
        return f"{self.country} duty {self.duty_rate}"

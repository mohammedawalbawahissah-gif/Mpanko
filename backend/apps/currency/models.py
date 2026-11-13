from django.db import models


class ExchangeRate(models.Model):
    """
    Units of `quote` per 1 unit of `base`, with the time it applies from (FR-CUR-02).
    source="manual" rows are set by the owner and always win over "live" rows fetched from the provider.
    """

    class Source(models.TextChoices):
        LIVE = "live", "Live provider"
        MANUAL = "manual", "Manual (owner-set)"

    base = models.CharField(max_length=3)
    quote = models.CharField(max_length=3)
    rate = models.DecimalField(max_digits=18, decimal_places=6)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.LIVE)
    fetched_at = models.DateTimeField()

    class Meta:
        ordering = ["-fetched_at"]
        indexes = [models.Index(fields=["base", "quote", "source", "-fetched_at"])]

    def __str__(self):
        return f"1 {self.base} = {self.rate} {self.quote} ({self.source})"

from django.conf import settings
from django.db import models


class ConsentRecord(models.Model):
    """Proof of what a customer agreed to, and which version of the text they saw (CMP-02)."""

    class Kind(models.TextChoices):
        TERMS = "terms", "Terms of sale"
        PRIVACY = "privacy", "Privacy policy"
        MARKETING = "marketing", "Marketing emails"
        COOKIES = "cookies", "Cookie notice"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consents")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    granted = models.BooleanField()
    version = models.PositiveIntegerField(default=1, help_text="Version of the policy text at the time")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class LegalPage(models.Model):
    """Policy and content pages the owner edits in the admin (CMP-01, DM-08). Each save raises the version."""

    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=150)
    body = models.TextField(help_text="Plain text. A blank line starts a new paragraph; a line starting with # is a heading.")
    version = models.PositiveIntegerField(default=1)
    is_published = models.BooleanField(default=False, help_text="Off = shoppers see the draft notice")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    def __str__(self):
        return self.slug

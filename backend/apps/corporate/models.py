from django.conf import settings
from django.core.validators import URLValidator
from django.db import models
from django.utils.text import slugify


def _web_url(value):
    URLValidator(schemes=["http", "https"])(value)


class SiteProfile(models.Model):
    """The company's own details, shown on the corporate website. Exactly one row (pk 1)."""

    company_name = models.CharField(max_length=120, default="Mpanko")
    tagline = models.CharField(max_length=160, blank=True, default="Rooted in Africa. Made for the World.")
    intro = models.CharField(
        max_length=300, blank=True, default="We run businesses that bring well-made African products and services to customers in more than one country.",
        help_text="One or two sentences under the headline on the home page.")
    about = models.TextField(
        blank=True, help_text="Who we are. Leave a blank line between paragraphs.",
        default="We started with one idea: good things made in Africa should be easy to buy from anywhere. Today we run more than one business, each with its own team and its own customers.\n\nOur head office is in Tamale, Ghana. We work with partners who handle shipping and payment in each country we serve.")
    contact_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    address = models.CharField(max_length=240, blank=True)
    linkedin_url = models.URLField(blank=True, validators=[_web_url])
    instagram_url = models.URLField(blank=True, validators=[_web_url])
    facebook_url = models.URLField(blank=True, validators=[_web_url])
    x_url = models.URLField(blank=True, validators=[_web_url])
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "site profile"

    def save(self, *args, **kwargs):
        self.pk = 1  # a single profile
        super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.company_name


class Business(models.Model):
    """One of the client's businesses, listed on the corporate website."""

    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    sector = models.CharField(max_length=80, blank=True, help_text="For example Retail, Health, Agriculture.")
    tagline = models.CharField(max_length=160, blank=True)
    summary = models.CharField(max_length=300, blank=True, help_text="Shown in the list of businesses.")
    description = models.TextField(blank=True, help_text="Shown on the business's own page. Leave a blank line between paragraphs.")
    location = models.CharField(max_length=120, blank=True)
    website_url = models.URLField(blank=True, validators=[_web_url], help_text="Where the visitor goes to use the business, for example the shop.")
    logo = models.ImageField(upload_to="corporate/", blank=True)
    logo_alt = models.CharField(max_length=160, blank=True)
    is_published = models.BooleanField(default=False)
    is_featured = models.BooleanField(default=False, help_text="Featured businesses are listed first on the home page.")
    sort_order = models.PositiveIntegerField(default=100, help_text="Lower numbers come first.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "businesses"

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:120] or "business"
            slug, n = base, 2
            while Business.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ContactMessage(models.Model):
    """An enquiry sent from the corporate website's contact form."""

    class Status(models.TextChoices):
        NEW = "new", "New"
        HANDLED = "handled", "Handled"

    name = models.CharField(max_length=120)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True)
    business = models.ForeignKey(Business, null=True, blank=True, on_delete=models.SET_NULL, related_name="messages")
    message = models.TextField(max_length=4000)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW, db_index=True)
    staff_note = models.TextField(blank=True, max_length=2000)
    handled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    handled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} <{self.email}>"

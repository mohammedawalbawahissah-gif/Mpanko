from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.utils.text import slugify


class Category(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ProductStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class Product(models.Model):
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    description = models.TextField(blank=True)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    origin_country = models.CharField(max_length=2, blank=True, help_text="Country the product is made in, e.g. GH")
    maker = models.CharField(max_length=150, blank=True, help_text="Artisan / brand story shown on the product page")
    base_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    currency = models.CharField(max_length=3, default=settings.BASE_CURRENCY)
    status = models.CharField(max_length=10, choices=ProductStatus.choices, default=ProductStatus.DRAFT)
    weight_grams = models.PositiveIntegerField(default=0)
    # Shipping restrictions (FR-SHP-09): empty list = no restriction
    restricted_countries = models.JSONField(default=list, blank=True, help_text='e.g. ["KP", "IR"]')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or "product"
            slug, n = base, 2
            while Product.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)

    def can_ship_to(self, country_code):
        return (country_code or "").upper() not in {c.upper() for c in (self.restricted_countries or [])}

    def __str__(self):
        return self.name


class ProductImage(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="products/")
    alt_text = models.CharField(max_length=200, blank=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]


class ProductVariant(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    sku = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=150, blank=True, help_text="e.g. 'Large / Indigo'")
    attributes = models.JSONField(default=dict, blank=True)
    price_override = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0.00"))]
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]

    @property
    def price(self):
        return self.price_override if self.price_override is not None else self.product.base_price

    def __str__(self):
        return f"{self.product.name} [{self.sku}]"


class Inventory(models.Model):
    variant = models.OneToOneField(ProductVariant, on_delete=models.CASCADE, related_name="inventory")
    quantity = models.IntegerField(default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)
    allow_backorder = models.BooleanField(default=False)

    class Meta:
        verbose_name_plural = "inventory"

    @property
    def is_low(self):
        return self.quantity <= self.low_stock_threshold

    def __str__(self):
        return f"{self.variant.sku}: {self.quantity}"


class StockMovement(models.Model):
    """Every change to stock is recorded with a reason and actor (FR-CAT-03)."""

    class Reason(models.TextChoices):
        RESTOCK = "restock", "Restock"
        ADJUSTMENT = "adjustment", "Manual adjustment"
        ORDER = "order", "Order placed"
        ORDER_RELEASE = "order_release", "Order cancelled / expired"
        RETURN = "return", "Customer return"

    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="movements")
    delta = models.IntegerField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    order_ref = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class OutOfStock(Exception):
    def __init__(self, sku):
        super().__init__(f"Insufficient stock for {sku}")
        self.sku = sku


@transaction.atomic
def adjust_stock(variant_id, delta, reason, actor=None, note="", order_ref="", enforce=True):
    """
    Concurrency-safe stock change. Locks the inventory row so parallel checkouts cannot oversell
    (FR-CAT-04). Raises OutOfStock if `enforce` and the result would be negative without backorder.
    """
    inv = Inventory.objects.select_for_update().select_related("variant").get(variant_id=variant_id)
    new_qty = inv.quantity + delta
    if enforce and new_qty < 0 and not inv.allow_backorder:
        raise OutOfStock(inv.variant.sku)
    inv.quantity = new_qty
    inv.save(update_fields=["quantity"])
    StockMovement.objects.create(
        variant_id=variant_id, delta=delta, reason=reason, actor=actor, note=note, order_ref=order_ref
    )
    return inv

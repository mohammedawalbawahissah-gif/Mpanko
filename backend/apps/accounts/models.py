from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    CUSTOMER = "customer", "Customer"
    SUPER_ADMIN = "super_admin", "Super administrator"
    STORE_ADMIN = "store_admin", "Store administrator"
    FULFILLMENT = "fulfillment", "Order / fulfillment staff"
    FINANCE = "finance", "Finance staff"
    SUPPORT = "support", "Support staff"
    CARRIER = "carrier", "Carrier partner user"


STAFF_ROLES = {Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.FULFILLMENT, Role.FINANCE, Role.SUPPORT}


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("role", Role.CUSTOMER)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", Role.SUPER_ADMIN)
        extra["is_staff"] = True
        extra["is_superuser"] = True
        return self._create(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    phone_verified = models.BooleanField(default=False, help_text="Number confirmed by an SMS code; allows phone sign-in and SMS updates")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CUSTOMER)
    email_verified = models.BooleanField(default=False)
    marketing_opt_in = models.BooleanField(default=False)
    notify_order_emails = models.BooleanField(default=True, help_text="Order and shipping updates by email")
    notify_sms = models.BooleanField(default=False)
    notify_push = models.BooleanField(default=False)
    preferred_currency = models.CharField(max_length=3, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin access
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["phone"], condition=models.Q(phone_verified=True), name="uniq_verified_phone")
        ]

    def __str__(self):
        return self.email

    @property
    def is_staff_role(self):
        return self.role in STAFF_ROLES


class Address(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, blank=True)
    recipient_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=32)
    line1 = models.CharField(max_length=255)
    line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100)
    region = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=2, help_text="ISO 3166-1 alpha-2")
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_default", "-created_at"]
        verbose_name_plural = "addresses"

    def __str__(self):
        return f"{self.recipient_name}, {self.city}, {self.country}"

    def snapshot(self):
        return {
            "recipient_name": self.recipient_name,
            "phone": self.phone,
            "line1": self.line1,
            "line2": self.line2,
            "city": self.city,
            "region": self.region,
            "postal_code": self.postal_code,
            "country": self.country,
        }

    def save(self, *args, **kwargs):
        self.country = (self.country or "").upper()
        super().save(*args, **kwargs)
        if self.is_default:
            Address.objects.filter(user=self.user).exclude(pk=self.pk).update(is_default=False)


class AuditLog(models.Model):
    """Append-only record of privileged actions (FR-ADM-04)."""

    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=100)
    object_type = models.CharField(max_length=100, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @classmethod
    def record(cls, actor, action, obj=None, **detail):
        return cls.objects.create(
            actor=actor if getattr(actor, "pk", None) else None,
            action=action,
            object_type=obj.__class__.__name__ if obj is not None else "",
            object_id=str(getattr(obj, "pk", "")) if obj is not None else "",
            detail=detail,
        )


class TOTPDevice(models.Model):
    """Authenticator-app second factor for staff accounts (FR-AUTH-06)."""

    MAX_FAILURES = 5
    LOCK_MINUTES = 5

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="totp_device")
    secret = models.CharField(max_length=64)
    confirmed = models.BooleanField(default=False)
    last_used_step = models.BigIntegerField(default=0, help_text="Last accepted 30s time step; blocks code replay")
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class PhoneOTP(models.Model):
    """A one-time SMS code, stored only as a hash. Used to verify a phone number and to sign in with it."""

    class Purpose(models.TextChoices):
        VERIFY = "verify", "Verify number"
        LOGIN = "login", "Sign in"

    phone = models.CharField(max_length=20, db_index=True, help_text="E.164, e.g. +233240000000")
    purpose = models.CharField(max_length=10, choices=Purpose.choices)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

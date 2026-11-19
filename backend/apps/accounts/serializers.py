import hashlib
import re

from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.models import update_last_login
from django.core.cache import cache
from rest_framework import exceptions, serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenObtainSerializer

from . import address_rules, mfa, phone as phone_utils
from .models import STAFF_ROLES, Address, User


class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField()  # declared so the model's unique-email check does not reveal who is registered
    password = serializers.CharField(write_only=True, min_length=8)
    accept_terms = serializers.BooleanField(write_only=True)
    marketing_opt_in = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = User
        fields = ("id", "email", "password", "full_name", "phone", "accept_terms", "marketing_opt_in")

    def validate_accept_terms(self, value):
        if not value:
            raise serializers.ValidationError("Please accept the terms and privacy policy to create an account.")
        return value

    def validate_email(self, value):
        # Whether this address already has an account is deliberately not revealed here; RegisterView handles it.
        return value.lower()

    def validate(self, attrs):
        password_validation.validate_password(attrs["password"], User(email=attrs["email"]))
        return attrs

    def create(self, validated_data):
        # Public registration can only ever create customers.
        validated_data.pop("accept_terms")
        user = User.objects.create_user(**validated_data)
        from apps.privacy.services import record_consent

        record_consent(user, "terms", True)
        record_consent(user, "privacy", True)
        if user.marketing_opt_in:
            record_consent(user, "marketing", True)
        return user


class UserSerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "phone", "role", "email_verified", "marketing_opt_in", "notify_order_emails", "notify_sms", "notify_whatsapp", "notify_push", "preferred_currency", "mfa_enabled", "phone_verified")
        read_only_fields = ("id", "email", "role", "email_verified", "phone_verified")

    def validate_phone(self, value):
        value = value.strip()
        if value and not re.fullmatch(r"\+?[0-9 ()\-]{7,20}", value):
            raise serializers.ValidationError("Enter a valid phone number, for example +233 24 000 0000.")
        return value

    def update(self, instance, validated_data):
        # Valid numbers are stored in international form. Changing the number un-verifies it: a code must prove
        # the new one belongs to this person; re-saving the same number in another format keeps it verified.
        if "phone" in validated_data:
            canonical = phone_utils.normalize(validated_data["phone"])
            if canonical:
                validated_data["phone"] = canonical
            if validated_data["phone"] != instance.phone:
                validated_data["phone_verified"] = False
        return super().update(instance, validated_data)

    def validate_preferred_currency(self, value):
        from apps.currency import catalog

        value = value.upper()
        if value and value not in catalog.supported():
            raise serializers.ValidationError("Choose a currency from the list.")
        return value

    def get_mfa_enabled(self, obj) -> bool:
        return mfa.has_confirmed_device(obj)


def tokens_for(user):
    refresh = TokenObtainPairSerializer.get_token(user)
    refresh["role"] = user.role
    update_last_login(None, user)
    return {"refresh": str(refresh), "access": str(refresh.access_token), "user": UserSerializer(user).data}


class MpankoTokenSerializer(TokenObtainSerializer):
    """
    Password step of login. Staff with an authenticator device (or when REQUIRE_STAFF_MFA is on) do NOT receive
    tokens here — only a short-lived ticket that must be exchanged with a valid TOTP code (FR-AUTH-06).
    """

    default_error_messages = {"no_active_account": "Email or password is wrong. Try again, or reset your password."}

    def validate(self, attrs):
        # Per-account lockout, on top of the per-IP throttle: guessing from many addresses still runs into this.
        key = "login-fail:" + hashlib.sha256((attrs.get(self.username_field) or "").strip().lower().encode()).hexdigest()
        if cache.get(key, 0) >= settings.LOGIN_MAX_FAILURES:
            raise exceptions.Throttled(detail="Too many failed attempts. Try again in a few minutes, or reset your password.")
        try:
            super().validate(attrs)  # authenticates and sets self.user; raises on bad credentials
        except exceptions.AuthenticationFailed:
            try:
                cache.add(key, 0, settings.LOGIN_LOCKOUT_SECONDS)
                cache.incr(key)
            except ValueError:
                cache.set(key, 1, settings.LOGIN_LOCKOUT_SECONDS)
            raise
        cache.delete(key)
        user = self.user
        if user.role in STAFF_ROLES:
            if mfa.has_confirmed_device(user):
                return {"mfa_required": True, "mfa_token": mfa.issue_ticket(user, "login")}
            if settings.REQUIRE_STAFF_MFA:
                return {"mfa_enrollment_required": True, "mfa_token": mfa.issue_ticket(user, "enroll")}
        return tokens_for(user)


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        exclude = ("user",)
        read_only_fields = ("id", "created_at")

    def validate_country(self, value):
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a 2-letter ISO country code, e.g. GH or US.")
        if not address_rules.is_country(value):
            raise serializers.ValidationError("That is not a recognised country code.")
        return value.upper()

    def validate_phone(self, value):
        value = value.strip()
        if not re.fullmatch(r"\+?[0-9 ()\-]{7,20}", value):
            raise serializers.ValidationError("Enter a valid phone number for the carrier to reach the recipient.")
        return value

    def validate(self, attrs):
        merged = {f: attrs.get(f, getattr(self.instance, f, "")) for f in ("country", "postal_code", "region")}
        errors, postal = address_rules.check(merged)
        if errors:
            raise serializers.ValidationError(errors)
        if "postal_code" in attrs or merged["postal_code"]:
            attrs["postal_code"] = postal
        return attrs


class UidTokenSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(UidTokenSerializer):
    new_password = serializers.CharField(min_length=8, write_only=True)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(min_length=8, write_only=True)


class CodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=10)
    mfa_token = serializers.CharField(required=False)


class MfaLoginSerializer(serializers.Serializer):
    mfa_token = serializers.CharField()
    code = serializers.CharField(max_length=10)


class PhoneSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)


class PhoneCodeSerializer(PhoneSerializer):
    code = serializers.CharField(max_length=10)

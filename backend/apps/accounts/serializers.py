from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.models import update_last_login
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenObtainSerializer

from . import mfa
from .models import STAFF_ROLES, Address, User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("id", "email", "password", "full_name", "phone")

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        password_validation.validate_password(attrs["password"], User(email=attrs["email"]))
        return attrs

    def create(self, validated_data):
        # Public registration can only ever create customers.
        return User.objects.create_user(**validated_data)


class UserSerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "phone", "role", "email_verified", "marketing_opt_in", "mfa_enabled")
        read_only_fields = ("id", "email", "role", "email_verified")

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

    def validate(self, attrs):
        super().validate(attrs)  # authenticates and sets self.user; raises on bad credentials
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
        return value.upper()


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

from django.contrib.auth import password_validation
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.views import TokenObtainPairView

from . import address_rules, mfa, phone as phone_utils
from .models import Address, AuditLog, User
from .serializers import (
    AddressSerializer, ChangePasswordSerializer, CodeSerializer, MfaLoginSerializer, MpankoTokenSerializer,
    PasswordResetConfirmSerializer, PasswordResetRequestSerializer, PhoneCodeSerializer, PhoneSerializer, RegisterSerializer, UidTokenSerializer,
    UserSerializer, tokens_for,
)
from .tasks import send_password_reset_email, send_verification_email
from .tokens import email_verification_token


class AuthThrottled:
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class RegisterView(AuthThrottled, generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def perform_create(self, serializer):
        user = serializer.save()
        transaction.on_commit(lambda: send_verification_email.delay(user.pk))


class LoginView(AuthThrottled, TokenObtainPairView):
    serializer_class = MpankoTokenSerializer


def _user_from_uid(uid):
    try:
        return User.objects.filter(pk=force_str(urlsafe_base64_decode(uid))).first()
    except (ValueError, TypeError, OverflowError):
        return None


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        before = self.request.user.marketing_opt_in
        user = serializer.save()
        if user.marketing_opt_in != before:
            from apps.privacy.services import record_consent

            record_consent(user, "marketing", user.marketing_opt_in)


class AddressViewSet(viewsets.ModelViewSet):
    serializer_class = AddressSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Address.objects.none()
        return Address.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


# --- Email verification ---------------------------------------------------------------------------------------

class VerifyEmailRequestView(AuthThrottled, APIView):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if request.user.email_verified:
            return Response({"detail": "Email already verified."})
        send_verification_email.delay(request.user.pk)
        return Response({"detail": "Verification email sent."})


class VerifyEmailConfirmView(AuthThrottled, APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=UidTokenSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = UidTokenSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = _user_from_uid(s.validated_data["uid"])
        if not user or not email_verification_token.check_token(user, s.validated_data["token"]):
            raise ValidationError({"token": "This link is invalid or has expired."})
        user.email_verified = True
        user.save(update_fields=["email_verified"])
        from apps.orders.guest import claim_guest_orders

        claim_guest_orders(user)  # orders placed as a guest with this address now appear in the account
        return Response({"detail": "Email verified."})


# --- Password reset / change ----------------------------------------------------------------------------------

def _revoke_all_sessions(user):
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


class PasswordResetRequestView(AuthThrottled, APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=PasswordResetRequestSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PasswordResetRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=s.validated_data["email"], is_active=True).first()
        if user:
            send_password_reset_email.delay(user.pk)
        # Identical response whether or not the account exists: no user enumeration.
        return Response({"detail": "If an account exists for that email, a reset link has been sent."})


class PasswordResetConfirmView(AuthThrottled, APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=PasswordResetConfirmSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PasswordResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = _user_from_uid(s.validated_data["uid"])
        if not user or not default_token_generator.check_token(user, s.validated_data["token"]):
            raise ValidationError({"token": "This link is invalid or has expired."})
        try:
            password_validation.validate_password(s.validated_data["new_password"], user)
        except Exception as exc:
            raise ValidationError({"new_password": list(getattr(exc, "messages", [str(exc)]))})
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])  # also invalidates the reset token (it hashes the old password)
        _revoke_all_sessions(user)
        return Response({"detail": "Password updated. Please sign in."})


class ChangePasswordView(AuthThrottled, APIView):
    @extend_schema(request=ChangePasswordSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = ChangePasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if not request.user.check_password(s.validated_data["current_password"]):
            raise ValidationError({"current_password": "Incorrect password."})
        try:
            password_validation.validate_password(s.validated_data["new_password"], request.user)
        except Exception as exc:
            raise ValidationError({"new_password": list(getattr(exc, "messages", [str(exc)]))})
        request.user.set_password(s.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        _revoke_all_sessions(request.user)
        return Response({"detail": "Password changed. Please sign in again."})


# --- MFA ------------------------------------------------------------------------------------------------------

def _mfa_user(request, purposes):
    """The signed-in user, or the user named by a valid password-step ticket."""
    if request.user and request.user.is_authenticated:
        return request.user
    user = mfa.read_ticket(request.data.get("mfa_token", ""), purposes)
    if not user:
        raise AuthenticationFailed("Sign in again to continue.")
    return user


class MfaLoginView(AuthThrottled, APIView):
    """Second step of staff login: exchange ticket + authenticator code for tokens."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(request=MfaLoginSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = MfaLoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = mfa.read_ticket(s.validated_data["mfa_token"], {"login"})
        if not user:
            raise AuthenticationFailed("Sign in again to continue.")
        used = mfa.verify_second_factor(user, s.validated_data["code"])
        if not used:
            raise AuthenticationFailed("Invalid or expired code.")
        body = tokens_for(user)
        if used == "backup":
            AuditLog.record(user, "mfa.backup_code_used", user)
            body["backup_codes_left"] = mfa.backup_codes_left(user)
        return Response(body)


class MfaSetupView(AuthThrottled, APIView):
    """Begin enrolment. Returns the secret and an otpauth:// URI to render as a QR code."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        user = _mfa_user(request, {"enroll"})
        if user.role not in {"super_admin", "store_admin", "fulfillment", "finance", "support"}:
            raise ValidationError({"detail": "MFA is for staff accounts."})
        if mfa.has_confirmed_device(user) and not (request.user and request.user.is_authenticated):
            raise ValidationError({"detail": "MFA is already enabled."})
        _device, secret, uri = mfa.start_enrolment(user)
        return Response({"secret": secret, "otpauth_uri": uri})


class MfaConfirmView(AuthThrottled, APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=CodeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = CodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = _mfa_user(request, {"enroll"})
        device = getattr(user, "totp_device", None)
        if not device:
            raise ValidationError({"detail": "Start MFA setup first."})
        if not mfa.verify_code(user, s.validated_data["code"]):
            raise ValidationError({"code": "That code is not correct. Check your phone's clock and try again."})
        device.refresh_from_db()
        device.confirmed = True
        device.save(update_fields=["confirmed"])
        AuditLog.record(user, "mfa.enabled", user)
        backup_codes = mfa.generate_backup_codes(user)  # shown once; only hashes are kept
        # Enrolment ticket holders have no tokens yet; signed-in users already do.
        if not (request.user and request.user.is_authenticated):
            return Response({"detail": "MFA enabled.", "backup_codes": backup_codes, **tokens_for(user)})
        return Response({"detail": "MFA enabled.", "backup_codes": backup_codes})


class MfaDisableView(AuthThrottled, APIView):
    @extend_schema(request=CodeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        from django.conf import settings

        if settings.REQUIRE_STAFF_MFA and request.user.role != "customer":
            raise ValidationError({"detail": "MFA is required for staff accounts."})
        s = CodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if not mfa.verify_second_factor(request.user, s.validated_data["code"]):
            raise ValidationError({"code": "Invalid code."})
        request.user.totp_device.delete()
        mfa.MFABackupCode.objects.filter(user=request.user).delete()
        AuditLog.record(request.user, "mfa.disabled", request.user)
        return Response({"detail": "MFA disabled."})


class MfaBackupCodesView(AuthThrottled, APIView):
    """GET: how many backup codes are left. POST with a current authenticator code: replace them with a fresh set."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"enabled": mfa.has_confirmed_device(request.user), "backup_codes_left": mfa.backup_codes_left(request.user)})

    @extend_schema(request=CodeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = CodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if not mfa.has_confirmed_device(request.user):
            raise ValidationError({"detail": "Turn on two-step sign-in first."})
        code = s.validated_data["code"]
        if mfa.looks_like_backup_code(code) or not mfa.verify_code(request.user, code):
            raise ValidationError({"code": "Enter the 6-digit code from your authenticator app."})
        AuditLog.record(request.user, "mfa.backup_codes_regenerated", request.user)
        return Response({"backup_codes": mfa.generate_backup_codes(request.user)})


# --- Phone: verify a number, sign in with it ------------------------------------------------------------------

class PhoneLoginRequestView(AuthThrottled, APIView):
    """Send a sign-in code. The reply is identical whether or not an account uses this number."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(request=PhoneSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PhoneSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            phone_utils.request_login_code(s.validated_data["phone"])
        except phone_utils.PhoneError as exc:
            raise ValidationError({"phone": str(exc)})
        return Response({"detail": "If that number is linked to an account, a code has been sent by SMS."})


class PhoneLoginConfirmView(AuthThrottled, APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=PhoneCodeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PhoneCodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = phone_utils.login_with_code(s.validated_data["phone"], s.validated_data["code"])
        if not user:
            raise AuthenticationFailed("That code is wrong or has expired.")
        return Response(tokens_for(user))


class PhoneVerifyRequestView(AuthThrottled, APIView):
    @extend_schema(request=PhoneSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PhoneSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            phone = phone_utils.request_verify_code(request.user, s.validated_data["phone"])
        except phone_utils.PhoneError as exc:
            raise ValidationError({"phone": str(exc)})
        return Response({"detail": "We sent a code by SMS.", "phone": phone})


class PhoneVerifyConfirmView(AuthThrottled, APIView):
    @extend_schema(request=PhoneCodeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = PhoneCodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            user = phone_utils.confirm_verify_code(request.user, s.validated_data["phone"], s.validated_data["code"])
        except phone_utils.PhoneError as exc:
            raise ValidationError({"code": str(exc)})
        return Response(UserSerializer(user).data)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def address_rules_view(request):
    """What the address form should ask for in a country: postal code (required, optional or none), region label."""
    country = (request.query_params.get("country") or "").upper()
    if not address_rules.is_country(country):
        raise ValidationError({"country": "Provide a 2-letter ISO country code."})
    return Response(address_rules.describe(country))

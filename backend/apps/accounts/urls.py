from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenBlacklistView, TokenRefreshView

from . import views

router = DefaultRouter()
router.register("addresses", views.AddressViewSet, basename="address")

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("login/mfa/", views.MfaLoginView.as_view(), name="login-mfa"),
    path("refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", TokenBlacklistView.as_view(), name="logout"),
    path("me/", views.MeView.as_view(), name="me"),
    path("verify-email/request/", views.VerifyEmailRequestView.as_view(), name="verify-email-request"),
    path("verify-email/confirm/", views.VerifyEmailConfirmView.as_view(), name="verify-email-confirm"),
    path("password-reset/", views.PasswordResetRequestView.as_view(), name="password-reset"),
    path("password-reset/confirm/", views.PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("change-password/", views.ChangePasswordView.as_view(), name="change-password"),
    path("phone/login/", views.PhoneLoginRequestView.as_view(), name="phone-login"),
    path("phone/login/confirm/", views.PhoneLoginConfirmView.as_view(), name="phone-login-confirm"),
    path("phone/verify/", views.PhoneVerifyRequestView.as_view(), name="phone-verify"),
    path("phone/verify/confirm/", views.PhoneVerifyConfirmView.as_view(), name="phone-verify-confirm"),
    path("address-rules/", views.address_rules_view, name="address-rules"),
    path("mfa/setup/", views.MfaSetupView.as_view(), name="mfa-setup"),
    path("mfa/confirm/", views.MfaConfirmView.as_view(), name="mfa-confirm"),
    path("mfa/disable/", views.MfaDisableView.as_view(), name="mfa-disable"),
    path("", include(router.urls)),
]

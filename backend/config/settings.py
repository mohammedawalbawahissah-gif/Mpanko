"""
Mpanko — Rooted in Africa. Made for the World.
Django settings. Everything environment-specific comes from environment variables
so the same code runs locally (SQLite) and on Railway (PostgreSQL + Redis).
"""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEBUG = env_bool("DEBUG", False)
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-change-me"
    else:
        raise RuntimeError("SECRET_KEY environment variable is required when DEBUG is off.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1,.up.railway.app")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # mpanko
    "apps.accounts",
    "apps.catalog",
    "apps.orders",
    "apps.payments",
    "apps.shipping",
    "apps.currency",
    "apps.reports",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database: DATABASE_URL (Railway Postgres) or local SQLite -----------------
DATABASES = {
    # `or` (not a default argument) so a blank DATABASE_URL= line in .env still falls back to SQLite.
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"
PASSWORD_RESET_TIMEOUT = 60 * 60 * 24  # emailed verify/reset links live 24h
REQUIRE_STAFF_MFA = env_bool("REQUIRE_STAFF_MFA", False)  # on in production once staff have enrolled
REQUIRE_VERIFIED_EMAIL = env_bool("REQUIRE_VERIFIED_EMAIL", False)  # block checkout until email is verified
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
if DEBUG:
    STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}

# --- Django REST Framework ----------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {"anon": "200/hour", "user": "2000/hour", "auth": "20/minute"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Mpanko API",
    "DESCRIPTION": "Mpanko — Rooted in Africa. Made for the World.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- CORS ---------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:5174")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")  # used in emailed links
CORS_ALLOW_CREDENTIALS = False

# --- Celery / Redis -----------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "")
CELERY_BROKER_URL = REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = REDIS_URL or "cache+memory://"
CELERY_TASK_ALWAYS_EAGER = not REDIS_URL  # run tasks inline when no Redis is configured
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BEAT_SCHEDULE = {
    # Release stock held by unpaid orders once their reservation window passes.
    "expire-unpaid-orders": {"task": "apps.orders.tasks.expire_unpaid_orders_task", "schedule": 300.0},
    "poll-carrier-tracking": {"task": "apps.shipping.tasks.poll_active_shipments", "schedule": 1800.0},
    "refresh-fx-rates": {"task": "apps.currency.tasks.refresh_fx_rates", "schedule": 6 * 3600.0},
}
if REDIS_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

# --- Commerce -----------------------------------------------------------------
BASE_CURRENCY = os.environ.get("BASE_CURRENCY", "USD")  # OD-04: confirm with client
SUPPORTED_CURRENCIES = env_list("SUPPORTED_CURRENCIES", "USD,GHS")
# Fixed manual rates relative to BASE_CURRENCY (FR-CUR-02). Format: "GHS=11.6,EUR=0.92"
MANUAL_FX_RATES = {
    pair.split("=")[0].strip().upper(): pair.split("=")[1].strip()
    for pair in env_list("MANUAL_FX_RATES", "GHS=11.65")
    if "=" in pair
}
FX_PROVIDER_URL = os.environ.get("FX_PROVIDER_URL", "https://open.er-api.com/v6/latest/{base}")  # free, no key
FX_MAX_AGE_HOURS = int(os.environ.get("FX_MAX_AGE_HOURS", "48"))  # older live rates are ignored
SHIPPING_FLAT_RATE = os.environ.get("SHIPPING_FLAT_RATE", "15.00")  # in BASE_CURRENCY (OD-09)
STOCK_RESERVATION_MINUTES = int(os.environ.get("STOCK_RESERVATION_MINUTES", "30"))

TAX_RATE = os.environ.get("TAX_RATE", "0")  # e.g. "0.125" once tax advice is confirmed (FR-TAX-01)

# --- Email --------------------------------------------------------------------
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "Mpanko <no-reply@mpanko.example>")

# --- Shipping carriers --------------------------------------------------------
DHL_API_KEY = os.environ.get("DHL_API_KEY", "")
DHL_TRACKING_URL = os.environ.get("DHL_TRACKING_URL", "https://api-eu.dhl.com/track/shipments")

# --- Payments -----------------------------------------------------------------
PAYMENT_PROVIDERS_ENABLED = env_list("PAYMENT_PROVIDERS_ENABLED", "mock" if DEBUG else "paystack")
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYMENT_RETURN_URL = os.environ.get("PAYMENT_RETURN_URL", "http://localhost:3000/checkout/complete")

# --- Security -----------------------------------------------------------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_CONTENT_TYPE_NOSNIFF = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}

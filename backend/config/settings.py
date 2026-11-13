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
    "apps.notifications",
    "apps.support",
    "apps.promotions",
    "apps.privacy",
    "apps.tax",
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
# Product images: Cloudflare R2 (S3-compatible) when R2_BUCKET is set, so uploads survive redeploys.
R2_BUCKET = os.environ.get("R2_BUCKET", "")
if R2_BUCKET:
    _r2_public = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")  # e.g. https://images.example.com or https://pub-xxxx.r2.dev
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": R2_BUCKET,
            "endpoint_url": f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            "access_key": os.environ["R2_ACCESS_KEY_ID"],
            "secret_key": os.environ["R2_SECRET_ACCESS_KEY"],
            "region_name": "auto",
            "signature_version": "s3v4",
            "querystring_auth": False,
            "default_acl": None,
            "file_overwrite": False,
            **({"custom_domain": _r2_public.split("://", 1)[-1]} if _r2_public else {}),
        },
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
    "DEFAULT_THROTTLE_RATES": {"anon": "200/hour", "user": "2000/hour", "auth": "20/minute", "client_errors": "30/hour"},
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
# Browsers send Idempotency-Key on checkout and payment calls; without this the preflight blocks them.
from corsheaders.defaults import default_headers  # noqa: E402

CORS_ALLOW_HEADERS = (*default_headers, "idempotency-key")

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
    "apply-retention": {"task": "apps.privacy.tasks.run_retention", "schedule": 24 * 3600.0},
    "refresh-fx-rates": {"task": "apps.currency.tasks.refresh_fx_rates", "schedule": 6 * 3600.0},
}
if REDIS_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

# --- Commerce -----------------------------------------------------------------
BASE_CURRENCY = os.environ.get("BASE_CURRENCY", "USD")  # OD-04: confirm with client
# "ALL" = every ISO 4217 currency we hold a rate for. Or list codes: "USD,GHS,EUR"
SUPPORTED_CURRENCIES = env_list("SUPPORTED_CURRENCIES", "ALL")
FX_AUTO_REFRESH = env_bool("FX_AUTO_REFRESH", True)  # fetch live rates on demand when none are fresh
# Fixed manual rates relative to BASE_CURRENCY (FR-CUR-02). Format: "GHS=11.6,EUR=0.92"
MANUAL_FX_RATES = {
    pair.split("=")[0].strip().upper(): pair.split("=")[1].strip()
    for pair in env_list("MANUAL_FX_RATES", "GHS=11.65")
    if "=" in pair
}
FX_PROVIDER_URL = os.environ.get("FX_PROVIDER_URL", "https://open.er-api.com/v6/latest/{base}")  # free, no key
FX_MAX_AGE_HOURS = int(os.environ.get("FX_MAX_AGE_HOURS", "48"))  # older live rates are ignored
STORE_COUNTRY = os.environ.get("STORE_COUNTRY", "GH")  # shipments to other countries are "international" (duty declaration required)
SHIPPING_FLAT_RATE = os.environ.get("SHIPPING_FLAT_RATE", "15.00")  # in BASE_CURRENCY (OD-09)
STOCK_RESERVATION_MINUTES = int(os.environ.get("STOCK_RESERVATION_MINUTES", "30"))

TAX_RATE = os.environ.get("TAX_RATE", "0")  # fallback when no tax rule matches the destination (FR-TAX-01)
# Import duties and destination VAT (FR-CHK-04). "estimate": shown to the buyer, paid to the carrier or customs on
# delivery (DDU, the default). "prepaid": collected at checkout and added to the total (DDP; needs a carrier or broker
# that remits duties on your behalf).
DUTIES_MODE = os.environ.get("DUTIES_MODE", "estimate")
# Carriers bill the larger of real and volumetric weight; volumetric = L x W x H (cm) / divisor, in kg.
VOLUMETRIC_DIVISOR = int(os.environ.get("VOLUMETRIC_DIVISOR", "5000"))

# --- Email --------------------------------------------------------------------
# Resend: set RESEND_API_KEY and verify your sending domain in the Resend dashboard. Nothing else is needed.
# Any other SMTP service: set EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD instead.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
if RESEND_API_KEY:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD = "smtp.resend.com", "resend", RESEND_API_KEY
else:
    EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
    EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
    EMAIL_BACKEND = os.environ.get(
        "EMAIL_BACKEND",
        "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend",
    )
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_TIMEOUT = 15
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
STAFF_ALERT_EMAILS = [e.strip() for e in os.environ.get("STAFF_ALERT_EMAILS", "").split(",") if e.strip()]  # extra low-stock alert recipients
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "Mpanko <no-reply@mpanko.example>")

# --- Business details and data retention ------------------------------------------
STORE_LEGAL_NAME = os.environ.get("STORE_LEGAL_NAME", "Wolbi Royal Enterprise")
STORE_ADDRESS = os.environ.get("STORE_ADDRESS", "Tamale, Ghana")
STORE_TAX_ID = os.environ.get("STORE_TAX_ID", "")  # printed on invoices; client's accountant to supply
RETENTION_UNVERIFIED_DAYS = int(os.environ.get("RETENTION_UNVERIFIED_DAYS", "30"))
RETENTION_LOG_DAYS = int(os.environ.get("RETENTION_LOG_DAYS", "180"))
RETENTION_CLOSED_SUPPORT_DAYS = int(os.environ.get("RETENTION_CLOSED_SUPPORT_DAYS", "730"))
RETENTION_ORDER_YEARS = int(os.environ.get("RETENTION_ORDER_YEARS", "7"))  # confirm with the client's accountant

# --- Returns ------------------------------------------------------------------
# --- SMS (FR-NOT-02, phone sign-in) ---------------------------------------------
# "log" writes messages to the server log; "twilio" sends for real. See docs/GO-LIVE.md.
SMS_BACKEND = os.environ.get("SMS_BACKEND", "log")
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_FROM", "")  # a number or an approved alphanumeric sender id
TWILIO_MESSAGING_SERVICE_SID = os.environ.get("TWILIO_MESSAGING_SERVICE_SID", "")

APP_SCHEME = os.environ.get("APP_SCHEME", "mpanko")  # deep-link scheme of the mobile app
EXPO_ACCESS_TOKEN = os.environ.get("EXPO_ACCESS_TOKEN", "")  # optional; raises Expo push limits
RETURN_WINDOW_DAYS = int(os.environ.get("RETURN_WINDOW_DAYS", "14"))  # days after delivery; confirm with the client (OD-11)
RETURN_ALLOW_CHANGED_MIND = env_bool("RETURN_ALLOW_CHANGED_MIND", True)

# --- Shipping carriers --------------------------------------------------------
DHL_API_KEY = os.environ.get("DHL_API_KEY", "")
DHL_TRACKING_URL = os.environ.get("DHL_TRACKING_URL", "https://api-eu.dhl.com/track/shipments")

# Ship-from address (used for live quotes and labels) and default parcel when products have no dimensions.
SHIP_FROM = {
    "name": os.environ.get("SHIP_FROM_NAME", "Mpanko"),
    "phone": os.environ.get("SHIP_FROM_PHONE", ""),
    "email": os.environ.get("SHIP_FROM_EMAIL", ""),
    "line1": os.environ.get("SHIP_FROM_LINE1", ""),
    "city": os.environ.get("SHIP_FROM_CITY", "Tamale"),
    "region": os.environ.get("SHIP_FROM_REGION", ""),
    "postal_code": os.environ.get("SHIP_FROM_POSTAL_CODE", ""),
    "country": os.environ.get("SHIP_FROM_COUNTRY", STORE_COUNTRY),
}
# Carrier codes cleared to move dangerous goods on your account (needs the carrier's approval); table services opt in individually.
DANGEROUS_GOODS_CARRIERS = env_list("DANGEROUS_GOODS_CARRIERS", "")
PARCEL_DEFAULT_CM = [int(x) for x in env_list("PARCEL_DEFAULT_CM", "30,20,10")]
CARRIER_API_TIMEOUT = int(os.environ.get("CARRIER_API_TIMEOUT", "8"))  # seconds; a slow carrier must not hold up checkout
CARRIER_QUOTE_CACHE_SECONDS = int(os.environ.get("CARRIER_QUOTE_CACHE_SECONDS", "600"))
CARRIER_SANDBOX = env_bool("CARRIER_SANDBOX", True)  # True = test endpoints; set false only with production credentials

# DHL Express (MyDHL API): rates, labels. DHL_API_KEY above is the separate Tracking API key.
DHL_EXPRESS_USER = os.environ.get("DHL_EXPRESS_USER", "")
DHL_EXPRESS_PASSWORD = os.environ.get("DHL_EXPRESS_PASSWORD", "")
DHL_EXPRESS_ACCOUNT = os.environ.get("DHL_EXPRESS_ACCOUNT", "")
# FedEx
FEDEX_CLIENT_ID = os.environ.get("FEDEX_CLIENT_ID", "")
FEDEX_CLIENT_SECRET = os.environ.get("FEDEX_CLIENT_SECRET", "")
FEDEX_ACCOUNT = os.environ.get("FEDEX_ACCOUNT", "")
# UPS
UPS_CLIENT_ID = os.environ.get("UPS_CLIENT_ID", "")
UPS_CLIENT_SECRET = os.environ.get("UPS_CLIENT_SECRET", "")
UPS_ACCOUNT = os.environ.get("UPS_ACCOUNT", "")

# --- Payments -----------------------------------------------------------------
PAYMENT_PROVIDERS_ENABLED = env_list("PAYMENT_PROVIDERS_ENABLED", "mock" if DEBUG else "paystack")
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYMENT_RETURN_URL = os.environ.get("PAYMENT_RETURN_URL", f"{FRONTEND_URL}/checkout/complete")

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

# --- Error tracking (NFR-05) -----------------------------------------------------
# Set SENTRY_DSN to report unhandled errors from the API and background tasks to Sentry. Personal data is not sent.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
if SENTRY_DSN:
    import sentry_sdk

    def _scrub(event, _hint):
        request = event.get("request") or {}
        for key in ("cookies", "data", "query_string"):
            request.pop(key, None)
        headers = request.get("headers") or {}
        for name in list(headers):
            if name.lower() in {"authorization", "cookie", "x-paystack-signature"}:
                headers[name] = "[removed]"
        return event

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production" if not DEBUG else "development"),
        release=os.environ.get("RAILWAY_GIT_COMMIT_SHA", ""),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,
        before_send=_scrub,
    )

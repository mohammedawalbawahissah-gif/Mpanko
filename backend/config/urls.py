import os

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from config.client_errors import client_error
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    # RAILWAY_GIT_COMMIT_SHA is set by Railway on every deploy, so "which version is live?" is one request away.
    release = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or os.environ.get("RELEASE") or "")[:12]
    return JsonResponse({"status": "ok", "service": "mpanko-api", **({"release": release} if release else {})})


def ready(_request):
    """Readiness: can this instance actually serve traffic? Checks the database and, when configured, Redis."""
    checks = {}
    try:
        from django.db import connection

        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "failed"
    if settings.REDIS_URL:
        try:
            from django.core.cache import cache

            cache.set("ready-check", "1", 5)
            checks["redis"] = "ok" if cache.get("ready-check") == "1" else "failed"
        except Exception:  # noqa: BLE001
            checks["redis"] = "failed"
    ok = all(v == "ok" for v in checks.values())
    return JsonResponse({"status": "ready" if ok else "degraded", "checks": checks}, status=200 if ok else 503)


urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path("health/", health),
    path("ready/", ready),
    path("api/v1/client-errors/", client_error, name="client-error"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.catalog.urls")),
    path("api/v1/", include("apps.orders.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/currency/", include("apps.currency.urls")),
    path("api/v1/reports/", include("apps.reports.urls")),
    path("api/v1/", include("apps.shipping.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/", include("apps.accounts.manage_urls")),
    path("api/v1/", include("apps.support.urls")),
    path("api/v1/", include("apps.privacy.urls")),
    path("api/v1/", include("apps.promotions.urls")),
    path("api/v1/", include("apps.tax.urls")),
    path("api/v1/", include("apps.corporate.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


# The API reference is for developers: open in development, and in production only when API_DOCS_PUBLIC is switched on.
if settings.DEBUG or settings.API_DOCS_PUBLIC:
    urlpatterns += [
        path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]

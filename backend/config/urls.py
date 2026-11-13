from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from config.client_errors import client_error
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    return JsonResponse({"status": "ok", "service": "mpanko-api"})


def ready(_request):
    """Readiness: can this instance actually serve traffic? Checks the database and, when configured, Redis."""
    checks = {}
    try:
        from django.db import connection

        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"failed: {exc.__class__.__name__}"
    if settings.REDIS_URL:
        try:
            from django.core.cache import cache

            cache.set("ready-check", "1", 5)
            checks["redis"] = "ok" if cache.get("ready-check") == "1" else "failed: no read-back"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = f"failed: {exc.__class__.__name__}"
    ok = all(v == "ok" for v in checks.values())
    return JsonResponse({"status": "ready" if ok else "degraded", "checks": checks}, status=200 if ok else 503)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health),
    path("ready/", ready),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
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
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

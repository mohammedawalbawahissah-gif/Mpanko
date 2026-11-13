"""Extra response headers for the API. JSON has nothing to render, so the policy is as strict as it can be."""

PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
# The API docs page loads its viewer from a CDN, and Django's own admin has inline scripts, so those paths keep their own rules.
RELAXED_PREFIXES = ("/api/v1/docs", "/api/v1/schema", "/django-admin", "/admin/")


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        response.setdefault("Cross-Origin-Resource-Policy", "same-site")
        if not request.path.startswith(RELAXED_PREFIXES):
            response.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        return response

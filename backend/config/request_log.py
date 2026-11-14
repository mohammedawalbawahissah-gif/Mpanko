"""Request IDs and one structured log line per request (NFR-05).

Every request gets an ID (the caller's X-Request-ID if it looks safe, otherwise a new one). The ID is sent back in the
response, stamped on every log line written while the request runs, and tagged on Sentry errors, so one customer report
("it failed at 10:42") can be traced through the logs. Nothing personal is logged: no body, query string, email or token.
"""
import contextvars
import json
import logging
import re
import time
import uuid

_request_id = contextvars.ContextVar("request_id", default="-")
_SAFE = re.compile(r"[A-Za-z0-9._-]{8,64}")
SLOW_MS = 1000
QUIET_PATHS = ("/health/", "/ready/")  # probes run every few seconds; logging each would drown real traffic

access = logging.getLogger("mpanko.request")


def current_request_id():
    return _request_id.get()


class RequestIDFilter(logging.Filter):
    """Adds the running request's ID to every log record."""

    def filter(self, record):
        record.request_id = _request_id.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, which Railway's log search can filter by field."""

    def format(self, record):
        data = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        for key in ("method", "path", "status", "duration_ms", "user_id"):
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


class RequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get("X-Request-ID", "")
        rid = incoming if _SAFE.fullmatch(incoming) else uuid.uuid4().hex
        request.request_id = rid
        token = _request_id.set(rid)
        _tag_sentry(rid)
        start = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            response["X-Request-ID"] = rid
            return response
        finally:
            ms = round((time.monotonic() - start) * 1000)
            if not request.path.startswith(QUIET_PATHS) or status >= 500:
                user = getattr(request, "user", None)
                level = logging.ERROR if status >= 500 else logging.WARNING if ms >= SLOW_MS else logging.INFO
                access.log(
                    level, "%s %s %s %sms%s", request.method, request.path, status, ms, " (slow)" if ms >= SLOW_MS else "",
                    extra={"method": request.method, "path": request.path, "status": status, "duration_ms": ms,
                           "user_id": user.pk if getattr(user, "is_authenticated", False) else None},
                )
            _request_id.reset(token)


def _tag_sentry(rid):
    try:
        import sentry_sdk

        sentry_sdk.set_tag("request_id", rid)
    except ImportError:  # Sentry is optional
        pass

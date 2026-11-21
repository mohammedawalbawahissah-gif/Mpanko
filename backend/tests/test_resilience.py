"""A dead queue or a dead cache must never turn a request into a 500 error."""
import pytest
from rest_framework.test import APIClient

from apps.notifications.enqueue import enqueue
from config.celery import app

pytestmark = pytest.mark.django_db


@pytest.fixture
def dead_broker():
    old = (app.conf.task_always_eager, app.conf.broker_url, app.conf.task_publish_retry_policy)
    app.conf.task_always_eager = False
    app.conf.broker_url = "redis://127.0.0.1:1/0"
    app.conf.task_publish_retry_policy = {"max_retries": 0}
    yield
    app.conf.task_always_eager, app.conf.broker_url, app.conf.task_publish_retry_policy = old


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_verify_email_request_survives_dead_broker(customer, dead_broker):
    r = _client(customer).post("/api/v1/auth/verify-email/request/", {}, format="json")
    assert r.status_code == 200


def test_enqueue_never_raises(dead_broker):
    from apps.accounts.tasks import send_verification_email

    assert enqueue(send_verification_email, 999999) in (True, False)


def test_enqueue_runs_task_inline_when_queue_is_down(monkeypatch):
    calls = []

    class Task:
        name = "fake"

        def delay(self, *a, **k):
            raise ConnectionError("queue down")

        def apply(self, args=(), kwargs=None):
            calls.append(args)

    assert enqueue(Task(), 1, 2) is True
    assert calls == [(1, 2)]


def test_enqueue_returns_false_when_nothing_works():
    class Task:
        name = "fake"

        def delay(self, *a, **k):
            raise ConnectionError("queue down")

        def apply(self, args=(), kwargs=None):
            raise RuntimeError("task broke")

    assert enqueue(Task(), 1) is False


def test_cache_miss_instead_of_error_when_redis_is_down():
    from config.cache import ResilientRedisCache

    cache = ResilientRedisCache("redis://127.0.0.1:1/0", {"OPTIONS": {"socket_connect_timeout": 1}})
    assert cache.get("k", "fallback") == "fallback"
    assert cache.set("k", "v") is None
    assert cache.add("k", "v") is False
    assert cache.get_many(["a"]) == {}

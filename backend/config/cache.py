"""A Redis cache that survives Redis being down.

The cache holds rate-limit counters and short-lived lookups. If Redis cannot be reached, a missing cache should mean
"no rate limiting for a moment", not "every request fails". Each call that cannot reach Redis is logged and then treated
as a cache miss.
"""
import functools
import logging

from django.core.cache.backends.redis import RedisCache
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


def _safe(default):
    def wrap(fn):
        @functools.wraps(fn)
        def inner(self, *args, **kwargs):
            try:
                return fn(self, *args, **kwargs)
            except (RedisError, OSError) as exc:
                logger.warning("Cache %s skipped, Redis unreachable: %s", fn.__name__, exc)
                return default(args, kwargs) if callable(default) else default
        return inner
    return wrap


class ResilientRedisCache(RedisCache):
    @_safe(lambda a, k: k.get("default", a[1] if len(a) > 1 else None))
    def get(self, key, default=None, version=None):
        return super().get(key, default, version)

    @_safe(None)
    def set(self, *args, **kwargs):
        return super().set(*args, **kwargs)

    @_safe(False)
    def add(self, *args, **kwargs):
        return super().add(*args, **kwargs)

    @_safe(None)
    def touch(self, *args, **kwargs):
        return super().touch(*args, **kwargs)

    @_safe(None)
    def delete(self, *args, **kwargs):
        return super().delete(*args, **kwargs)

    @_safe({})
    def get_many(self, *args, **kwargs):
        return super().get_many(*args, **kwargs)

    @_safe([])
    def set_many(self, *args, **kwargs):
        return super().set_many(*args, **kwargs)

    @_safe(False)
    def has_key(self, *args, **kwargs):
        return super().has_key(*args, **kwargs)

    @_safe(None)
    def incr(self, key, delta=1, version=None):
        return super().incr(key, delta, version)

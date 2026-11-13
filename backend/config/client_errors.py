"""Receives crashes from the web, admin and mobile apps so they appear next to server errors (NFR-05)."""
import logging

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

logger = logging.getLogger("mpanko.client")


class ClientErrorSerializer(serializers.Serializer):
    source = serializers.ChoiceField(choices=["web", "admin", "mobile"])
    message = serializers.CharField(max_length=500)
    stack = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    url = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    app_version = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")


@extend_schema(request=ClientErrorSerializer, responses={204: None})
@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([ScopedRateThrottle])
def client_error(request):
    """Log one front-end error. Anonymous and rate-limited; never stores or returns anything about the person."""
    s = ClientErrorSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    # Query strings can carry tokens (password-reset links); keep only the path.
    path = d["url"].split("?")[0].split("#")[0]
    logger.error("[%s %s] %s @ %s\n%s", d["source"], d["app_version"], d["message"], path, d["stack"])
    return Response(status=204)


client_error.cls.throttle_scope = "client_errors"

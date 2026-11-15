from rest_framework import serializers

from apps.catalog.serializers import MAX_IMAGE_BYTES

from .contacts import clean_value
from .models import Business, ContactMessage, SiteProfile, SupportContact


class SiteProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteProfile
        fields = ("company_name", "tagline", "intro", "about", "contact_email", "phone", "phone_label", "phone_2", "phone_2_label", "address",
                  "linkedin_url", "instagram_url", "facebook_url", "x_url")


class _LogoMixin:
    def get_logo(self, obj):
        if not obj.logo:
            return ""
        url = obj.logo.url
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request and url.startswith("/") else url


class PublicBusinessSerializer(_LogoMixin, serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()

    class Meta:
        model = Business
        fields = ("slug", "name", "sector", "tagline", "summary", "location", "website_url", "logo", "logo_alt", "is_featured")


class PublicBusinessDetailSerializer(PublicBusinessSerializer):
    class Meta(PublicBusinessSerializer.Meta):
        fields = PublicBusinessSerializer.Meta.fields + ("description",)


class ManageBusinessSerializer(_LogoMixin, serializers.ModelSerializer):
    logo = serializers.ImageField(required=False, allow_null=True, write_only=True)
    logo_url = serializers.SerializerMethodField()
    remove_logo = serializers.BooleanField(required=False, write_only=True, default=False)

    class Meta:
        model = Business
        fields = ("id", "name", "slug", "sector", "tagline", "summary", "description", "location", "website_url",
                  "logo", "logo_url", "remove_logo", "logo_alt", "is_published", "is_featured", "sort_order", "updated_at")
        read_only_fields = ("slug", "updated_at")

    def get_logo_url(self, obj):
        return self.get_logo(obj)

    def validate_logo(self, value):
        if value is not None and value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError("Logos must be 5 MB or smaller.")
        return value

    def validate(self, attrs):
        if attrs.pop("remove_logo", False):
            attrs["logo"] = None
        # A page with no name or summary is not ready to show.
        publishing = attrs.get("is_published", self.instance.is_published if self.instance else False)
        summary = attrs.get("summary", self.instance.summary if self.instance else "")
        if publishing and not summary.strip():
            raise serializers.ValidationError({"summary": "Add a short summary before publishing, so the business can appear in the list."})
        return attrs

    def create(self, validated):
        if validated.get("logo") is None:
            validated.pop("logo", None)
        return super().create(validated)

    def update(self, instance, validated):
        if "logo" in validated and validated["logo"] is None:
            instance.logo.delete(save=False)
            instance.logo = ""
            validated.pop("logo")
        return super().update(instance, validated)


class ContactInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField(max_length=254)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    business = serializers.SlugField(max_length=140, required=False, allow_blank=True)
    message = serializers.CharField(min_length=10, max_length=4000)
    # A hidden field real visitors never fill in. Anything here means a bot.
    website = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Enter your name.")
        return value


class ContactMessageSerializer(serializers.ModelSerializer):
    business_name = serializers.CharField(source="business.name", default="", read_only=True)
    handled_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ContactMessage
        fields = ("id", "name", "email", "phone", "business", "business_name", "message", "status", "staff_note",
                  "handled_by_name", "handled_at", "created_at")
        read_only_fields = ("id", "name", "email", "phone", "business", "message", "handled_at", "created_at")

    def get_handled_by_name(self, obj):
        u = obj.handled_by
        return (u.full_name or u.email) if u else ""


class SupportContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportContact
        fields = ("id", "kind", "label", "value", "sort_order", "is_active")

    def validate(self, attrs):
        from django.core.exceptions import ValidationError as DjangoValidationError

        kind = attrs.get("kind", self.instance.kind if self.instance else None)
        value = attrs.get("value", self.instance.value if self.instance else "")
        try:
            attrs["value"] = clean_value(kind, value)
        except DjangoValidationError as e:
            raise serializers.ValidationError({"value": e.messages[0]})
        attrs["label"] = attrs.get("label", self.instance.label if self.instance else "").strip()
        # With more than one of a kind, each needs its own name or the buttons look identical.
        others = SupportContact.objects.filter(kind=kind, is_active=True)
        if self.instance:
            others = others.exclude(pk=self.instance.pk)
        active = attrs.get("is_active", self.instance.is_active if self.instance else True)
        if active and others.exists() and not attrs["label"]:
            raise serializers.ValidationError({"label": "Give this one a name, such as Sales or Support, so customers can tell them apart."})
        if active and attrs["label"] and others.filter(label__iexact=attrs["label"]).exists():
            raise serializers.ValidationError({"label": "Another contact of this kind already has this name."})
        return attrs

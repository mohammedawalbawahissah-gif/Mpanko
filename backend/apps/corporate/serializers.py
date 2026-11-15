from rest_framework import serializers

from apps.catalog.serializers import MAX_IMAGE_BYTES

from .contacts import clean_value
from .models import Business, ContactMessage, SitePage, SiteProfile, SupportContact


class SiteProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteProfile
        fields = ("company_name", "tagline", "intro", "about", "contact_email", "phone", "phone_label", "phone_2", "phone_2_label", "address",
                  "linkedin_url", "instagram_url", "facebook_url", "x_url")


def _abs(serializer, field):
    if not field:
        return ""
    url = field.url
    request = serializer.context.get("request")
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


def _lines(text):
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


class _LogoMixin:
    def get_logo(self, obj):
        return _abs(self, obj.logo)

    def get_image(self, obj):
        return _abs(self, obj.image)

    def get_highlights(self, obj):
        return _lines(obj.highlights)


class PublicBusinessSerializer(_LogoMixin, serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()

    class Meta:
        model = Business
        fields = ("slug", "name", "sector", "tagline", "summary", "location", "website_url", "logo", "logo_alt", "image", "image_alt",
                  "cta_label", "cta_url", "is_featured")


class PublicBusinessDetailSerializer(PublicBusinessSerializer):
    highlights = serializers.SerializerMethodField()

    class Meta(PublicBusinessSerializer.Meta):
        fields = PublicBusinessSerializer.Meta.fields + ("description", "highlights", "disclaimer")


class PublicPageSerializer(_LogoMixin, serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    highlights = serializers.SerializerMethodField()

    class Meta:
        model = SitePage
        fields = ("slug", "title", "kicker", "summary", "body", "quote", "quote_by", "highlights", "image", "image_alt")


class _ImageUploadMixin:
    """Logo and photo uploads for the staff forms: write-only file fields, a read-only address, and remove flags."""

    def _check_size(self, value, what):
        if value is not None and value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError(f"{what} must be 5 MB or smaller.")
        return value

    def _apply_removals(self, attrs, fields):
        for f in fields:
            if attrs.pop(f"remove_{f}", False):
                attrs[f] = None

    def _create_clean(self, validated, fields):
        for f in fields:
            if validated.get(f) is None:
                validated.pop(f, None)

    def _update_clean(self, instance, validated, fields):
        for f in fields:
            if f in validated and validated[f] is None:
                getattr(instance, f).delete(save=False)
                setattr(instance, f, "")
                validated.pop(f)


class ManageBusinessSerializer(_ImageUploadMixin, _LogoMixin, serializers.ModelSerializer):
    logo = serializers.ImageField(required=False, allow_null=True, write_only=True)
    logo_url = serializers.SerializerMethodField()
    remove_logo = serializers.BooleanField(required=False, write_only=True, default=False)
    image = serializers.ImageField(required=False, allow_null=True, write_only=True)
    image_url = serializers.SerializerMethodField()
    remove_image = serializers.BooleanField(required=False, write_only=True, default=False)

    class Meta:
        model = Business
        fields = ("id", "name", "slug", "sector", "tagline", "summary", "description", "highlights", "location", "website_url",
                  "logo", "logo_url", "remove_logo", "logo_alt", "image", "image_url", "remove_image", "image_alt",
                  "cta_label", "cta_url", "disclaimer", "is_published", "is_featured", "sort_order", "updated_at")
        read_only_fields = ("slug", "updated_at")

    def get_logo_url(self, obj):
        return self.get_logo(obj)

    def get_image_url(self, obj):
        return self.get_image(obj)

    def validate_logo(self, value):
        return self._check_size(value, "Logos")

    def validate_image(self, value):
        return self._check_size(value, "Photos")

    def validate(self, attrs):
        self._apply_removals(attrs, ("logo", "image"))
        # A page with no name or summary is not ready to show.
        publishing = attrs.get("is_published", self.instance.is_published if self.instance else False)
        summary = attrs.get("summary", self.instance.summary if self.instance else "")
        if publishing and not summary.strip():
            raise serializers.ValidationError({"summary": "Add a short summary before publishing, so the business can appear in the list."})
        return attrs

    def create(self, validated):
        self._create_clean(validated, ("logo", "image"))
        return super().create(validated)

    def update(self, instance, validated):
        self._update_clean(instance, validated, ("logo", "image"))
        return super().update(instance, validated)


class ManagePageSerializer(_ImageUploadMixin, _LogoMixin, serializers.ModelSerializer):
    image = serializers.ImageField(required=False, allow_null=True, write_only=True)
    image_url = serializers.SerializerMethodField()
    remove_image = serializers.BooleanField(required=False, write_only=True, default=False)

    class Meta:
        model = SitePage
        fields = ("id", "slug", "title", "kicker", "summary", "body", "quote", "quote_by", "highlights", "image", "image_url", "remove_image",
                  "image_alt", "is_published", "updated_at")
        read_only_fields = ("updated_at",)

    def get_image_url(self, obj):
        return self.get_image(obj)

    def validate_image(self, value):
        return self._check_size(value, "Photos")

    def validate(self, attrs):
        self._apply_removals(attrs, ("image",))
        return attrs

    def create(self, validated):
        self._create_clean(validated, ("image",))
        return super().create(validated)

    def update(self, instance, validated):
        self._update_clean(instance, validated, ("image",))
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

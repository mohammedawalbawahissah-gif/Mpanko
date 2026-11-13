from rest_framework import serializers

from apps.accounts import address_rules

from .models import DutyRule, TaxRule


class _CountryMixin:
    allow_star = False

    def validate_country(self, value):
        value = value.strip().upper()
        if value == "*" and self.allow_star:
            return value
        if not address_rules.is_country(value):
            raise serializers.ValidationError('Use a 2-letter ISO country code' + (' or "*".' if self.allow_star else "."))
        return value


class TaxRuleSerializer(_CountryMixin, serializers.ModelSerializer):
    allow_star = True

    class Meta:
        model = TaxRule
        fields = ("id", "country", "name", "rate", "applies_to_shipping", "is_active")

    def validate_rate(self, value):
        if value < 0 or value > 1:
            raise serializers.ValidationError("Enter a share between 0 and 1, for example 0.125 for 12.5%.")
        return value


class DutyRuleSerializer(_CountryMixin, serializers.ModelSerializer):
    class Meta:
        model = DutyRule
        fields = ("id", "country", "de_minimis", "duty_rate", "import_vat_rate", "note", "is_active")

    def validate(self, attrs):
        for key in ("duty_rate", "import_vat_rate"):
            if key in attrs and not (0 <= attrs[key] <= 1):
                raise serializers.ValidationError({key: "Enter a share between 0 and 1."})
        if attrs.get("de_minimis", 0) < 0:
            raise serializers.ValidationError({"de_minimis": "Cannot be negative."})
        return attrs

"""
Country-aware address checks (FR-ADD-02). Postal codes and regions are validated per country for the markets we
expect; any other country accepts what the customer types, within sane limits. Rules are advice for the carrier:
a wrong postal code is the commonest reason an international parcel is delayed.
"""
import re

import pycountry

# country -> (postal_regex or None, postal_required, region_required, region_label, postal_example)
_RULES = {
    "GH": (r"[A-Z]{2}-\d{3}-\d{4}", False, True, "Region", "GA-123-4567 (GhanaPost digital address, optional)"),
    "NG": (r"\d{6}", False, True, "State", "100001"),
    "US": (r"\d{5}(-\d{4})?", True, True, "State", "73301"),
    "CA": (r"[A-Z]\d[A-Z] ?\d[A-Z]\d", True, True, "Province", "K1A 0B1"),
    "GB": (r"[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}", True, False, "County", "SW1A 1AA"),
    "IE": (r"[A-Z\d]{3} ?[A-Z\d]{4}", False, False, "County", "D02 AF30"),
    "DE": (r"\d{5}", True, False, "State", "10115"),
    "FR": (r"\d{5}", True, False, "Region", "75001"),
    "IT": (r"\d{5}", True, False, "Province", "00184"),
    "ES": (r"\d{5}", True, False, "Province", "28013"),
    "PT": (r"\d{4}-\d{3}", True, False, "District", "1000-001"),
    "NL": (r"\d{4} ?[A-Z]{2}", True, False, "Province", "1012 AB"),
    "BE": (r"\d{4}", True, False, "Province", "1000"),
    "CH": (r"\d{4}", True, False, "Canton", "8001"),
    "AT": (r"\d{4}", True, False, "State", "1010"),
    "SE": (r"\d{3} ?\d{2}", True, False, "County", "111 22"),
    "NO": (r"\d{4}", True, False, "County", "0150"),
    "DK": (r"\d{4}", True, False, "Region", "1050"),
    "AU": (r"\d{4}", True, True, "State", "2000"),
    "NZ": (r"\d{4}", True, False, "Region", "1010"),
    "IN": (r"\d{6}", True, True, "State", "110001"),
    "CN": (r"\d{6}", True, True, "Province", "100000"),
    "JP": (r"\d{3}-?\d{4}", True, True, "Prefecture", "100-0001"),
    "ZA": (r"\d{4}", True, True, "Province", "0001"),
    "KE": (r"\d{5}", False, False, "County", "00100"),
    "BR": (r"\d{5}-?\d{3}", True, True, "State", "01001-000"),
    "MX": (r"\d{5}", True, True, "State", "06000"),
    "SA": (r"\d{5}", True, False, "Region", "11564"),
    # Countries with no postal code system: nothing is asked for.
    "AE": (None, False, True, "Emirate", ""),
    "HK": (None, False, False, "Area", ""),
    "QA": (None, False, False, "Municipality", ""),
}
NO_POSTAL = {"AE", "HK", "QA", "BJ", "BF", "CF", "CG", "CI", "TG", "GM", "SL", "ZW", "AO", "BS", "BZ", "FJ", "GY", "KI", "NR", "SR", "TL", "TO", "TV", "VU", "YE"}


def is_country(code):
    return bool(code) and len(code) == 2 and pycountry.countries.get(alpha_2=code.upper()) is not None


def describe(country):
    country = (country or "").upper()
    rule = _RULES.get(country)
    if rule:
        _regex, postal_required, region_required, label, example = rule
        return {"country": country, "postal_code": "none" if _regex is None else ("required" if postal_required else "optional"),
                "region_required": region_required, "region_label": label, "postal_example": example}
    return {"country": country, "postal_code": "none" if country in NO_POSTAL else "optional", "region_required": False,
            "region_label": "Region", "postal_example": ""}


def check(data):
    """Return ({field: message}, cleaned_postal_code) for an address dict."""
    errors = {}
    country = (data.get("country") or "").upper()
    postal = re.sub(r"\s+", " ", (data.get("postal_code") or "").strip()).upper()
    region = (data.get("region") or "").strip()
    info = describe(country)
    rule = _RULES.get(country)
    if rule and rule[0]:
        if not postal:
            if rule[1]:
                errors["postal_code"] = f"A postal code is needed for {country}, for example {info['postal_example']}."
        elif not re.fullmatch(rule[0], postal):
            errors["postal_code"] = f"That does not look like a {country} postal code. Example: {info['postal_example'] or 'check the format'}."
    elif postal and not re.fullmatch(r"[A-Z0-9][A-Z0-9 \-]{1,11}", postal):
        errors["postal_code"] = "Postal codes use letters, numbers, spaces and hyphens only (up to 12 characters)."
    if info["region_required"] and not region:
        errors["region"] = f"{info['region_label']} is needed for {country}."
    return errors, postal

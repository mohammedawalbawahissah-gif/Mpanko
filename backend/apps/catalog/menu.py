"""Menu pages: a category marked as a menu lists its dishes in sections, and buyers pick from it and check out through the normal cart.

Dishes are ordinary products. A dish is orderable once it is published and has a price; until then it still shows on the menu
(the website lists the whole menu) but cannot be added to the bag.
"""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager

from .models import Category, Inventory, Product, ProductStatus, ProductVariant


def _menu_category(slug):
    category = Category.objects.filter(slug=slug, is_active=True, is_menu=True).select_related("parent").first()
    if category is None:
        raise NotFound()
    return category


def _dishes(category):
    return (
        Product.objects.filter(category=category).exclude(menu_section="").exclude(status=ProductStatus.ARCHIVED)
        .prefetch_related("variants").order_by("menu_order", "id")
    )


def _sections(dishes):
    """Group dishes by their section, keeping the order they were listed in."""
    out, index = [], {}
    for p in dishes:
        if p.menu_section not in index:
            index[p.menu_section] = {"name": p.menu_section, "items": []}
            out.append(index[p.menu_section])
        index[p.menu_section]["items"].append(p)
    return out


class MenuView(APIView):
    """The whole menu of one category, in sections. No sign-in."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, slug):
        category = _menu_category(slug)
        sections = []
        for section in _sections(_dishes(category)):
            items = []
            for p in section["items"]:
                variants = [v for v in p.variants.all() if v.is_active] if p.status == ProductStatus.PUBLISHED else []
                items.append({
                    "slug": p.slug, "name": p.name, "description": p.description,
                    "orderable": bool(variants) and p.base_price > 0,
                    "currency": p.currency,
                    "lead_time_days": p.lead_time_days if p.made_to_order else None,
                    "variants": [{"id": v.id, "sku": v.sku, "name": v.name, "price": str(v.price)} for v in variants] if p.base_price > 0 else [],
                })
            sections.append({"name": section["name"], "items": items})
        return Response({
            "category": {"name": category.name, "slug": category.slug, "parent": category.parent.name if category.parent else ""},
            "note": category.menu_note,
            "sections": sections,
            "orderable_count": sum(1 for s in sections for i in s["items"] if i["orderable"]),
        })


class MenuPricesView(APIView):
    """Staff set every dish's price and whether it is on sale, in one go."""

    permission_classes = [CatalogManager]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, slug):
        category = _menu_category(slug)
        return Response({
            "category": {"name": category.name, "slug": category.slug},
            "items": [
                {"id": p.id, "name": p.name, "section": p.menu_section, "price": str(p.base_price), "currency": p.currency,
                 "published": p.status == ProductStatus.PUBLISHED}
                for p in _dishes(category)
            ],
        })

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, slug):
        category = _menu_category(slug)
        rows = request.data.get("items")
        if not isinstance(rows, list) or not rows:
            raise ValidationError({"items": "Send the dishes to update."})
        dishes = {p.id: p for p in _dishes(category)}
        errors = {}
        parsed = []
        for row in rows:
            p = dishes.get(row.get("id")) if isinstance(row, dict) else None
            if p is None:
                raise ValidationError({"items": "One of the dishes is not on this menu."})
            try:
                price = Decimal(str(row.get("price", "0")).strip() or "0").quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError):
                errors[str(p.id)] = "Enter the price as a number, for example 12.50."
                continue
            if price < 0 or price > Decimal("99999.99"):
                errors[str(p.id)] = "Enter a price between 0 and 99999.99."
                continue
            publish = bool(row.get("published"))
            if publish and price <= 0:
                errors[str(p.id)] = f"Give {p.name} a price before putting it on sale."
                continue
            parsed.append((p, price, publish))
        if errors:
            raise ValidationError(errors)
        changed = 0
        with transaction.atomic():
            for p, price, publish in parsed:
                status = ProductStatus.PUBLISHED if publish else ProductStatus.DRAFT
                if p.base_price == price and p.status == status:
                    continue
                p.base_price, p.status = price, status
                p.save(update_fields=["base_price", "status", "updated_at"])
                if not p.variants.exists():  # a dish needs one variant to be added to a bag
                    v = ProductVariant.objects.create(product=p, sku=f"QTE-{p.id}", name="")
                    Inventory.objects.create(variant=v)
                changed += 1
        AuditLog.record(request.user, "menu.prices", category, slug=category.slug, changed=changed)
        return Response({"changed": changed})

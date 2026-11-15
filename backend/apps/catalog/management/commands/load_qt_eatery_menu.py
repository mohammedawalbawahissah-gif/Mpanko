"""Create QT Eatery's menu in the shop: a QT Eatery sub-category under Food, with every dish from the printed menu.

Safe to run again: it only adds what is missing and never changes a price, a status or anything staff have edited.
Every dish starts as a draft with no price, because the printed menu has none ("price depends on type of orders and quantity").
Staff set the prices and put dishes on sale in the admin (Menu prices), and only then can buyers order them.
"""
import pycountry
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from apps.catalog.management.commands.seed_categories import create_taxonomy
from apps.catalog.models import Category, Inventory, Product, ProductStatus, ProductType, ProductVariant

CATEGORY_NAME = "QT Eatery"
MENU_NOTE = "All orders are made by request only. Food prices depend on the type of order and the quantity."

# (section, [(dish, details)]) in the order printed on the menu.
MENU = [
    ("Popular Northern Foods", [
        ("T.Z & Ayoyo Soup", "With beef, goat or cow meat."),
        ("T.Z & Bra Soup", ""),
        ("T.Z & Dry Okro Soup or Fresh Okro", ""),
        ("T.Z & Ayoyo Mix with Okro", ""),
        ("Rice Balls & Bra Soup, Peanut Soup or Palm Nut Soup", ""),
        ("Fufu with Light Soup, Peanut Soup or Palm Nut Soup", "Choice of meat."),
        ("Banku & Okro Stew or Soup", ""),
        ("Waakye & Stew (Shito)", ""),
        ("Pounded Yam Fufu & Agushi Soup", ""),
    ]),
    ("Local Northern Delight", [
        ("Local Rice & Dawadawa Mix with Amani (Dry Fish)", ""),
        ("Tubani", ""),
        ("Yoroyoro", ""),
        ("Aduwaa with Gari (Pigeon Peas)", ""),
        ("Yaama", ""),
    ]),
    ("Pastries", [
        ("Fish Pie", "All pies with your choice of fry or bake."),
        ("Meat Pie", "All pies with your choice of fry or bake."),
        ("Vegetable Pie", "All pies with your choice of fry or bake."),
        ("Egg Pie", "All pies with your choice of fry or bake."),
        ("Boffrot Wet/Dry", ""),
        ("Chips", ""),
        ("Swet Bud", ""),
    ]),
    ("Pure Ghanaian", [
        ("Kenkey with Fish", "Grilled or fried."),
        ("Banku with Fish", ""),
        ("Red Red", "Sweet plantain and bean stew."),
        ("Kontombre Stew with Plantains", ""),
        ("Yam Porridge", ""),
        ("Yam with Stew", "Choice of stew: beans or spinach."),
        ("Fried Yam with Fish & Pepper", ""),
    ]),
    ("Appetizers (Hot/Mild)", [
        ("Soya", ""),
        ("Fried Fish", ""),
        ("Fried Chicken", ""),
        ("Fried Meat", "Goat, beef, sheep or chicken."),
        ("Grilled Fish", ""),
        ("Turkey Soya", ""),
        ("Kelewele", "Sweet plantains with spices."),
    ]),
    ("Continental Dishes", [
        ("Fried Rice & Assorted Meat", "Chicken, beef or cow liver mix."),
        ("Fried Rice with Mix Vegetables", ""),
        ("Fried Rice with Seafood", "Fish or shrimps."),
        ("Fried Rice with Chicken", "Grilled or fried."),
        ("Jollof Rice with Assorted Meat", ""),
        ("Jollof Rice with Mix Vegetables", ""),
        ("Rice & Stew with Meat", ""),
        ("Rice & Spinach Stew", ""),
        ("Rice with Vegetables Stew", ""),
        ("Rice with Beans Stew", ""),
        ("Rice with Soup", "Peanut soup or light soup."),
    ]),
    ("Local Healthy Drinks", [
        ("Sobolo Juice", ""),
        ("Puhaa Juice (Tamarind) with Ginger & Herbs", "Hot or mild."),
        ("Fresh Pineapple Juice", ""),
        ("Fresh Mango with Mix Fruits Juice", "Seasonal."),
    ]),
]

# Prepared food is made and handed over in Worcester, Massachusetts, so it can only be ordered for the United States.
HOME_COUNTRY = "US"


class Command(BaseCommand):
    help = "Create the QT Eatery menu in the shop (sub-category of Food, one draft dish per item). Safe to run again."

    @transaction.atomic
    def handle(self, *args, **options):
        create_taxonomy()
        food = Category.objects.filter(name="Food", parent=None).first() or Category.objects.create(name="Food", sort_order=1)
        category = Category.objects.filter(slug=slugify(CATEGORY_NAME)).first()
        if category is None:
            category = Category.objects.create(name=CATEGORY_NAME, parent=food, sort_order=0, is_menu=True, menu_note=MENU_NOTE)
            self.stdout.write("  added  category QT Eatery (under Food)")
        else:
            changed = []
            if not category.is_menu:
                category.is_menu = True
                changed.append("is_menu")
            if not category.menu_note:
                category.menu_note = MENU_NOTE
                changed.append("menu_note")
            if changed:
                category.save(update_fields=changed)
            self.stdout.write("  kept   category QT Eatery")

        others = sorted(c.alpha_2 for c in pycountry.countries if c.alpha_2 != HOME_COUNTRY)
        ptype, made = ProductType.objects.get_or_create(
            name="Prepared food",
            defaults={"restricted_countries": others, "restriction_note": "Made and handed over in Worcester, Massachusetts. United States orders only.",
                      "notes": "Freshly prepared meals. No export."},
        )
        self.stdout.write(f"  {'added' if made else 'kept '}  product type Prepared food")

        added = 0
        order = 0
        for section, dishes in MENU:
            for name, details in dishes:
                order += 1
                slug = slugify(f"qt-eatery-{name}")[:200]
                p = Product.objects.filter(slug=slug).first()
                if p is not None:
                    continue
                p = Product.objects.create(
                    name=name, slug=slug, description=details, category=category, origin_country=HOME_COUNTRY, maker="QT Eatery",
                    base_price=0, status=ProductStatus.DRAFT, made_to_order=True, lead_time_days=1, product_type=ptype,
                    menu_section=section, menu_order=order,
                )
                v = ProductVariant.objects.create(product=p, sku=f"QTE-{slug[10:58]}", name="")
                Inventory.objects.create(variant=v)
                added += 1
        total = Product.objects.filter(category=category).count()
        self.stdout.write(self.style.SUCCESS(
            f"{added} dishes added; {total} on the QT Eatery menu. Set the prices in the admin (Menu prices) and put the dishes on sale."))

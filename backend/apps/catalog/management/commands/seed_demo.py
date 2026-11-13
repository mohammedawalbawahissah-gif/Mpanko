from django.core.management.base import BaseCommand

from apps.accounts.models import Role, User
from apps.catalog.models import Category, Inventory, Product, ProductStatus, ProductVariant

DEMO = [
    ("Textiles", "Kente Scarf", "Hand-woven kente in traditional gold and green.", "GH", "Bonwire Weavers", "48.00", [("KENTE-GRN", "Green / Gold", 25), ("KENTE-BLU", "Blue / Gold", 12)]),
    ("Beauty", "Raw Shea Butter (250g)", "Unrefined shea butter from the Northern Region.", "GH", "Tamale Women's Co-op", "14.00", [("SHEA-250", "250g", 80)]),
    ("Home", "Hand-woven Bolga Basket", "Colourful market basket from Bolgatanga.", "GH", "Bolga Artisans", "32.00", [("BOLGA-M", "Medium", 30), ("BOLGA-L", "Large", 18)]),
    ("Fashion", "Ankara Wrap Dress", "Vibrant wax-print wrap dress, tailored in Accra.", "GH", "Accra Atelier", "75.00", [("ANK-S", "Small", 10), ("ANK-M", "Medium", 14), ("ANK-L", "Large", 9)]),
]


class Command(BaseCommand):
    help = "Create demo categories/products and (in DEBUG) demo staff accounts for local development."

    def handle(self, *args, **options):
        for cat, name, desc, origin, maker, price, variants in DEMO:
            category, _ = Category.objects.get_or_create(name=cat)
            product, created = Product.objects.get_or_create(
                name=name,
                defaults=dict(description=desc, category=category, origin_country=origin, maker=maker, base_price=price, status=ProductStatus.PUBLISHED),
            )
            if created:
                for sku, vname, qty in variants:
                    v = ProductVariant.objects.create(product=product, sku=sku, name=vname)
                    Inventory.objects.create(variant=v, quantity=qty)
        self.stdout.write(self.style.SUCCESS(f"{Product.objects.count()} products available."))

        from django.conf import settings

        if settings.DEBUG:
            for email, role in [("admin@mpanko.test", Role.SUPER_ADMIN), ("customer@mpanko.test", Role.CUSTOMER)]:
                if not User.objects.filter(email=email).exists():
                    user = User.objects.create_user(email=email, password="Mpanko-demo-123", role=role)
                    if role == Role.SUPER_ADMIN:
                        user.is_staff = user.is_superuser = True
                        user.save()
            self.stdout.write("Demo logins (DEBUG only): admin@mpanko.test / customer@mpanko.test, password Mpanko-demo-123")

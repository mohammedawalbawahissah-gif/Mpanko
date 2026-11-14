from django.core.management.base import BaseCommand

from apps.accounts.models import Role, User
from apps.catalog.management.commands.seed_categories import create_taxonomy
from apps.catalog.models import Category, Inventory, Product, ProductStatus, ProductType, ProductVariant

# (sub-category, name, description, origin, maker, price in USD, [(sku, variant name, stock)], kind of goods)
DEMO = [
    ("Kente and Woven Cloth", "Kente Scarf", "Hand-woven kente in traditional gold and green.", "GH", "Bonwire Weavers", "48.00", [("KENTE-GRN", "Green / Gold", 25), ("KENTE-BLU", "Blue / Gold", 12)], "General goods"),
    ("Shea and Body Butters", "Raw Shea Butter (250g)", "Unrefined shea butter from the Northern Region.", "GH", "Tamale Women's Co-op", "14.00", [("SHEA-250", "250g", 80)], "Cosmetics and skin care"),
    ("Baskets and Storage", "Hand-woven Bolga Basket", "Colourful market basket from Bolgatanga.", "GH", "Bolga Artisans", "32.00", [("BOLGA-M", "Medium", 30), ("BOLGA-L", "Large", 18)], "General goods"),
    ("Women's Fashion", "Ankara Wrap Dress", "Vibrant wax-print wrap dress, tailored in Accra.", "GH", "Accra Atelier", "75.00", [("ANK-S", "Small", 10), ("ANK-M", "Medium", 14), ("ANK-L", "Large", 9)], "General goods"),
    ("Spices and Seasonings", "Suya Spice Blend (200g)", "Peanut and pepper rub for grilled meat, ground in Kano.", "NG", "Kano Spice House", "9.50", [("SUYA-200", "200g", 120)], "Food and drink"),
    ("Grains and Cereals", "Stone-milled Fonio (1kg)", "Ancient grain, cooks in five minutes.", "SN", "Casamance Growers", "12.00", [("FONIO-1K", "1kg", 60)], "Food and drink"),
    ("Cooking Oils", "Cold-pressed Palm Oil (500ml)", "Deep red, unrefined palm oil.", "GH", "Ashanti Oil Press", "11.00", [("PALM-500", "500ml", 45)], "Food and drink"),
    ("Snacks and Sweets", "Roasted Groundnut Brittle", "Sticky, crunchy kuli-kuli style brittle.", "GH", "Tamale Women's Co-op", "6.00", [("BRIT-150", "150g", 90)], "Food and drink"),
    ("Tea and Herbal Infusions", "Hibiscus Sobolo Tea", "Dried hibiscus petals for a tart, ruby drink.", "GH", "Volta Herbals", "8.00", [("SOBO-100", "100g", 70)], "Food and drink"),
    ("Coffee and Cocoa", "Single-origin Cocoa Powder", "Unsweetened cocoa from Western Region beans.", "GH", "Kuapa Cocoa", "13.00", [("COCOA-250", "250g", 55)], "Food and drink"),
    ("Juices and Soft Drinks", "Baobab Juice (330ml, 6 pack)", "Tangy baobab fruit drink, no added sugar.", "SN", "Baobab Collective", "18.00", [("BAOB-6", "6 pack", 40)], "Food and drink"),
    ("Paintings", "Market Day, acrylic on canvas", "Original painting of a Kumasi market, 60 x 80 cm.", "GH", "Kofi Mensah", "320.00", [("ART-MKT", "Unframed", 1)], "General goods"),
    ("Sculpture and Carvings", "Carved Ebony Elephant", "Hand-carved from a single block of ebony.", "KE", "Makonde Carvers", "140.00", [("CARV-ELE", "25 cm", 6)], "Plant and wood products"),
    ("Beadwork", "Krobo Glass Bead Necklace", "Recycled-glass beads, strung by hand.", "GH", "Odumase Beadmakers", "38.00", [("KROBO-NK", "Single strand", 22)], "General goods"),
    ("Stools and Chairs", "Ashanti Carved Stool", "Traditional one-piece wooden stool.", "GH", "Ntonso Woodworks", "85.00", [("STOOL-S", "Small", 8), ("STOOL-L", "Large", 5)], "Plant and wood products"),
    ("Living Room Furniture", "Rattan Lounge Chair", "Woven rattan on a teak frame.", "NG", "Lagos Cane Co.", "220.00", [("RATT-CH", "Natural", 7)], "Plant and wood products"),
    ("Office Furniture", "Walnut Standing Desk", "Solid walnut top, steel frame, 140 cm.", "KE", "Nairobi Joinery", "460.00", [("DESK-140", "140 cm", 4)], "Plant and wood products"),
    ("Phones and Tablets", "Android Smartphone 128GB", "6.5 inch display, dual SIM, 5000 mAh battery.", "CN", "Mpanko Electronics", "189.00", [("PH-128-BK", "Black", 30), ("PH-128-BL", "Blue", 20)], "Batteries and electronics"),
    ("Computers and Laptops", "14-inch Laptop, 8GB / 256GB", "Everyday laptop for study and work.", "CN", "Mpanko Electronics", "429.00", [("LT-14-8", "Silver", 12)], "Batteries and electronics"),
    ("Audio and Headphones", "Wireless Headphones", "Over-ear, 30 hours of battery.", "CN", "Mpanko Electronics", "55.00", [("HP-BT", "Black", 40)], "Batteries and electronics"),
    ("Solar and Power", "Portable Solar Lantern + Charger", "Lights a room and charges a phone.", "KE", "SunKing Kenya", "29.00", [("SOL-LAN", "Single", 65)], "Batteries and electronics"),
    ("Bags and Purses", "Leather Weekend Bag", "Vegetable-tanned goat leather with brass fittings.", "GH", "Tamale Leatherworks", "120.00", [("BAG-WK", "Tan", 10), ("BAG-WK-BK", "Black", 8)], "Animal products"),
    ("Jewellery", "Brass Adinkra Pendant", "Cast brass pendant on a waxed cord.", "GH", "Ahwiaa Brass Casters", "26.00", [("ADK-PEN", "Gye Nyame", 30)], "General goods"),
    ("Hats and Scarves", "Straw Fedora from Bolgatanga", "Hand-plaited straw with a leather band.", "GH", "Bolga Artisans", "34.00", [("HAT-M", "Medium", 14), ("HAT-L", "Large", 10)], "General goods"),
    ("Skin Care", "Black Soap and Aloe Face Wash", "Traditional ose-dua black soap, gentle formula.", "GH", "Tamale Women's Co-op", "10.00", [("BSOAP-200", "200g", 75)], "Cosmetics and skin care"),
    ("Hair Care", "Chebe Hair Butter", "Strengthening butter blended with chebe powder.", "TD", "Sahel Botanicals", "21.00", [("CHEBE-200", "200g", 35)], "Cosmetics and skin care"),
    ("Home Decor", "Mudcloth Throw Pillow", "Bogolan-dyed cotton cover with insert.", "ML", "Segou Dyers", "28.00", [("MUD-PIL", "45 cm", 26)], "General goods"),
    ("Kitchenware", "Hand-carved Wooden Spoon Set", "Set of four serving spoons.", "GH", "Ntonso Woodworks", "22.00", [("SPOON-4", "Set of 4", 40)], "Plant and wood products"),
    ("Fiction", "Things Fall Apart (paperback)", "Chinua Achebe's classic, 1958.", "NG", "Heinemann", "11.00", [("BK-TFA", "Paperback", 50)], "General goods"),
    ("Children's Books", "Anansi the Spider: Four Tales", "Illustrated folk tales for ages 5 to 9.", "GH", "Sankofa Press", "9.00", [("BK-ANA", "Paperback", 35)], "General goods"),
    ("Stationery and Office Supplies", "Kente-cover Notebook", "A5, 160 pages, lay-flat binding.", "GH", "Sankofa Press", "7.50", [("NB-KEN", "A5", 100)], "General goods"),
    ("Agricultural Produce", "Raw Cashew Nuts (25kg sack)", "Graded, sun-dried, for processors.", "GH", "Brong-Ahafo Growers", "74.00", [("CASH-25", "25kg", 50)], "Plant and wood products"),
    ("Shea Nuts and Cocoa Beans", "Dried Shea Nuts (50kg)", "Cleaned and sorted, for butter pressing.", "GH", "Tamale Women's Co-op", "58.00", [("SHEANUT-50", "50kg", 40)], "Plant and wood products"),
    ("Timber and Wood", "Air-dried Teak Boards", "Pack of ten boards, 2.4 m.", "GH", "Ashanti Timber", "190.00", [("TEAK-10", "Pack of 10", 15)], "Plant and wood products"),
    ("Passenger Cars", "Used Toyota Corolla 2016", "Low mileage, service history, left-hand drive.", "JP", "Mpanko Motors", "6800.00", [("CAR-COR16", "Silver", 1)], None),
    ("Motorcycles and Tricycles", "125cc Commuter Motorcycle", "Fuel-efficient and easy to repair.", "CN", "Mpanko Motors", "1450.00", [("MC-125", "Red", 6)], None),
    ("Auto Parts", "Brake Pad Set, front", "Fits most compact sedans.", "DE", "Mpanko Motors", "32.00", [("BRK-F", "Front pair", 40)], None),
    ("Seeds and Seedlings", "Improved Maize Seed (5kg)", "Drought-tolerant hybrid, certified.", "GH", "Northern Seed Co.", "19.00", [("SEED-MZ5", "5kg", 90)], "Plant and wood products"),
    ("Hand and Power Tools", "Cordless Drill Kit", "18V with two batteries and 40 bits.", "CN", "Mpanko Hardware", "69.00", [("DRILL-18", "18V", 18)], "Batteries and electronics"),
    ("Herbal and Traditional", "Moringa Leaf Powder (200g)", "Dried and ground moringa.", "GH", "Volta Herbals", "12.00", [("MOR-200", "200g", 60)], "Herbal and medicinal"),
    ("Drums and Percussion", "Djembe Drum, 30 cm", "Goat-skin head, carved lenke wood body.", "GN", "Conakry Drum Makers", "135.00", [("DJEM-30", "30 cm", 9)], "Plant and wood products"),
    ("Toys and Games", "Oware Board Game", "Carved wooden mancala set with seeds.", "GH", "Ntonso Woodworks", "24.00", [("OWARE", "Standard", 30)], "Plant and wood products"),
]


class Command(BaseCommand):
    help = "Create demo categories/products and (in DEBUG) demo staff accounts for local development."

    def handle(self, *args, **options):
        create_taxonomy()
        for cat, name, desc, origin, maker, price, variants, kind in DEMO:
            category = Category.objects.get(name=cat)
            product, created = Product.objects.get_or_create(
                name=name,
                defaults=dict(
                    description=desc, category=category, origin_country=origin, maker=maker, base_price=price, status=ProductStatus.PUBLISHED,
                    product_type=ProductType.objects.filter(name=kind).first() if kind else None,
                ),
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
            from apps.corporate.models import Business

            for name, sector, summary, featured in [
                ("Demo shop", "Retail", "A placeholder business, so the corporate site has something to list in development.", True),
                ("Demo foods", "Food", "A second placeholder business for local testing.", False),
            ]:
                Business.objects.get_or_create(name=name, defaults=dict(sector=sector, summary=summary, description=summary, is_published=True, is_featured=featured))
            self.stdout.write("Demo logins (DEBUG only): admin@mpanko.test / customer@mpanko.test, password Mpanko-demo-123")

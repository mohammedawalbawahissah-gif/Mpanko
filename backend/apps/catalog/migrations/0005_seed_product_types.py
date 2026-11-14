from django.db import migrations
from django.utils.text import slugify

# Starting kinds of goods. No countries are blocked yet: the client's customs broker supplies those rules,
# and staff enter them under Product types in the admin.
TYPES = [
    ("General goods", "Textiles, baskets, fashion, home items"),
    ("Food and drink", "Often needs food-safety registration and labelling in the destination country"),
    ("Cosmetics and skin care", "Shea butter, soaps, oils: ingredient and labelling rules apply"),
    ("Plant and wood products", "May need a phytosanitary certificate"),
    ("Liquids and powders", "Restricted on some air services"),
    ("Batteries and electronics", "Dangerous-goods rules apply; also tick dangerous goods on the product"),
    ("Herbal and medicinal", "Heavily regulated in most countries"),
    ("Animal products", "Leather, horn and bone are restricted or banned in many countries"),
]


def seed(apps, schema_editor):
    ProductType = apps.get_model("catalog", "ProductType")
    for name, notes in TYPES:
        ProductType.objects.get_or_create(name=name, defaults={"slug": slugify(name), "notes": notes})


class Migration(migrations.Migration):
    dependencies = [("catalog", "0004_launch_features")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]

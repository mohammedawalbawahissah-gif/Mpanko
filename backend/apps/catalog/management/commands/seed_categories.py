from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from apps.catalog.models import Category
from apps.catalog.taxonomy import TAXONOMY


def create_taxonomy() -> int:
    """Create any department or sub-category that does not exist yet (matched by name). Returns how many were added."""
    added = 0
    with transaction.atomic():
        for order, (name, children) in enumerate(TAXONOMY, start=1):
            parent = Category.objects.filter(name=name, parent=None).first() or Category.objects.filter(slug=slugify(name)).first()
            if parent is None:
                parent = Category.objects.create(name=name, sort_order=order)
                added += 1
            elif not parent.sort_order:
                parent.sort_order = order
                parent.save(update_fields=["sort_order"])
            for pos, child in enumerate(children, start=1):
                if Category.objects.filter(slug=slugify(child)).exists() or Category.objects.filter(name=child, parent=parent).exists():
                    continue
                Category.objects.create(name=child, parent=parent, sort_order=pos)
                added += 1
    return added


class Command(BaseCommand):
    help = "Create the starting departments and sub-categories (Food, Beverages, Fashion, Art, Electronics, Cars ...). Safe to run again."

    def handle(self, *args, **options):
        added = create_taxonomy()
        self.stdout.write(self.style.SUCCESS(f"{added} categories added; {Category.objects.count()} in total."))

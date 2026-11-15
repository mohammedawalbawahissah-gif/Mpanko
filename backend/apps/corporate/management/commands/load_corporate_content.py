"""Load Teefa Fuseini's real wording, logos and photo onto the corporate website. Safe to run more than once.

    python manage.py load_corporate_content           fills in anything that is empty and leaves staff edits alone
    python manage.py load_corporate_content --force   overwrites the words and pictures this command owns

Run it once after the migration. Everything it loads can then be edited under Businesses, Pages and Site details in the admin.
"""
import os
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from apps.corporate.models import Business, SitePage, SiteProfile

MEDIA = Path(__file__).resolve().parents[2] / "seed_media"

INTRO = ("Mpanko is the home of the businesses, services and community work of Teefa Fuseini: food, fashion, events, beauty, "
         "insurance and a foundation, all rooted in African heritage.")

ABOUT = """Mpanko is the umbrella that brings together everything Teefa Fuseini builds. It is a group of businesses, a shop for African-made goods and a set of community commitments, all under one name and one set of values.

The story took shape in 2020, in the middle of the COVID-19 pandemic, when Teefa founded QT Eatery to serve authentic African cuisine. Her work has grown with the people she serves. It now includes events and 360 photo booth rentals, Rapsana Designz for clothing that carries African heritage, QT Make-Up Artistry, and insurance guidance for individuals and families through World Financial Group. Alongside the businesses sits QT Foundation, which supports women and vulnerable children, and her role as Magazia (Queen Mother), a traditional leadership title rooted in the Dagomba heritage of Northern Ghana.

Mpanko is where these pieces meet. It is rooted in Northern Ghana and led from Massachusetts, USA, and it stands for a simple promise: lead with integrity, preserve heritage and empower the communities we belong to."""

QUOTE = ("I believe that true leadership goes beyond titles, professional achievements, and personal success. It is about the lives we touch, "
         "the opportunities we create, and the positive difference we make in our communities. My journey is guided by a passion for "
         "entrepreneurship, the preservation of African heritage, the empowerment of women, and the belief that every child deserves an "
         "opportunity for a brighter future. I remain committed to building a legacy that inspires others to lead with purpose, serve with "
         "compassion, and pursue excellence in everything they do.")

DISCLAIMER = ("Teefa Fuseini is an insurance agent with World Financial Group (WFG). Insurance products, availability and licensing vary by state "
              "and by carrier, and not every product is available in every state. The information on this page is general. It is not an offer, "
              "a quote or personalised financial advice. Contact Teefa to talk about your own situation.")

BUSINESSES = [
    dict(slug="qt-eatery", name="QT Eatery", sector="Food and catering", sort_order=10,
         tagline="Authentic African cuisine and catering.",
         summary="A culinary and catering business serving authentic African cuisine and a range of culinary experiences.",
         description=("QT Eatery was founded in 2020, during the COVID-19 pandemic, by Teefa Fuseini. It is a culinary and catering business that "
                      "specialises in authentic African cuisine and diverse culinary experiences.\n\n"
                      "Teefa is an Executive Chef with ServSafe and allergen certifications. She brings professional cooking skills, food safety "
                      "knowledge and a commitment to good service to every order."),
         highlights="Authentic African cuisine\nCatering\nLed by an Executive Chef\nServSafe and allergen certified",
         logo="qt-eatery-logo.jpg", logo_alt="QT Eatery logo: the letters QT above a waiter's hand holding a tray", cta_label="Order on the Mpanko shop", cta_shop=True),
    dict(slug="events-planning", name="Events Planning", sector="Events", location="Worcester, Massachusetts, USA", sort_order=20,
         tagline="H&A 360 Photobooth Rentals, for all events.",
         summary="Events planning, with H&A 360 Photobooth Rentals available for all kinds of events.",
         description=("Events Planning is the part of Mpanko that helps people celebrate. Its service is H&A 360 Photobooth Rentals, a 360 photo "
                      "booth available for all events.\n\nIt is based in Worcester, Massachusetts, USA. Send us a message to check a date and book."),
         highlights="H&A 360 Photobooth Rentals\nFor all events\nWorcester, Massachusetts, USA",
         image="h-and-a-360-photobooth.jpg", image_alt="H&A 360 Photobooth Rentals flyer: three people dancing on a 360 photo booth platform",
         cta_label="Book now"),
    dict(slug="rapsana-designz", name="Rapsana Designz", sector="Fashion", sort_order=30,
         tagline="Clothing that carries African heritage.",
         summary="A fashion brand that promotes African heritage, identity and creativity through clothing.",
         description=("Rapsana Designz was founded in 2025. It is a fashion brand dedicated to promoting African heritage, identity and creativity "
                      "through clothing.\n\nThe brand reflects Teefa's vision of fashion as a platform for cultural expression."),
         highlights="African heritage, identity and creativity\nClothing\nFounded in 2025", cta_label="Ask about the collection"),
    dict(slug="qt-make-up-artistry", name="QT Make-Up Artistry", sector="Beauty", sort_order=40,
         tagline="Professional make-up artistry.",
         summary="Professional make-up artistry.",
         description="QT Make-Up Artistry is Teefa Fuseini's make-up business. Send us a message to ask about services and to book an appointment.",
         highlights="", cta_label="Book an appointment"),
    dict(slug="insurance", name="Insurance with WFG", sector="Financial services", sort_order=50,
         tagline="Helping families understand their coverage options.",
         summary="Guidance on insurance products and coverage options, through World Financial Group (WFG).",
         description=("In 2025, Teefa Fuseini began her career in insurance as an agent with World Financial Group (WFG).\n\n"
                      "She helps individuals and families understand insurance products, explore their coverage options and make informed "
                      "decisions about their financial protection."),
         highlights="Agent with World Financial Group (WFG)\nFor individuals and families\nUnderstanding products and coverage options",
         disclaimer=DISCLAIMER, cta_label="Talk about coverage"),
    dict(slug="qt-foundation", name="QT Foundation", sector="Nonprofit", sort_order=60,
         tagline="Solace to all.",
         summary="A nonprofit that empowers women and supports vulnerable children.",
         description=("QT Foundation was founded in 2023 by Teefa Fuseini. It is a nonprofit initiative focused on empowering women and supporting "
                      "vulnerable children, particularly orphans and children who are experiencing homelessness or living on the streets.\n\n"
                      "Its mission centres on care, support, encouragement and opportunities for brighter futures."),
         highlights="Empowering women\nSupporting orphans and children without a home\nCare, support, encouragement and opportunity",
         logo="qt-foundation-logo.jpg", logo_alt="QT Foundation logo with the words Solace to all", cta_label="Donate"),
]

PAGES = [
    dict(slug="founder", title="Teefa Fuseini", kicker="Founder and CEO",
         summary="Business executive, executive chef, insurance professional, Magazia (Queen Mother) and philanthropist.",
         body=("Teefa Fuseini is a business executive, CEO, professional chef, cultural leader and philanthropist. Her work spans hospitality, "
               "fashion, events, beauty, financial services, traditional leadership and philanthropy, and it is built on one aim: creating "
               "opportunities and making a meaningful contribution to society.\n\n"
               "Her leadership philosophy is rooted in integrity, resilience, innovation and service. She believes successful leadership requires "
               "vision, accountability, compassion and a commitment to empowering others, and she pursues a lasting legacy of responsible business "
               "leadership, women's advancement, cultural stewardship and positive social impact."),
         quote=QUOTE, quote_by="Teefa Fuseini",
         highlights=("2019 | Co-founded the Northern Excellence Awards\n2020 | Founded QT Eatery\n2023 | Founded QT Foundation\n"
                     "2024 | Became Magazia (Queen Mother) in Massachusetts, USA\n2025 | Founded Rapsana Designz\n"
                     "2025 | Began her career in insurance with World Financial Group (WFG)")),
    dict(slug="magazia", title="Magazia (Queen Mother)", kicker="Traditional leadership",
         summary="Teefa Fuseini holds the traditional title of Magazia (Queen Mother), rooted in the heritage of the Dagomba people of Northern Ghana.",
         body=("In 2024, Teefa Fuseini assumed the traditional leadership title of Magazia (Queen Mother). The title is rooted in the cultural "
               "heritage and traditions of the Dagomba people of Northern Ghana.\n\n"
               "Through her leadership in Massachusetts, United States, she represents and advocates for women. She promotes cultural preservation, "
               "unity, women's empowerment and stronger relationships within African diaspora communities."),
         highlights=("Title held since 2024\nRooted in Dagomba heritage, Northern Ghana\nServing in Massachusetts, USA\n"
                     "Women's empowerment, cultural preservation and diaspora unity")),
]


class Command(BaseCommand):
    help = "Load the real corporate website content (businesses, founder, Magazia page, About). Safe to repeat."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Overwrite wording and pictures that already exist.")

    def _attach(self, obj, field, filename, force):
        if not filename:
            return
        current = getattr(obj, field)
        if current and not force:
            return
        data = (MEDIA / filename).read_bytes()
        getattr(obj, field).save(filename, ContentFile(data), save=False)

    def handle(self, *args, force=False, **opts):
        shop = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")

        profile = SiteProfile.get()
        default_about = SiteProfile._meta.get_field("about").default
        default_intro = SiteProfile._meta.get_field("intro").default
        if force or not profile.about.strip() or profile.about == default_about:
            profile.about = ABOUT
        if force or not profile.intro.strip() or profile.intro == default_intro:
            profile.intro = INTRO
        profile.save()

        for row in BUSINESSES:
            row = dict(row)
            logo, image = row.pop("logo", ""), row.pop("image", "")
            cta_shop = row.pop("cta_shop", False)
            slug = row.pop("slug")
            b, created = Business.objects.get_or_create(slug=slug, defaults={**row, "is_published": True})
            if not created and force:
                for k, v in row.items():
                    setattr(b, k, v)
                b.is_published = True
            if cta_shop and shop and (created or force) and not b.cta_url:
                b.cta_url = shop
            self._attach(b, "logo", logo, force)
            self._attach(b, "image", image, force)
            b.save()
            self.stdout.write(f"  {'added' if created else 'kept ' if not force else 'reset'}  {b.name}")

        for row in PAGES:
            row = dict(row)
            slug = row.pop("slug")
            page, created = SitePage.objects.get_or_create(slug=slug, defaults={**row, "is_published": True})
            if not created and force:
                for k, v in row.items():
                    setattr(page, k, v)
                page.is_published = True
                page.save()
            self.stdout.write(f"  {'added' if created else 'kept ' if not force else 'reset'}  page {slug}")
        self.stdout.write(self.style.SUCCESS("Corporate content loaded. Check it at your corporate website, and edit it in the admin."))

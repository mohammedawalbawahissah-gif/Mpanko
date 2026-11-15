"""The corporate website's backend: businesses, site profile, contact form and the staff inbox."""
import io
from datetime import timedelta

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import AuditLog, Role
from apps.corporate.models import Business, ContactMessage, SiteProfile
from tests.conftest import client_for, make_user

pytestmark = pytest.mark.django_db


def biz(name="Mpanko", **kw):
    kw.setdefault("summary", "An online store.")
    kw.setdefault("is_published", True)
    return Business.objects.create(name=name, **kw)


def png(size=(8, 8)):
    buf = io.BytesIO()
    Image.new("RGB", size, "#1b2455").save(buf, "PNG")
    return SimpleUploadedFile("logo.png", buf.getvalue(), content_type="image/png")


# ---- public site -------------------------------------------------------------------------------------------

def test_site_lists_only_published_businesses_featured_first(api):
    biz("Zeta", sort_order=1)
    biz("Alpha", sort_order=5, is_featured=True)
    biz("Hidden draft", is_published=False)
    data = api.get("/api/v1/corporate/site/").json()
    assert [b["name"] for b in data["businesses"]] == ["Alpha", "Zeta"]
    assert "description" not in data["businesses"][0]
    assert data["profile"]["company_name"]


def test_site_needs_no_sign_in_and_has_a_default_profile(api):
    assert SiteProfile.objects.count() == 0
    r = api.get("/api/v1/corporate/site/")
    assert r.status_code == 200 and r.json()["businesses"] == []
    assert SiteProfile.objects.count() == 1


def test_business_page_by_slug_and_drafts_are_invisible(api):
    b = biz("Wolbi Foods", description="Para one.\n\nPara two.")
    draft = biz("Secret", is_published=False)
    r = api.get(f"/api/v1/corporate/businesses/{b.slug}/")
    assert r.status_code == 200 and r.json()["description"].startswith("Para one")
    assert api.get(f"/api/v1/corporate/businesses/{draft.slug}/").status_code == 404
    assert api.get("/api/v1/corporate/businesses/nope/").status_code == 404


def test_slugs_are_made_from_the_name_and_stay_unique():
    a, b = biz("Mpanko Store"), biz("Mpanko Store")
    assert a.slug == "mpanko-store" and b.slug == "mpanko-store-2"


def test_only_web_addresses_are_accepted_for_links(admin):
    c = client_for(admin)
    r = c.post("/api/v1/corporate/manage/businesses/", {"name": "X", "website_url": "javascript:alert(1)"}, format="json")
    assert r.status_code == 400 and "website_url" in r.json()
    r = c.put("/api/v1/corporate/manage/profile/", {"linkedin_url": "ftp://example.com"}, format="json")
    assert r.status_code == 400


# ---- contact form ------------------------------------------------------------------------------------------

GOOD = {"name": "Ama Mensah", "email": "ama@example.com", "message": "Do you ship to Canada, please?"}


def test_contact_form_stores_the_message_and_emails_staff(api, admin, django_capture_on_commit_callbacks):
    b = biz()
    SiteProfile.get().__class__.objects.filter(pk=1).update(contact_email="hello@client.example")
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        r = api.post("/api/v1/corporate/contact/", {**GOOD, "business": b.slug, "phone": "+233200000000"}, format="json")
    assert r.status_code == 201
    m = ContactMessage.objects.get()
    assert (m.name, m.email, m.business_id, m.status) == ("Ama Mensah", "ama@example.com", b.pk, "new")
    recipients = {to for msg in mail.outbox for to in msg.to}
    assert {"admin@example.com", "hello@client.example"} <= recipients
    assert "Do you ship to Canada" in mail.outbox[0].body and "Mpanko" in mail.outbox[0].body


def test_contact_form_checks_its_input(api):
    assert api.post("/api/v1/corporate/contact/", {**GOOD, "email": "nope"}, format="json").status_code == 400
    assert api.post("/api/v1/corporate/contact/", {**GOOD, "message": "hi"}, format="json").status_code == 400
    assert api.post("/api/v1/corporate/contact/", {**GOOD, "name": "   "}, format="json").status_code == 400
    assert api.post("/api/v1/corporate/contact/", {**GOOD, "message": "x" * 4001}, format="json").status_code == 400
    assert ContactMessage.objects.count() == 0


def test_a_filled_honeypot_is_ignored_silently(api):
    r = api.post("/api/v1/corporate/contact/", {**GOOD, "website": "http://spam.example"}, format="json")
    assert r.status_code == 201 and ContactMessage.objects.count() == 0 and len(mail.outbox) == 0


def test_an_unknown_or_draft_business_is_not_attached(api):
    draft = biz("Draft", is_published=False)
    api.post("/api/v1/corporate/contact/", {**GOOD, "business": draft.slug}, format="json")
    assert ContactMessage.objects.get().business is None


def test_contact_form_is_rate_limited(api, monkeypatch):
    from apps.corporate.views import ContactThrottle

    monkeypatch.setattr(ContactThrottle, "THROTTLE_RATES", {"corporate_contact": "2/hour"})
    codes = [api.post("/api/v1/corporate/contact/", GOOD, format="json").status_code for _ in range(3)]
    assert codes == [201, 201, 429]


# ---- staff -------------------------------------------------------------------------------------------------

def test_only_store_admins_manage_businesses(customer, finance, fulfillment, admin):
    body = {"name": "New one", "summary": "Hi"}
    for u in (customer, finance, fulfillment):
        assert client_for(u).post("/api/v1/corporate/manage/businesses/", body, format="json").status_code == 403
    assert APIClient().post("/api/v1/corporate/manage/businesses/", body, format="json").status_code == 401
    assert client_for(admin).post("/api/v1/corporate/manage/businesses/", body, format="json").status_code == 201


def test_a_business_cannot_be_published_without_a_summary(admin):
    c = client_for(admin)
    r = c.post("/api/v1/corporate/manage/businesses/", {"name": "Bare", "is_published": True}, format="json")
    assert r.status_code == 400 and "summary" in r.json()
    r = c.post("/api/v1/corporate/manage/businesses/", {"name": "Bare", "is_published": False}, format="json")
    assert r.status_code == 201


def test_create_edit_unpublish_and_delete_are_audited(admin, api):
    c = client_for(admin)
    r = c.post("/api/v1/corporate/manage/businesses/", {"name": "Wolbi Health", "summary": "Care.", "is_published": True}, format="json")
    pk, slug = r.json()["id"], r.json()["slug"]
    assert api.get(f"/api/v1/corporate/businesses/{slug}/").status_code == 200
    assert c.patch(f"/api/v1/corporate/manage/businesses/{pk}/", {"is_published": False}, format="json").status_code == 200
    assert api.get(f"/api/v1/corporate/businesses/{slug}/").status_code == 404
    assert c.delete(f"/api/v1/corporate/manage/businesses/{pk}/").status_code == 204
    actions = list(AuditLog.objects.order_by("id").values_list("action", flat=True))
    assert actions == ["corporate.business.create", "corporate.business.update", "corporate.business.delete"]


def test_logo_upload_replace_and_remove(admin, api, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    c = client_for(admin)
    r = c.post("/api/v1/corporate/manage/businesses/", {"name": "Logo Co", "summary": "x", "is_published": "true", "logo": png(), "logo_alt": "Logo"}, format="multipart")
    assert r.status_code == 201, r.content
    pk, slug = r.json()["id"], r.json()["slug"]
    assert r.json()["logo_url"].startswith("http") and "corporate/" in r.json()["logo_url"]
    public = api.get(f"/api/v1/corporate/businesses/{slug}/").json()
    assert public["logo"] and public["logo_alt"] == "Logo"
    r = c.patch(f"/api/v1/corporate/manage/businesses/{pk}/", {"remove_logo": "true"}, format="multipart")
    assert r.status_code == 200 and r.json()["logo_url"] == ""


def test_a_file_that_is_not_an_image_is_refused(admin, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
    r = client_for(admin).post("/api/v1/corporate/manage/businesses/", {"name": "Bad", "logo": bad}, format="multipart")
    assert r.status_code == 400 and "logo" in r.json()


def test_profile_edit_is_store_admin_only_and_audited(admin, finance):
    assert client_for(finance).put("/api/v1/corporate/manage/profile/", {"company_name": "X"}, format="json").status_code == 403
    r = client_for(admin).put("/api/v1/corporate/manage/profile/", {"company_name": "Wolbi Group", "about": "A.\n\nB."}, format="json")
    assert r.status_code == 200 and SiteProfile.get().company_name == "Wolbi Group"
    assert AuditLog.objects.filter(action="corporate.profile.update").count() == 1


def test_support_and_store_admin_read_enquiries_others_cannot(admin, api, customer, finance):
    api.post("/api/v1/corporate/contact/", GOOD, format="json")
    support = make_user("help@example.com", Role.SUPPORT)
    for u in (admin, support):
        r = client_for(u).get("/api/v1/corporate/manage/messages/")
        assert r.status_code == 200 and r.json()["results"][0]["email"] == "ama@example.com"
    for u in (customer, finance):
        assert client_for(u).get("/api/v1/corporate/manage/messages/").status_code == 403
    assert APIClient().get("/api/v1/corporate/manage/messages/").status_code == 401


def test_marking_an_enquiry_handled_records_who_and_when(admin, api):
    api.post("/api/v1/corporate/contact/", GOOD, format="json")
    m = ContactMessage.objects.get()
    c = client_for(admin)
    r = c.patch(f"/api/v1/corporate/manage/messages/{m.pk}/", {"status": "handled", "staff_note": "Replied by email."}, format="json")
    assert r.status_code == 200 and r.json()["handled_by_name"] == "admin@example.com" and r.json()["handled_at"]
    assert c.get("/api/v1/corporate/manage/messages/?status=new").json()["results"] == []
    r = c.patch(f"/api/v1/corporate/manage/messages/{m.pk}/", {"status": "new"}, format="json")
    assert r.json()["handled_at"] is None


def test_the_visitors_words_cannot_be_changed_by_staff(admin, api):
    api.post("/api/v1/corporate/contact/", GOOD, format="json")
    m = ContactMessage.objects.get()
    client_for(admin).patch(f"/api/v1/corporate/manage/messages/{m.pk}/", {"message": "edited", "email": "x@y.z"}, format="json")
    m.refresh_from_db()
    assert m.message == GOOD["message"] and m.email == "ama@example.com"
    assert client_for(admin).delete(f"/api/v1/corporate/manage/messages/{m.pk}/").status_code == 405


def test_old_handled_enquiries_are_removed_but_new_ones_are_kept(api, settings):
    from apps.privacy.services import apply_retention

    settings.RETENTION_HANDLED_ENQUIRY_DAYS = 30
    for i in range(3):
        api.post("/api/v1/corporate/contact/", {**GOOD, "email": f"p{i}@example.com"}, format="json")
    old, recent, unhandled = ContactMessage.objects.order_by("id")
    old.status, old.handled_at = "handled", timezone.now() - timedelta(days=40)
    recent.status, recent.handled_at = "handled", timezone.now() - timedelta(days=5)
    unhandled.created_at = timezone.now() - timedelta(days=400)
    for m in (old, recent, unhandled):
        m.save()
    assert apply_retention()["handled_enquiries"] == 1
    assert set(ContactMessage.objects.values_list("email", flat=True)) == {"p1@example.com", "p2@example.com"}


def test_site_profile_can_carry_two_phone_numbers_with_names(api):
    p = SiteProfile.load() if hasattr(SiteProfile, "load") else SiteProfile.objects.first() or SiteProfile.objects.create()
    p.phone, p.phone_label, p.phone_2, p.phone_2_label = "+233 24 000 0000", "Sales", "+233 20 111 2222", "Support"
    p.save()
    profile = api.get("/api/v1/corporate/site/").json()["profile"]
    assert (profile["phone"], profile["phone_label"]) == ("+233 24 000 0000", "Sales")
    assert (profile["phone_2"], profile["phone_2_label"]) == ("+233 20 111 2222", "Support")


# ---- services, site pages and the content loader -------------------------------------------------------------

def test_site_returns_published_pages_and_service_extras(api):
    from apps.corporate.models import SitePage
    biz("QT Foundation", highlights="Scholarships\nFood drives", cta_label="Donate", disclaimer="Small print.")
    SitePage.objects.create(slug="founder", title="Teefa Fuseini", is_published=True, highlights="2020 | Started")
    SitePage.objects.create(slug="magazia", title="Magazia", is_published=False)
    data = api.get("/api/v1/corporate/site/").json()
    assert [p["slug"] for p in data["pages"]] == ["founder"]
    detail = api.get(f"/api/v1/corporate/businesses/{data['businesses'][0]['slug']}/").json()
    assert detail["cta_label"] == "Donate" and detail["disclaimer"] == "Small print."
    assert detail["highlights"] == ["Scholarships", "Food drives"]


def test_staff_can_edit_site_pages_and_customers_cannot(admin, customer):
    from apps.corporate.models import SitePage
    admin, customer = client_for(admin), client_for(customer)
    r = admin.post("/api/v1/corporate/manage/pages/", {"slug": "magazia", "title": "Magazia", "is_published": "true"}, format="multipart")
    assert r.status_code == 201, r.content
    page = SitePage.objects.get(slug="magazia")
    assert admin.patch(f"/api/v1/corporate/manage/pages/{page.id}/", {"summary": "New."}, format="multipart").status_code == 200
    assert customer.get("/api/v1/corporate/manage/pages/").status_code in (401, 403)


def test_load_corporate_content_is_safe_to_run_twice_and_keeps_edits(settings, tmp_path):
    from django.core.management import call_command
    from apps.corporate.models import SitePage
    settings.MEDIA_ROOT = tmp_path
    call_command("load_corporate_content")
    count = Business.objects.count()
    assert count >= 5 and SitePage.objects.filter(slug__in=["founder", "magazia"]).count() == 2
    b = Business.objects.first()
    b.tagline = "Edited by staff"
    b.save()
    call_command("load_corporate_content")
    assert Business.objects.count() == count
    assert Business.objects.filter(slug="abochi-grills").exists()
    assert Business.objects.get(slug="rabsana-designz").cta_label == "Go to shop to order"
    assert "Abochi" in Business.objects.get(slug="qt-eatery").description
    assert Business.objects.get(pk=b.pk).tagline == "Edited by staff"


def test_loader_corrects_the_old_rapsana_spelling_everywhere(settings, tmp_path):
    from django.core.management import call_command
    from apps.corporate.models import SitePage
    settings.MEDIA_ROOT = tmp_path
    biz("Rapsana Designz", slug="rapsana-designz", description="Rapsana Designz was founded in 2025.")
    SitePage.objects.create(slug="founder", title="Teefa", highlights="2025 | Launched Rapsana Designz", is_published=True)
    profile = SiteProfile.get()
    profile.about = "We run Rapsana Designz."
    profile.save()
    call_command("load_corporate_content")
    b = Business.objects.get(slug="rabsana-designz")
    assert b.name == "Rabsana Designz" and "Rapsana" not in b.description
    assert not Business.objects.filter(slug="rapsana-designz").exists()
    assert "Rapsana" not in SitePage.objects.get(slug="founder").highlights
    assert "Rapsana" not in SiteProfile.get().about

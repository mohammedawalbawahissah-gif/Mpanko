from decimal import Decimal
from io import BytesIO

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

UNPAID = {"pending_payment", "cancelled"}


def _m(order, value):
    return f"{order.currency} {Decimal(value):,.2f}"


def build_invoice(order):
    """A tax invoice / receipt for a paid order, as PDF bytes (CMP-04)."""
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"Invoice {order.number}", author=settings.STORE_LEGAL_NAME)
    ss = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=ss["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#444444"))
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=10, leading=13)
    h = ParagraphStyle("h", parent=ss["Title"], fontSize=22, alignment=0, spaceAfter=2)

    def esc(s):
        return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    addr = order.shipping_address or {}
    ship_lines = [addr.get(k) for k in ("recipient_name", "line1", "line2", "city", "region", "postal_code", "country") if addr.get(k)]
    seller = [settings.STORE_LEGAL_NAME, settings.STORE_ADDRESS] + ([f"Tax ID: {settings.STORE_TAX_ID}"] if settings.STORE_TAX_ID else [])
    paid = order.paid_at.strftime("%d %b %Y") if order.paid_at else ""
    story = [Paragraph("Invoice", h), Paragraph(f"Order {esc(order.number)} · placed {order.created_at.strftime('%d %b %Y')}" + (f" · paid {paid}" if paid else ""), small), Spacer(1, 8 * mm)]
    parties = Table([[Paragraph("<b>From</b><br/>" + "<br/>".join(esc(x) for x in seller), body),
                      Paragraph("<b>Bill and ship to</b><br/>" + "<br/>".join(esc(x) for x in ship_lines) + (f"<br/>{esc(order.contact_email)}" if order.contact_email else ""), body)]],
                    colWidths=[85 * mm, 85 * mm])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [parties, Spacer(1, 8 * mm)]
    rows = [["Item", "Qty", "Unit price", "Amount"]]
    for i in order.items.all():
        name = i.product_name + (f" ({i.variant_name})" if i.variant_name else "")
        rows.append([Paragraph(f"{esc(name)}<br/><font size=8 color='#666666'>SKU {esc(i.sku)}</font>", body), str(i.quantity), _m(order, i.unit_price), _m(order, i.line_total)])
    lines = tuple(rows)
    t = Table(list(lines), colWidths=[85 * mm, 15 * mm, 35 * mm, 35 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#cccccc"))]))
    story += [t, Spacer(1, 5 * mm)]
    tot = [["Subtotal", _m(order, order.subtotal)]]
    if order.discount_total:
        tot.append([f"Discount{' (' + order.coupon_code + ')' if order.coupon_code else ''}", "-" + _m(order, order.discount_total)])
    tot.append(["Shipping", _m(order, order.shipping_total)])
    if order.tax_total:
        tot.append(["Tax", _m(order, order.tax_total)])
    if order.duties_total:
        tot.append(["Import duties", _m(order, order.duties_total)])
    tot.append(["Total", _m(order, order.grand_total)])
    tt = Table(tot, colWidths=[135 * mm, 35 * mm])
    tt.setStyle(TableStyle([("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("LINEABOVE", (0, -1), (-1, -1), 0.75, colors.black)]))
    story.append(tt)
    if order.fx_rate_note:
        story += [Spacer(1, 4 * mm), Paragraph(esc(order.fx_rate_note), small)]
    story += [Spacer(1, 10 * mm), Paragraph("Thank you for shopping with " + esc(settings.STORE_LEGAL_NAME) + ".", small)]
    doc.build(story)
    return buf.getvalue()

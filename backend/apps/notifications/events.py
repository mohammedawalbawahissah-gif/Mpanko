"""The single list of everything Mpanko can tell someone, and how.

Each event has a category (what a customer switches on or off), a title and screen for the app list and push, and a short text for
SMS and WhatsApp. Emails live in services.DEFAULTS under the same key. Customer events and staff events are separate lists."""

# What a customer can control. "email" for orders, support and account is always on: people must be told about money and security.
CUSTOMER_CATEGORIES = {
    "orders": "Orders and payments",
    "support": "Support and returns",
    "reminders": "Reminders and requests",
    "offers": "News and offers",
}
LOCKED_EMAIL = {"orders", "support", "account"}
STAFF_CATEGORY = "staff"
CHANNELS = ("email", "sms", "whatsapp", "push")
STAFF_CHANNELS = ("bell", "email", "push", "whatsapp")

# key -> category, (push title, context key for the reference, screen) and optional SMS/WhatsApp text
CUSTOMER_EVENTS = {
    "order_awaiting_payment": {"category": "orders", "push": ("We're waiting for your payment", "order_number", "orders"),
                               "sms": "Mpanko: order {order_number} is held for you. Send {currency} {amount} to finish it. Details are in your email."},
    "order_confirmation": {"category": "orders", "push": ("Order confirmed", "order_number", "orders"),
                           "sms": "Mpanko: order {order_number} is confirmed. Thank you!"},
    "order_processing": {"category": "orders", "push": ("We're preparing your order", "order_number", "orders"),
                         "sms": "Mpanko: we're preparing order {order_number}."},
    "order_ready_for_pickup": {"category": "orders", "push": ("Your order is ready for pickup", "order_number", "orders"),
                               "sms": "Mpanko: order {order_number} is ready for pickup at {pickup_place}."},
    "shipment_dispatched": {"category": "orders", "push": ("Your order has shipped", "order_number", "orders"),
                            "sms": "Mpanko: order {order_number} has shipped with {carrier}. Tracking: {tracking_number}"},
    "order_delivered": {"category": "orders", "push": ("Your order was delivered", "order_number", "orders"),
                        "sms": "Mpanko: order {order_number} was delivered. We hope you love it."},
    "payment_failed": {"category": "orders", "push": ("Payment didn't go through", "order_number", "orders"),
                       "sms": "Mpanko: payment for order {order_number} did not go through. You can try again in your orders."},
    "order_cancelled": {"category": "orders", "push": ("Your order was cancelled", "order_number", "orders"),
                        "sms": "Mpanko: order {order_number} was cancelled."},
    "order_expired": {"category": "orders", "push": ("Your order was released", "order_number", "orders"),
                      "sms": "Mpanko: we released order {order_number} because payment did not arrive in time."},
    "return_requested": {"category": "support", "push": ("We received your return request", "order_number", "orders")},
    "return_approved": {"category": "support", "push": ("Your return was approved", "order_number", "orders"),
                        "sms": "Mpanko: your return for order {order_number} is approved. Check your email for next steps."},
    "return_rejected": {"category": "support", "push": ("About your return request", "order_number", "orders")},
    "return_refunded": {"category": "support", "push": ("Your refund is on its way", None, None),
                        "sms": "Mpanko: your refund for return {return_number} is on its way."},
    "support_reply": {"category": "support", "push": ("New reply from Mpanko support", "case_number", "support")},
    "abandoned_bag": {"category": "reminders", "push": ("You left something in your bag", None, "bag")},
    "back_in_stock": {"category": "reminders", "push": ("Back in stock", "product", "shop")},
    "order_feedback": {"category": "reminders", "push": ("How was your order?", "order_number", "orders")},
    "announcement": {"category": "offers", "push": ("", None, "notifications")},
}

# Staff events: who gets them, how urgent they are, and the screen in the admin apps they open.
STAFF_EVENTS = {
    "staff_new_order": {"roles": ["super_admin", "store_admin", "fulfillment"], "urgent": True, "title": "New order", "screen": "orders"},
    "staff_manual_payment": {"roles": ["super_admin", "store_admin", "finance"], "urgent": True, "title": "Payment to confirm", "screen": "manual-payments"},
    "staff_payment_failed": {"roles": ["super_admin", "store_admin", "finance"], "urgent": False, "title": "Payment failed", "screen": "orders"},
    "staff_return_requested": {"roles": ["super_admin", "store_admin", "support"], "urgent": False, "title": "Return requested", "screen": "returns"},
    "staff_support_case": {"roles": ["super_admin", "store_admin", "support"], "urgent": False, "title": "New support message", "screen": "support"},
    "dispute_opened": {"roles": ["super_admin", "store_admin", "finance"], "urgent": True, "title": "Chargeback opened", "screen": "orders"},
    "corporate_enquiry": {"roles": ["super_admin", "store_admin"], "urgent": False, "title": "Website enquiry", "screen": "enquiries"},
    "low_stock_alert": {"roles": ["super_admin", "store_admin"], "urgent": False, "title": "Low stock", "screen": "stock"},
}


def category_of(key):
    """The customer category an event belongs to, or None for events that are not about the customer's choices (sign-in codes, invites)."""
    event = CUSTOMER_EVENTS.get(key)
    return event["category"] if event else None


def sms_text(key):
    return (CUSTOMER_EVENTS.get(key) or {}).get("sms")

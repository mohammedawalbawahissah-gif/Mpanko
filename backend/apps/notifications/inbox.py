from .models import InboxMessage

KEEP = 200  # newest messages kept per customer


def add_to_inbox(user, key, title, body, path):
    """Add one message to the customer's list and trim the oldest beyond KEEP."""
    msg = InboxMessage.objects.create(user=user, key=key, title=title, body=body, path=path)
    old = list(InboxMessage.objects.filter(user=user).values_list("pk", flat=True)[KEEP:])
    if old:
        InboxMessage.objects.filter(pk__in=old).delete()
    return msg

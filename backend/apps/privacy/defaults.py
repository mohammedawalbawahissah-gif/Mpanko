"""Starting drafts for the legal pages. They describe what the software actually does, but they are NOT legal advice:
the client's lawyer must review and replace them before launch. Until a page is published the storefront shows a draft notice."""
from django.conf import settings


def pages():
    days = settings.RETURN_WINDOW_DAYS
    return {
        "privacy": ("Privacy policy", f"""# Who we are
{settings.STORE_LEGAL_NAME} runs the Mpanko online store. This policy explains what personal data we collect and why.

# What we collect
Your name, email address, phone number and delivery addresses when you register or order. Your order history. Messages you send our support team. We do not store card numbers: payments happen on our payment provider's secure page.

# Why we use it
To take and deliver your orders, take payment, answer your questions, send order updates by email, and keep records we must keep for tax and accounting. We send marketing email only if you opt in, and you can switch it off at any time in your account.

# Who we share it with
The courier delivering your order, our payment providers (such as Paystack, Stripe or PayPal), and our email, SMS and WhatsApp providers when you ask to receive updates that way. We do not sell your data.

# How long we keep it
Order records are kept for {settings.RETENTION_ORDER_YEARS} years for tax and accounting, then personal details on them are removed. Accounts that are never verified are deleted after {settings.RETENTION_UNVERIFIED_DAYS} days.

# Your rights
You can download your data and delete your account from your account page. You can also write to us to correct or restrict how we use your data. If you are in Ghana you may complain to the Data Protection Commission; if you are in the EU or UK you may complain to your local data protection authority. Our data may be processed in Ghana and in other countries where our providers operate.

# Contact
Write to us through the Help page in your account, or at the support address shown on the website.
"""),
        "terms": ("Terms of sale", f"""# About these terms
By placing an order with {settings.STORE_LEGAL_NAME} you agree to these terms.

# Prices and payment
Prices are shown in the currency you choose. You are charged in a currency our payment provider supports; the final amount is shown before you pay. An order is confirmed once payment succeeds and you receive our confirmation email.

# Made-to-order and perishable items
Food, drinks and items made to order are prepared after you order and cannot be returned. If something arrives wrong or damaged, contact us within {days} days and we will make it right.

# Delivery
We ship from {settings.STORE_COUNTRY}. Delivery times are estimates, not guarantees. For international orders, import duties and taxes in the destination country are not included in the price and are the buyer's responsibility unless stated otherwise at checkout. Local pickup and local delivery are available only where shown at checkout.

# Returns and refunds
See our returns policy, which forms part of these terms.

# Your legal rights
Nothing in these terms limits rights you have under the consumer law where you live.

# Contact
Use the Help page in your account to reach us.
"""),
        "returns": ("Returns policy", f"""# Returning an item
You can ask to return items within {days} days of delivery from your order page. Tell us what is wrong and we will review your request and email you our decision.

# What we refund
If we approve your return, we refund the price of the returned items to your original payment method after the items reach us, within 7 days of receiving them. Delivery costs are refunded only where the item was faulty or wrongly sent.

# Who pays for return shipping
Return shipping is paid by the customer unless the item arrived damaged, faulty or was not what you ordered.

# Items we cannot take back
Food, drinks and other perishable items; items made to order or personalised; and items returned used or damaged by you. Returns for a change of mind must be unused and in their original packaging.
"""),
        "cookies": ("Cookie notice", """# What we use
Mpanko uses only the small pieces of data it needs to work: your sign-in, your bag and your currency choice. We do not use advertising or tracking cookies.

# Your choices
You can clear this data in your browser at any time. You will need to sign in again.
"""),
    }

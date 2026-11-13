# Admin guide for the shop team

Sign in at your admin address with the account the owner created for you. What you see in the left menu depends on your role. If a page is missing, ask a store admin to change your role on the Staff page.

## Roles

| Role | Typical person | Sees |
| --- | --- | --- |
| Super admin, Store admin | Owner, manager | Everything |
| Fulfilment | Packing and dispatch | Orders, Shipments, Shipping rules, Returns, Support, Stock, Reports |
| Finance | Bookkeeper | Orders, Returns, Support, Reports, Reconciliation, Chargebacks, Tax and duties |
| Support | Customer service | Orders, Returns, Support, Customers |
| Carrier | Courier partner | Shipments only |

## A normal day

1. **Dashboard.** Check orders to ship, delivery exceptions, low-stock variants, payment mismatches and unresolved reconciliation items. Which tiles you see depends on your role.
2. **Orders.** Open each paid order. Check the address and the items. Move it to *Packed* when ready.
3. **Shipments.** Create the shipment, choose the carrier and service, buy or enter the label, then print it. The customer is emailed tracking. For lithium batteries, perfume and other dangerous goods, the dangerous-goods paperwork is done in the carrier's own portal, not here.
4. **Returns.** Approve or decline return requests, record that the parcel arrived, then refund. Refunds go back through the payment provider.
5. **Support.** Reply to customer messages. Link them to the order where you can.

## Products and stock

- **Products:** add a product with a name, description, photos, a price per variant (size or colour) and an origin country. The customs fields (HS code, weight, country of origin) decide what duties apply, so fill them in for anything that ships abroad.
- **Stock:** set the count for each variant. Orders hold stock for a short time while the customer pays and release it if they do not.
- Hide a product by turning off *Active*. Do not delete products that have orders.

## Money

- **Promotions:** create codes with a percentage, a fixed amount or free delivery, a start and end date, and a usage limit. A code limited per customer needs a signed-in customer.
- **Tax and duties:** keep the rate table for each country up to date. These are your business rules, not tax advice. Ask your accountant.
- **Reconciliation:** compare Paystack's records with your orders. Fix anything marked as a mismatch.
- **Chargebacks:** when a card dispute arrives, record it, add your evidence before the due date, and note the result.
- **Reports:** sales, refunds and exports for your accountant. Exports open in Excel.

## Emails and pages

- **Emails:** edit the wording of the emails customers receive. Keep the `{{ ... }}` placeholders as they are.
- **Policy pages:** privacy, terms, returns and cookies. Update these when your rules change, and tell customers about important changes.

## Customers and privacy

- Look up a customer and their orders on **Customers**. Only open a record when you need it for a task. Staff changes are written to the **Activity log**.
- Customers can download their data and delete their own account from their Account page. Deleting keeps order totals for accounting but removes personal details. If someone asks you to do this for them and cannot sign in, ask a developer: there is no button for it in the admin.

## Guest orders

If the owner has turned on guest checkout, some orders have an email but no account. They appear in Orders as normal. If a guest loses their link, they can use *Find my order* on the website, or you can tell them to.

## When something looks wrong

| Problem | What to do |
| --- | --- |
| Customer paid but the order says waiting for payment | Wait two minutes, then check Reconciliation. Paystack sometimes confirms late. Do not ask them to pay again. |
| Carrier label will not buy | Check the address and parcel weight. Try again. If it keeps failing, buy the label in the carrier's portal and enter the tracking number. |
| Customer cannot sign in | They can use *Forgot password*. Do not ask for their password. |
| The shop is down | Tell the owner. See docs/BACKUPS.md for monitoring and restore. |

Keep your password private, use a different one for this site, and sign out on shared computers.

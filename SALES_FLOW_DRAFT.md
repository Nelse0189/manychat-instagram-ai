# Instagram digital-media sales flow — draft

Status: email verified and ManyChat workspace created (fb5630729). Instagram connection fails with “Request for account access denied. Please ensure you have set up the necessary permissions.” Instagram shows Manychat-IG active with business message, comment, and insight permissions enabled. User confirms mobile Connected tools / Allow access to messages is on. ManyChat requires a channel connection before opening Automation; nothing published. Pack selection, payment verification, delivery, and support terms still require implementation.

## Observed account and supplied inputs

- Signed-in Edge Instagram account: @arial_luxe.
- Media folder: C:\Users\nicho\Documents\Codex\2026-09-14\can-x20\outputs\tiktok\hernandez_sari_
- User confirms permission to sell these photos/videos and automate the process.
- Signup email: nicholaselsener@gmail.com. User approved accepting ManyChat terms.
- User-supplied payment handles: Venmo @bluejays0137; Cash App $Arialarias.
- These handles alone do not provide payment verification. A customer who only says they paid is asked for a screenshot. A screenshot for an open order releases the files.

## Setup inputs

- ManyChat signup email and verified Instagram account
- Confirmed media folder and authorization to sell the selected content
- Accurate seller/creator relationship, product description, and permitted buyer usage
- Product prices and currency
- Checkout provider, verified payment event, and protected delivery links
- Support contact and refund terms

## Response flow

### Initial price experiment

Use USD as the starting currency, consistent with the supplied US payment services. The user reports prior sales at $15 per photo. Initial offers: one photo $15; three photos $40; five photos $60. Video pricing remains separate and unset. These are starting hypotheses, not proven optimal prices. Only activate offers after the exact files are selected, checked, and ready for delivery. Describe them as curated collections of previously published content; do not promise unpublished or exclusive content. Exclude standalone music files from the products.

### Prepared customer responses

Customer replies are casual Spanish, in the short first-person voice of the account captions. Spanish is the default. If a customer writes in English, a freeform reply may be casual English in that same voice.

- Welcome: “hola. fotos o videos? dime y te paso precios.”
- Catalog: “fotos: una $15, tres $40, cinco $60. videos: uno $25, tres $60, cinco $90. se paga por Venmo @bluejays0137 o Cash App $Arialluxe. dime cuál quieres.”
- Payment, only after the selected pack is ready: “una foto $15. Venmo @bluejays0137 o Cash App $Arialluxe. pon [reference] en la nota y mándame la captura.”
- Paid claim, with no screenshot: “mándame la captura del pago y te mando los archivos.”
- Files after a screenshot on an open order: “ya vi la captura. aquí van:” plus the download links.
- Decline: “ok, cuando quieras dime catalog.”
- Human support: “ay cuéntame qué pasó. no me mandes claves ni números de tarjeta.”
- Opt-out: “ok ya, no te mando más. si luego quieres ver, dime catalog.”

Payment instructions must remain disabled until product files and delivery are ready. A price or offer accepted by a customer must remain attached to that order; later experiments must not change the quoted amount.

1. Trigger when someone requests the catalog through an inbound message or an enabled opt-in interaction.
2. Greeting: “hola. fotos o videos? dime y te paso precios.” Buttons: Photos / Videos / Support.
3. Show an approved preview and a factual description of the selected product: number of files, formats, usage rights, price, currency, and delivery method. Never describe publicly available media as exclusive unless that claim is accurate.
4. Offer: “una foto $15. Venmo @bluejays0137 o Cash App $Arialluxe. pon [reference] en la nota y mándame la captura.” Buttons: View pack / Other packs / Support.
5. Checkout happens on the payment provider's page. Do not collect card details in Instagram messages. A text claim that they paid does not release files. A payment screenshot for an open order does.
6. Deliver through the checkout provider after verified payment. For custom fulfillment, authenticate payment webhooks, match product and amount, and deduplicate events before issuing a protected download link.
7. Support: “ay cuéntame qué pasó. no me mandes claves ni números de tarjeta.” Route unresolved questions to a human.
8. Stop: “ok ya, no te mando más.” Suppress further promotion after STOP, unsubscribe, or equivalent intent.

## AI reply constraints

Use only the approved product catalog. Do not invent prices, ownership, exclusivity, discounts, availability, delivery status, or a biography. Reply in casual Spanish, short and first person, the way the account captions read. Do not sound like support, a receipt, or a policy. If the customer writes in English, a freeform reply may be casual English in that same voice. Escalate questions that the catalog does not answer. Respect opt-outs and the platform's current messaging eligibility rules.

## Long-term profit measurement

Measure net contribution per opted-in contact: collected revenue minus refunds, chargebacks, payment fees, platform/AI costs, acquisition costs, and fulfillment/support costs. Track repeat purchases and complaints as well as initial conversion.

Start with a small, clearly described catalog. Compare approved prices or bundles using separate cohorts and sufficient observation time; do not optimize solely for clicks or gross sales. Stop an experiment when refunds, complaints, or delivery failures materially increase. No profit outcome is guaranteed.

## Launch checks

- Complete one test purchase, verified fulfillment, duplicate payment-event handling, and refund/support path.
- Confirm opt-out suppression and human handoff.
- Confirm correct Instagram identity and enabled messaging permissions.
- Check current ManyChat/Meta messaging rules before enabling any follow-up sequence.

References:
- https://help.manychat.com/hc/en-us/articles/14281290924444-How-to-connect-Instagram-to-Manychat
- https://manychat.com/blog/instagram-dm-automation-rules/


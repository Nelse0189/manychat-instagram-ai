# Instagram digital-media sales flow — draft

Status: email verified and ManyChat workspace created (fb5630729). Instagram connection fails with “Request for account access denied. Please ensure you have set up the necessary permissions.” Instagram shows Manychat-IG active with business message, comment, and insight permissions enabled. User confirms mobile Connected tools / Allow access to messages is on. ManyChat requires a channel connection before opening Automation; nothing published. Pack selection, payment verification, delivery, and support terms still require implementation.

## Observed account and supplied inputs

- Signed-in Edge Instagram account: @arial_luxe.
- Media folder: C:\Users\nicho\Documents\Codex\2026-09-14\can-x20\outputs\tiktok\hernandez_sari_
- User confirms permission to sell these photos/videos and automate the process.
- Signup email: nicholaselsener@gmail.com. User approved accepting ManyChat terms.
- User-supplied payment handles: Venmo @bluejays0137; Cash App $Arialarias.
- These handles alone do not provide payment verification. Until a supported authenticated integration is configured, require the seller to verify payment in their provider account before releasing files. A payment screenshot is insufficient.

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

- Welcome: “Hi! I'm the automated shop assistant for @arial_luxe. Want to browse the photo and video collections?”
- Catalog: “Our curated collections contain previously published photos: one photo for $15 USD, three for $40 USD, or five for $60 USD. Want to see a sample and what's included?”
- Payment, only after the selected pack is ready: “For [pack] at [amount] USD, use Venmo @bluejays0137 or Cash App $Arialarias. Include order reference [reference] in the note. A team member will verify receipt before sending your download. Delivery is not instant.”
- Paid claim: “Thanks! I've flagged your order for payment verification. We'll send the download after the payment has been matched to your order.”
- Decline: “No problem. You can message CATALOG whenever you'd like to browse.”
- Human support: “I'll flag this for a team member. Please describe the issue here; don't send passwords or payment-card information.”
- Opt-out: “You're opted out of promotional messages.”

Payment instructions must remain disabled until product files and delivery are ready. A price or offer accepted by a customer must remain attached to that order; later experiments must not change the quoted amount.

1. Trigger when someone requests the catalog through an inbound message or an enabled opt-in interaction.
2. Greeting: “Hi! This is the automated shop assistant. Would you like to see the available photo or video packs?” Buttons: Photos / Videos / Support.
3. Show an approved preview and a factual description of the selected product: number of files, formats, usage rights, price, currency, and delivery method. Never describe publicly available media as exclusive unless that claim is accurate.
4. Offer: “The [pack name] includes [contents] for [price and currency]. You can review the details and purchase here: [checkout link].” Buttons: View pack / Other packs / Support.
5. Checkout happens on the payment provider's page. Do not collect card details in Instagram messages. Never treat a customer's claim or screenshot as verified payment.
6. Deliver through the checkout provider after verified payment. For custom fulfillment, authenticate payment webhooks, match product and amount, and deduplicate events before issuing a protected download link.
7. Support: “For purchase or download help, contact [support].” Route unresolved questions to a human.
8. Stop: “Understood—promotional messages are stopped.” Suppress further promotion after STOP, unsubscribe, or equivalent intent.

## AI reply constraints

Use only the approved product catalog. Do not invent prices, ownership, exclusivity, discounts, availability, delivery status, or personal relationships. Identify as the shop assistant. Escalate questions that the catalog does not answer. Never impersonate the person depicted in the media. Respect opt-outs and the platform's current messaging eligibility rules.

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


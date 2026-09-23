# Shop assistant

Calling the ManyChat API, OpenRouter, and Firebase does not require a public URL. Those are outbound requests from this machine. ManyChat can only hand an incoming Instagram DM to this server by POSTing to a URL it can reach, and a customer's phone can only open a download link the same way. `PUBLIC_BASE_URL` is for those two inbound cases. It can be a tunnel to this computer. Nothing in this repo is deployed to a cloud host.

Customers buy a photo or video pack from `media/hernandez_sari_`. Payment goes to Venmo @bluejays0137 or Cash App $Arialluxe, with the order reference in the note. Saying "I paid" does not release files. After you see the money in that account, `POST /admin/orders/:id/verify` picks the files and returns download links.

## When you have the keys

1. Copy `.env.example` to `.env`.
2. OpenRouter: create a key at https://openrouter.ai/keys and set `OPENROUTER_API_KEY`.
3. ManyChat: Settings → API → copy the token into `MANYCHAT_API_TOKEN`. Generate a long random `WEBHOOK_SECRET` and `ADMIN_SECRET`.
4. Firebase project `arial-luxe-shop` is already created. Firestore Enterprise database `shop` is in `nam5` (United States multi-region). `.env` should contain `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.
5. `npm install`
6. `npm run dev`
7. When you want live DMs, point a tunnel or host at this process and set `PUBLIC_BASE_URL` to that HTTPS origin. Skip this while you are only calling the APIs from here.
8. In ManyChat, add an Instagram default-reply or keyword automation whose Dynamic Block URL is `https://YOUR_HOST/manychat/dynamic`. Send header `x-webhook-secret: YOUR_WEBHOOK_SECRET`. Use the Full Contact Data body, or this JSON:

```json
{
  "id": "{{user_id}}",
  "first_name": "{{first_name}}",
  "ig_username": "{{ig_username}}",
  "last_input_text": "{{last_input_text}}"
}
```

Instagram still has to be connected in ManyChat before those automations can run. This repo does not connect the Instagram account.

## Check it locally before the keys

`GET /health` shows which integrations are configured. Without Firebase, data is kept in memory only.

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/manychat/dynamic \
  -H 'content-type: application/json' \
  -d '{"id":"123","last_input_text":"CATALOG"}'
```

Pending payments, once checkout is enabled:

```bash
curl -s http://localhost:8787/admin/orders?status=pending_verification \
  -H "authorization: Bearer $ADMIN_SECRET"
```

`POST /admin/orders/:id/verify` records that you verified the payment. It does not deliver files.

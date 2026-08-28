# commonpayment

Provider-agnostic payment integration for **Taiwan-native payment
aggregators**. Lets a single application accept money via either
**ECPay (綠界)** or **藍新 (NewebPay)** by flipping one config value,
without touching checkout, callback, or state-machine code.

Sibling package to [`commongenerator`](https://github.com/yabroexperiments/commongenerator)
in the yabroexperiments portfolio. Used by every revenue-collecting
app under `~/Documents/ClaudeCodex/Projects/` — currently
gogoLINEsticker (live), with gogo-gallery / FurryBooth,
LINEgashelper, SkinIQ, and future apps planned consumers.

## Why

Stripe doesn't accept Taiwan-based individual merchants. Domestic
options (ECPay, NewebPay, Newebpay, 玉山, etc.) each have their own
auth pattern, callback signature scheme, and quirks. This package
abstracts the two most common ones (ECPay + NewebPay) behind a single
`PaymentProvider` interface so the consuming app:

1. **Switches providers at runtime** with one settings/env flip
2. **Doesn't re-implement** signature verification, AES encryption,
   CheckMacValue building, callback ack formatting, etc. per app
3. **Stays portable** — the package never touches your DB, your
   framework, or your env beyond the per-adapter sandbox fallback

## Install

```bash
npm install github:yabroexperiments/commonpayment
```

Bumps via `npm install commonpayment` re-resolve `#main` to the
latest commit. Commit the updated `package-lock.json`.

## Quick start

```ts
import {
  createProvider,
  isProviderName,
  type ProviderName,
} from "commonpayment";

// 1. YOU decide which provider to use (your storage, your decision).
// commonpayment doesn't read Supabase / env to PICK — only to fill
// per-provider creds.
const settingsRow = await sb
  .from("settings")
  .select("value")
  .eq("key", "payment_provider")
  .single();
const name: ProviderName = isProviderName(settingsRow?.data?.value)
  ? (settingsRow.data!.value as ProviderName)
  : "ecpay";

// 2. Instantiate the matching adapter.
const provider = createProvider(name);

// 3. Build the redirect-POST form for the user's order.
const order = provider.buildOrder({
  merchantOrderId: provider.generateMerchantOrderId(),
  amountTwd: 899,
  itemName: "LINE 貼圖製作",
  tradeDesc: "Sticker pack — 8 stickers",
  notifyUrl: "https://example.com/api/payment/ecpay/callback",
  returnUrl: "https://example.com/order/123",
  preferredMethod: "CREDIT",
});

// In your page / route, render order.endpoint + order.fields as a
// hidden HTML form and auto-submit (the provider's hosted page
// takes it from there).

// 4. In your callback route, verify the provider's signed payload:
const rawBody = await req.text();
const result = provider.verifyCallback(rawBody, req.headers);

if (result.ok && result.orderResult.paymentStatus === "success") {
  // mark application paid using result.orderResult.merchantOrderId
}

const ack = provider.formatAck(result.ok ? "ok" : "reject");
return new Response(ack.body, {
  headers: { "Content-Type": ack.contentType },
});
```

## Cancelling a recurring subscription

Deleting a subscription from your OWN database does not stop the
gateway. ECPay's 定期定額 schedule keeps charging the card monthly
until it is stopped on ECPay's side, so a product that lets someone
"cancel" without this call is quietly still billing them.

`cancelRecurring` is OPTIONAL on `PaymentProvider` — an adapter with
no cancel API must say so rather than let a caller read silence as
success. Branch on its absence:

```ts
const stop = provider.cancelRecurring;
const res = stop
  ? await stop.call(provider, { merchantOrderId })   // the ORIGINAL
  : ({ ok: false, reason: "unsupported" } as const); // subscribing order

if (res.ok) {
  // record cancelled, with res.providerCode / res.raw for the audit trail
} else {
  // res.reason: "unsupported" | "rejected" | "network" | "malformed"
  // Do NOT mark it cancelled. Surface it so a human can stop the
  // schedule by hand in the 廠商後台.
}
```

Two things it will not do, on purpose:

- **It never assumes success.** A non-2xx reply, an unreadable reply,
  or a reply without `RtnCode=1` are all failures. A false "cancelled"
  keeps taking someone's money and nobody notices for a month; a false
  "failed" costs one retry.
- **It never guesses the environment.** The endpoint is derived from
  the configured checkout endpoint, so a provider built for stage
  cancels on stage. There is no second env var to get wrong.

⚠️ `merchantOrderId` is the order that CREATED the contract, not any
later renewal charge — ECPay identifies a schedule by its originating
`MerchantTradeNo`.

## Sandbox creds baked in (public testing creds — no signup needed)

Each adapter has shared sandbox creds baked in as fallback when env
is blank. Run against sandbox immediately without any account:

| Provider | MerchantID | Test card |
|---|---|---|
| ECPay | `2000132` | `4311-9522-2222-2222` exp `01/30` CVV `222` |
| NewebPay | `MS17361556` | `4000-2211-1111-1111` (any future exp + CVV) |

For production, set the `ECPAY_*` / `NEWEBPAY_*` env vars in your
host app. See `INTEGRATION_GUIDE.md` for the full env list per
adapter.

## Provider differences (the abstraction layer hides these)

| | ECPay | NewebPay |
|---|---|---|
| Signature | Single `CheckMacValue` (SHA256 over .NET-encoded sorted params) | AES-256-CBC `TradeInfo` + SHA256 `TradeSha` |
| Callback ack | Literal `1\|OK` (anything else → 3-day retry) | HTTP 200 with any body |
| `ReturnURL` semantic | Server-to-server callback | Browser-facing landing page (!!) |
| Server callback param | `ReturnURL` | `NotifyURL` |
| Order ID limit | 20 chars, alphanumeric | 30 chars, alphanumeric + `_` + `-` |
| Credit-card fee | 2.88% (~2.2% promo possible) | 2.8% |
| Individual seller cap | NT$300k / 30 days | NT$200k / 30 days |
| 電子發票 | Bundled in same merchant backend | Separate ezPay product |

**The package normalizes all of this** to a single `PaymentProvider`
interface — consumers don't need to know.

## What this package is NOT

- **Not a Next.js / framework adapter.** The package exposes pure
  TypeScript functions + classes. Your consuming app wires them into
  whatever framework it uses (Next.js route handlers, Express, Hono,
  raw Node, etc.).
- **Not a storage layer.** No DB schema, no row helpers, no Supabase
  client. Your app reads its own settings / env to pick a provider
  and persists order rows in its own table.
- **Not an e-invoice integrator.** Both ECPay and NewebPay have
  separate invoice products (sql/0042-ish in a typical schema) — the
  interface leaves room to add an `InvoiceProvider` sibling later but
  v1 only handles the payment side.
- **Not a refund automator.** Refunds happen via each provider's
  merchant backend (or their separate refund API). Out of scope.

## Status

| Adapter | Status |
|---|---|
| ECPay (`ecpay`) | Production-tested in gogoLINEsticker (sandbox only as of 2026-05-30; merchant account in review) |
| NewebPay (`newebpay`) | Code complete + sandbox-tested; awaiting merchant approval |

## License

MIT. See `LICENSE`.

# commonpayment — Stripe module plan

Status: **End 1 (this package) — building.** Ends 2/3 (consumers) follow, independently.

## Why
`furrybooth` and `chattysticker` each ship their **own near-identical Stripe code**
(`getStripe()`, a Checkout-Session `POST /api/checkout`, and a signature-verifying
`POST /api/stripe-webhook`). This package already centralises Taiwan rails
(ECPay + NewebPay); the Stripe plumbing belongs here too so the two apps stop
drifting.

## Design (the load-bearing decisions)

1. **Standalone async provider, NOT the sync `PaymentProvider` interface.**
   ECPay/NewebPay are synchronous, no-I/O, HTML-form-POST rails. Stripe Checkout
   is **async + network I/O + redirect URL**. Forcing Stripe into the v1 sync
   interface would require breaking that interface (and the live TW rails). So
   Stripe gets its **own class + async methods** (`StripeProvider`,
   `createStripeProvider`). The existing `PaymentProvider` contract and the
   ECPay/NewebPay modules are **untouched**.

2. **Amount-policy-agnostic.** The module verifies the webhook **signature** and
   creates a Checkout Session with a **server-fixed** `unit_amount` — it does
   **not** compare amounts or decide promo policy. Each app keeps its own amount
   verification + promo stance app-side. This is deliberate and required:
   - `furrybooth`: promos **on**, trusts Stripe's `amount_total` (safe because
     price is server-fixed and only a dashboard promo can lower it).
   - `chattysticker` (today): promos **off**, strict `amount_total === amount_cents`.
   - `chattysticker` (planned): adopt furrybooth's discount workflow — promos on,
     drop the strict-equality webhook check. That change is **app-side**, enabled
     by keeping the shared module amount-agnostic.

3. **Additive to the package (backward-compatible).**
   - `types.ts`: add `"stripe"` to `ProviderName` (persisted value; stable).
   - `index.ts`: re-export the Stripe surface; add `"stripe"` to `VALID_PROVIDERS`
     (so `isProviderName("stripe")` is true); `createProvider("stripe")` **throws**
     a helpful error pointing to `createStripeProvider()` (its async API can't
     satisfy the sync `PaymentProvider` return type). No existing behaviour changes.

4. **Dependency:** `stripe` (the official SDK) — the package's first runtime dep.
   Declared as an **optional peer dependency** (+ devDependency for this package's
   own build) so Taiwan-only consumers like `gogolinesticker` — which never import
   the Stripe module — aren't forced to install it. Version pinned `^22.2.1` to
   match both app consumers.

## Public API (new)

```ts
class StripeProvider {
  readonly name: "stripe";
  getClient(): Stripe;                                   // raw SDK for app-specific ops
  createCheckoutSession(input): Promise<{ id, url }>;    // server-fixed amount
  verifyWebhook(rawBody, sigHeader): WebhookVerifyResult;// constructEvent + typed errors
}
createStripeProvider(cfg?): StripeProvider;              // reads STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
trustedCheckoutOrigin({ configuredUrl, isProduction, fallbackUrl }): string; // origin hardening (pure)
```

The module owns: client construction, session creation (server-fixed price),
signature verification, origin hardening. Each app still owns: fulfillment,
amount verification, idempotency (CAS), product/pack shape, DB, emails.

## Consumers (Ends 2 & 3 — independent, either order)
- **chattysticker**: swap local `stripe.ts` + checkout/webhook plumbing for this
  module; **also** adopt furrybooth's discount workflow (promos on; trust
  server-fixed amount). Stripe is dormant behind `PAYMENT_STUB`, so lowest risk.
- **furrybooth**: swap local plumbing for this module; keep Printful fulfillment,
  shipping, and its existing promo-on policy. Live app — test in Stripe test mode
  before deploy.

Each edit to checkout/webhook/this module is money code → per-change confirmation.

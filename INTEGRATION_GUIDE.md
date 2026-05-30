# Integration guide — `commonpayment`

How to add this package to a new (or existing) yabroexperiments
portfolio app that needs to take money from Taiwanese customers via
ECPay or NewebPay.

The first consumer is **gogoLINEsticker**; the integration there is
the reference implementation. New consumers should follow the same
shape so the pattern stays uniform.

---

## 1. Install

```bash
cd <your-app>
npm install github:yabroexperiments/commonpayment
git add package.json package-lock.json
git commit -m "feat: add commonpayment dependency"
```

The package's `prepare` script compiles the TypeScript sources to
`dist/` on install — consumers get JS + `.d.ts` files, no build
config of your own needed.

To bump:

```bash
npm install commonpayment    # re-resolves #main to latest commit
git add package-lock.json
git commit -m "Bump commonpayment to <sha> (<reason>)"
```

(Empty commits don't update the lock — Vercel `npm ci` is strict
about the resolved SHA. Always run `npm install` then commit the
lockfile.)

---

## 2. Environment variables

Per-provider creds. Each adapter has the public sandbox creds baked
in as fallback when env is blank, so **you can ship without setting
any env vars** and the integration works against sandbox immediately.

For production, add to your Vercel project (or `.env.local` for
local dev):

```bash
# ECPay 綠界 — used when settings.payment_provider = 'ecpay'
ECPAY_MERCHANT_ID=          # your real production MerchantID
ECPAY_HASH_KEY=             # production HashKey
ECPAY_HASH_IV=              # production HashIV
ECPAY_MODE=production       # 'stage' (sandbox, default) | 'production'

# 藍新 NewebPay — used when settings.payment_provider = 'newebpay'
NEWEBPAY_MERCHANT_ID=
NEWEBPAY_HASH_KEY=          # 32 ASCII bytes
NEWEBPAY_HASH_IV=           # 16 ASCII bytes
NEWEBPAY_MODE=production    # 'stage' (sandbox, default) | 'production'
```

**Sensitive-name trap (Vercel):** if you name a `NEXT_PUBLIC_*`
var with `KEY` / `SECRET` / `TOKEN` / `PASSWORD`, Vercel auto-flags
it Sensitive and the value is NOT injected at build time. None of
the `ECPAY_*` / `NEWEBPAY_*` vars are `NEXT_PUBLIC_*` — they're
server-only — so they ARE inlined at runtime; this trap doesn't
apply. But if you ever wrap one in a `NEXT_PUBLIC_*` indirection,
beware.

---

## 3. Decide how YOU pick the active provider

`commonpayment` is storage-agnostic. **You** decide where the active-
provider config lives. Common patterns:

### Pattern A — Supabase settings row (gogoLINEsticker's choice)

```ts
// in your app — NOT in the package
import { createClient } from "@supabase/supabase-js";
import { createProvider, isProviderName, type ProviderName } from "commonpayment";

export async function pickProvider(sb: SupabaseClient): Promise<ProviderName> {
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", "payment_provider")
    .maybeSingle();
  if (isProviderName(data?.value)) return data!.value as ProviderName;
  return "ecpay"; // your default
}
```

### Pattern B — Env var only

```ts
import { isProviderName, type ProviderName } from "commonpayment";

export function pickProvider(): ProviderName {
  const env = process.env.PAYMENT_PROVIDER;
  return isProviderName(env) ? (env as ProviderName) : "ecpay";
}
```

### Pattern C — Hardcoded (single-provider apps)

```ts
const provider = createProvider("ecpay");
```

---

## 4. Build the order (apply form / checkout button)

```ts
import { createProvider } from "commonpayment";
import { pickProvider } from "@/lib/pick-provider"; // YOUR code from step 3

// ...inside your API route / server action:
const name = await pickProvider(sb);
const provider = createProvider(name);

const order = provider.buildOrder({
  merchantOrderId: provider.generateMerchantOrderId(),
  amountTwd: 899,
  itemName: "LINE 貼圖製作",
  tradeDesc: "Sticker pack — 8 stickers",
  notifyUrl: `${SITE_URL}/api/payment/${name}/callback`,
  returnUrl: `${SITE_URL}/order/${myOrderId}`,
  preferredMethod: "CREDIT", // optional; "ALL" if undefined
});

// Persist the merchant order ID + which provider was used to YOUR
// order row, so the callback route can look it up later:
await sb.from("applications").update({
  payment_provider: name,
  payment_merchant_order_id: order.fields.MerchantTradeNo || order.fields.MerchantOrderNo,
}).eq("id", myOrderId);

// Return order.endpoint + order.fields to a page that renders them
// as a hidden HTML form + auto-submits.
return { endpoint: order.endpoint, fields: order.fields };
```

The hidden-form auto-submit pattern (consumer's responsibility):

```tsx
// ClientComponent
"use client";
import { useEffect, useRef } from "react";

export function AutoSubmitForm({ endpoint, fields }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.submit(); }, []);
  return (
    <form ref={formRef} action={endpoint} method="POST">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </form>
  );
}
```

---

## 5. Wire the callback route

Use a URL-pinned route so in-flight callbacks don't get handed to
the wrong adapter when settings flip mid-flow:

```
/api/payment/[provider]/callback   ← provider ∈ {'ecpay', 'newebpay'}
```

```ts
// app/api/payment/[provider]/callback/route.ts (Next.js example)
import { createProvider, isProviderName } from "commonpayment";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: name } = await params;
  if (!isProviderName(name)) {
    return new Response("Invalid provider", { status: 400 });
  }

  // Pin to URL provider — DO NOT call pickProvider() here. If
  // settings just flipped, the in-flight callback still needs the
  // adapter the order was created with.
  const provider = createProvider(name);

  const rawBody = await req.text();
  const result = provider.verifyCallback(rawBody, req.headers);

  if (!result.ok) {
    const ack = provider.formatAck("reject", result.reason);
    return new Response(ack.body, {
      status: 400,
      headers: { "Content-Type": ack.contentType },
    });
  }

  const { merchantOrderId, providerTradeNo, paymentStatus } =
    result.orderResult;

  if (paymentStatus === "success") {
    // 1. Look up your order row by merchantOrderId
    // 2. Idempotent UPDATE — CAS on current status to avoid races
    //    UPDATE applications SET status='paid', paid_at=now(),
    //      payment_provider_trade_no=providerTradeNo
    //    WHERE merchant_order_id=$1 AND status='pending_payment'
    // 3. Fire customer + admin payment-received emails (your code)
  }
  // If paymentStatus === 'failed', leave status untouched; the
  // user will see "payment incomplete" when they return to your
  // status page (your UI). Still ack OK so provider stops retrying.

  const ack = provider.formatAck("ok");
  return new Response(ack.body, {
    headers: { "Content-Type": ack.contentType },
  });
}
```

### Backward-compat shim (only if you're migrating from a
single-provider integration)

If your old code had `POST /api/ecpay/callback` and ECPay's merchant
portal has that URL registered, keep the old route as a 1-line
forward-proxy until ECPay's portal URL is updated:

```ts
// app/api/ecpay/callback/route.ts (transitional)
export async function POST(req: Request) {
  const rawBody = await req.text();
  const url = new URL("/api/payment/ecpay/callback", req.url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") ?? "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "text/plain" },
  });
}
```

Remove the shim once ECPay's portal points at the new URL AND the
provider's 3-day retry window has elapsed.

---

## 6. Database schema (your tables, not ours)

`commonpayment` is storage-agnostic, but your application row needs
a few columns to track the order across provider switches. Suggested
shape (PostgreSQL / Supabase):

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS payment_merchant_order_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider_trade_no TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_payment_merchant_order_id
  ON applications (payment_merchant_order_id)
  WHERE payment_merchant_order_id IS NOT NULL;
```

- `payment_provider` — `'ecpay'` or `'newebpay'`, set at order-create
  time so the callback knows which adapter to use
- `payment_merchant_order_id` — what you generated and sent to the
  provider (their `MerchantTradeNo` or `MerchantOrderNo`)
- `payment_provider_trade_no` — what the provider returned in the
  successful callback (their internal trade number, for refund /
  audit lookups)

If you have legacy `ecpay_merchant_trade_no` / `ecpay_trade_no`
columns, leave them and backfill the new ones from them:

```sql
UPDATE applications
SET payment_provider = 'ecpay',
    payment_merchant_order_id = ecpay_merchant_trade_no,
    payment_provider_trade_no = ecpay_trade_no
WHERE payment_merchant_order_id IS NULL
  AND ecpay_merchant_trade_no IS NOT NULL;
```

---

## 7. Admin UI for switching providers

Recommended: a `<select>` in your admin panel bound to the
`payment_provider` settings row (or whatever storage you chose).
Switch applies to the NEXT order created — in-flight orders stay
pinned to their original adapter via the URL-pinned callback route.

For destructive switches (like the alpha-bypass kill-switch in
gogoLINEsticker), use a 2-checkbox confirmation gate — see
gogoLINEsticker `src/app/admin/test/page.tsx` for the reference
pattern.

---

## 8. Testing checklist

Before flipping a consumer's `payment_provider`:

1. Both adapters' env vars set in Vercel (or left blank to use
   sandbox — confirm you know which mode you're in)
2. SQL migration applied (columns + index)
3. The new `/api/payment/[provider]/callback` route is reachable
   externally (curl from outside should return non-500)
4. Test ECPay sandbox round-trip: real apply → POST to
   `payment-stage.ecpay.com.tw` → callback flips status → emails
   fire (use test card `4311-9522-2222-2222`)
5. Test NewebPay sandbox round-trip: flip `payment_provider` to
   `newebpay` → real apply → POST to `ccore.newebpay.com` →
   callback decrypts TradeInfo, verifies TradeSha → status flips
   (use test card `4000-2211-1111-1111`)
6. Verify provider stickiness: refresh an in-flight ECPay order's
   checkout URL while `payment_provider=newebpay` is active —
   should still POST to ECPay (the row's `payment_provider='ecpay'`
   wins over the global setting)

---

## 9. Known limitations

- **LINE Pay** not exposed in v1. NewebPay supports the `LINEPAY=1`
  flag but enabling it requires a separate LINE Pay merchant
  approval per the LINE Pay docs.
- **TWQR on NewebPay** falls back to `ALL` — NewebPay doesn't have a
  direct TWQR-only channel like ECPay does.
- **電子發票 (e-invoice)** not yet integrated — both providers have
  separate invoice products. The interface leaves room for an
  `InvoiceProvider` sibling.
- **Refunds** happen via each provider's merchant backend (or their
  separate refund API). No automation here.

---

## 10. Cross-app rules

Same posture as `commongenerator`:

- **Project separation:** each consuming app uses its own real
  `MerchantID` / `HashKey` / `HashIV` per provider. Don't share creds
  across apps. The sandbox creds baked into `commonpayment` ARE
  shared (they're public NewebPay/ECPay testing creds anyway).
- **No credentials in this repo.** Real production creds always live
  in the consumer's Vercel env, never in `commonpayment`'s code.
- **ASCII paths:** if Next.js Turbopack is in the chain, the
  consuming app's path must be ASCII (CJK in the parent folder
  breaks production builds — verified failure mode in the portfolio).

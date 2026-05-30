/**
 * Payment provider abstraction — shared contract for ECPay and 藍新 (NewebPay).
 *
 * This file is the first in-app step toward the `commonpayment` package
 * described in `/Users/albert/Documents/ClaudeCodex/docs/PAYMENT_PROCESSOR.md`
 * §2 ("The provider interface"). It mirrors the design doc's intent — one
 * uniform interface that hides CheckMacValue / TradeSha / AES decryption
 * from the consuming app — but is intentionally trimmed for what
 * gogoLINEsticker needs *today*:
 *
 *   - TWD-only (`amountTwd` instead of `amountMinor` + `currency`)
 *   - Smaller method enum (the ones we actually offer)
 *   - Synchronous `buildOrder` / `verifyCallback` (no I/O in v1; both
 *     adapters do pure crypto + string-munging)
 *   - No `queryOrder` (deferred per §2 "Defer for v1")
 *   - No `expectedAmountMinor` cross-check in `verifyCallback` (the
 *     callback route does the amount-mismatch check by comparing the
 *     verified result against the persisted application row)
 *
 * When the in-app abstraction graduates to the `commonpayment` package,
 * these types will be replaced by the wider design-doc shape (BigInt
 * amounts via `amountMinor`, `Verdict` discriminated union with the full
 * reason enum, async `buildOrder`, etc.). Treat this file as the bridge
 * layer — same idea, narrower surface.
 *
 * Provider-specific notes that drove the design:
 *
 *   - ECPay merchant order ID: 20-char `[A-Za-z0-9]{20}`, must be unique
 *     forever (re-using a MerchantTradeNo returns an error even if the
 *     old order failed). gogoLINEsticker uses `GS` + 18 random hex chars
 *     (see `generateMerchantTradeNo` in `src/lib/ecpay.ts`).
 *   - NewebPay merchant order ID: up to 30 chars, alphanumeric + `_` + `-`.
 *     Same uniqueness requirement. Future adapter will likely use
 *     `GS_` + base36 timestamp + random.
 *   - ECPay ack: provider expects the literal text `"1|OK"` (or
 *     `"0|<reason>"` to signal failure → triggers retries). Anything
 *     else and ECPay's retry queue keeps hammering us for ~24h.
 *   - NewebPay ack: accepts HTTP 200 with any body, but `"1|OK"` is
 *     compatible with both, so adapters MAY converge on that string.
 *
 * Reference: design doc §2, §3 (ECPay adapter), §4 (NewebPay adapter),
 * §7 (callback route changes).
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/**
 * Stable identifier for each supported payment gateway.
 *
 * Used in:
 *   - the `PaymentProvider.name` field (runtime self-identification)
 *   - the `settings.payment_provider` DB row (runtime provider switch)
 *   - the `PAYMENT_PROVIDER` env var (default when settings row is null)
 *   - audit logs / admin tools
 *
 * Add new providers here when adapters land. Keep the string values
 * stable — they are persisted in the DB.
 */
export type ProviderName = "ecpay" | "newebpay";

// ---------------------------------------------------------------------------
// Order construction
// ---------------------------------------------------------------------------

/**
 * Abstract payment method enum.
 *
 * Each adapter maps these to its own provider-specific enum/flags:
 *   - ECPay: ChoosePayment field (`Credit`, `ApplePay`, `ATM`, `CVS`,
 *     `TWQR`, `ALL`)
 *   - NewebPay: per-method flags on the MPG order (e.g. `CREDIT=1`,
 *     `APPLEPAY=1`, `VACC=1`, `CVS=1`, etc.)
 *
 * `ALL` means "show the gateway's full method picker" — the default and
 * recommended choice for v1 since both providers' hosted pages handle
 * method selection better than we can.
 *
 * Methods omitted on purpose (vs. design doc §2's wider enum): we don't
 * ship `GOOGLEPAY`, `WEBATM`, `BARCODE`, or `LINEPAY` today. Add them
 * here when product asks.
 */
export type PaymentMethod =
  | "CREDIT"
  | "APPLEPAY"
  | "ATM"
  | "CVS"
  | "TWQR"
  | "ALL";

/**
 * Everything the consuming app passes to `provider.buildOrder()`.
 *
 * Caller is responsible for:
 *   - generating `merchantOrderId` via `provider.generateMerchantOrderId()`
 *     and persisting it to the DB BEFORE this call (so a callback that
 *     races the response can still find the row)
 *   - resolving `amountTwd` from its business logic (e.g. the
 *     `payment_amount_twd ?? 899` fallback in the applications route);
 *     the adapter never invents an amount
 *   - building absolute URLs for `notifyUrl` / `returnUrl` (including
 *     basePath when the app is mounted under one — gogoLINEsticker is
 *     mounted at `/LINEsticker`, so `notifyUrl` must be
 *     `https://hahadoggo.com/LINEsticker/api/payment/<provider>/callback`)
 */
export interface BuildOrderInput {
  /**
   * Merchant order ID — provider-unique, generated via
   * `provider.generateMerchantOrderId()`. Persisted to the DB before
   * this call so the eventual webhook can correlate.
   *
   * Constraints by provider:
   *   - ECPay: exactly 20 chars, `[A-Za-z0-9]+`
   *   - NewebPay: up to 30 chars, `[A-Za-z0-9_-]+`
   */
  merchantOrderId: string;

  /**
   * Order total in whole NTD (TWD has no decimal subunit in practice).
   * Must be a positive integer. Adapters reject zero/negative — see
   * design doc §2 "Zero-amount orders" for why those never reach
   * `buildOrder`.
   */
  amountTwd: number;

  /**
   * Human-readable line-item name shown on the gateway's hosted page
   * and on the credit-card statement descriptor where supported.
   * Max 200 chars (ECPay's cap; adapter truncates if necessary).
   * CJK characters are fine — adapter handles URL encoding.
   */
  itemName: string;

  /**
   * Longer free-text description, also shown on the hosted page.
   * Less length-constrained than `itemName` but keep it under ~200
   * chars to be safe across both providers.
   */
  tradeDesc: string;

  /**
   * Absolute URL the provider POSTs to server-to-server when payment
   * settles (a.k.a. webhook / notify URL). MUST include basePath if
   * the app is mounted under one. The route at this URL is where
   * `provider.verifyCallback()` is called.
   *
   * Example (gogoLINEsticker prod):
   *   `https://hahadoggo.com/LINEsticker/api/payment/ecpay/callback`
   */
  notifyUrl: string;

  /**
   * Absolute URL the user's browser is redirected to after payment
   * (success or cancel). The browser landing — distinct from
   * `notifyUrl`. Display the post-payment status here based on the
   * DB row (which the server-to-server callback will have updated by
   * the time the user lands).
   */
  returnUrl: string;

  /**
   * Optional pre-selection of payment method. Defaults to `"ALL"`
   * (show the gateway's method picker). Each adapter maps this to
   * its native enum/flags.
   */
  preferredMethod?: PaymentMethod;
}

/**
 * Result of `provider.buildOrder()`.
 *
 * For both ECPay and NewebPay this resolves to a hosted-page redirect
 * via HTML form auto-POST. The consuming app renders a `<form
 * action={endpoint} method="POST">` with one hidden `<input>` per
 * entry in `fields`, then auto-submits on mount.
 *
 * (Design doc §2 uses a `Handoff` discriminated union with a
 * `redirect` variant for future providers like Stripe Checkout. v1
 * only needs `auto-post`, so we collapse to the fields directly.)
 */
export interface BuildOrderResult {
  /** The provider's hosted-page URL — the `<form action>` target. */
  endpoint: string;
  /**
   * Hidden form fields to POST. Adapter has already computed
   * provider-specific signatures (ECPay CheckMacValue, NewebPay
   * TradeSha + AES-encrypted TradeInfo) and they live in this map.
   * Do not mutate before submitting.
   */
  fields: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Callback verification
// ---------------------------------------------------------------------------

/**
 * Successful, signature-verified callback result.
 *
 * The adapter has confirmed:
 *   - the signature (CheckMacValue / TradeSha) matches the body
 *   - all required provider-specific fields are present
 *   - the payload decrypted cleanly (NewebPay) / parsed cleanly (ECPay)
 *
 * The adapter does NOT confirm:
 *   - that `merchantOrderId` exists in our DB
 *   - that `amountTwd` matches what we expected for that order
 *   - idempotency (whether we've already processed this callback)
 *
 * Those checks belong in the callback route, which has DB access.
 */
export interface VerifiedOrderResult {
  /** The merchant order ID we originally generated and sent. */
  merchantOrderId: string;
  /**
   * The provider's own transaction ID — ECPay TradeNo / NewebPay
   * TradeNo. Persist to `applications.payment_provider_trade_no` for
   * customer support / refund reference.
   */
  providerTradeNo: string;
  /** Confirmed paid amount in whole NTD. Cross-check against the DB row. */
  amountTwd: number;
  /**
   * Whether the provider confirmed the money landed.
   *   - `success`: advance the order to paid state
   *   - `failed`: log + ack so the provider stops retrying; do NOT
   *     advance state (the user may retry from the checkout page)
   */
  paymentStatus: "success" | "failed";
  /**
   * Raw payment-method string from the provider — for logging only.
   * Not normalized to `PaymentMethod` because providers report things
   * we don't have in the enum (e.g. ECPay returns `Credit_CreditCard`,
   * NewebPay returns `VACC` with a bank-code subfield).
   */
  paymentMethod: string;
  /**
   * The full decoded payload — all fields the provider sent, after
   * signature verification and (for NewebPay) AES decryption. Persist
   * to `applications.payment_meta` JSONB for audit / debugging.
   */
  rawFields: Record<string, string | number | boolean>;
}

/**
 * Discriminated union returned by `provider.verifyCallback()`.
 *
 * The callback route should switch on `ok` and:
 *   - `ok: true`  → run DB amount/state checks, fire emails, ack `"1|OK"`
 *   - `ok: false` → log `reason` + `detail`, ack `"0|<reason>"` (or HTTP
 *     400 for clearly-malformed requests that aren't worth retrying)
 *
 * The reason enum is intentionally narrow — these are the only outcomes
 * the adapter can determine without DB access. Higher-level reasons
 * (`amount_mismatch`, `unknown_order`, `duplicate`) are determined by
 * the callback route and don't appear here.
 */
export type CallbackResult =
  | { ok: true; orderResult: VerifiedOrderResult }
  | {
      ok: false;
      /**
       * `invalid-signature`: CheckMacValue / TradeSha didn't match.
       *   Likely tampering or a key-rotation skew. Reject hard.
       * `unknown-format`: body didn't look like the expected shape
       *   (e.g. NewebPay JSON envelope missing, ECPay form-encoded
       *   body missing the expected keys).
       * `missing-fields`: shape was right but a required field was
       *   absent (e.g. no `MerchantTradeNo`).
       * `decrypt-failed`: NewebPay-only — AES decryption of
       *   `TradeInfo` threw, usually a HashKey/HashIV mismatch.
       */
      reason:
        | "invalid-signature"
        | "unknown-format"
        | "missing-fields"
        | "decrypt-failed";
      detail?: string;
    };

// ---------------------------------------------------------------------------
// Ack
// ---------------------------------------------------------------------------

/**
 * Body the consuming route should write back to the provider after
 * processing the callback. Always send what the adapter returns
 * verbatim — both providers have strict expectations.
 *
 * ECPay specifically expects the literal text `"1|OK"` (success) or
 * `"0|<reason>"` (failure-triggering-retry); anything else and the
 * retry queue keeps firing for ~24h.
 */
export interface Ack {
  /** Response body to write. */
  body: string;
  /** Content-Type header value — usually `text/plain; charset=utf-8`. */
  contentType: string;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * The interface every payment adapter implements.
 *
 * Adapters are constructed via a factory (`createEcpayProvider(config)`
 * / `createNewebpayProvider(config)`) and live for the lifetime of the
 * Next.js process. They are stateless — all per-request state lives in
 * the arguments. Safe to share one instance across many requests.
 *
 * See design doc §3 / §4 for the per-adapter implementation shape.
 */
export interface PaymentProvider {
  /** Which gateway this adapter speaks to. */
  readonly name: ProviderName;

  /**
   * Generate a fresh merchant order ID respecting the provider's
   * length/charset limits (ECPay: 20-char alphanumeric; NewebPay:
   * 30-char alphanumeric + `_` + `-`). Must be unique across all
   * historical orders for this merchant — providers reject re-use
   * even if the prior order failed.
   *
   * Caller persists this to the DB BEFORE calling `buildOrder` so
   * the eventual webhook can correlate even if the response races.
   */
  generateMerchantOrderId(): string;

  /**
   * Build the hosted-page handoff: returns the form endpoint plus
   * the hidden fields to POST. The consuming app renders a `<form>`
   * with these fields and auto-submits.
   *
   * Adapter handles all provider-specific signing (ECPay
   * CheckMacValue, NewebPay TradeSha + AES TradeInfo) — the caller
   * never sees those primitives.
   */
  buildOrder(input: BuildOrderInput): BuildOrderResult;

  /**
   * Parse the raw HTTP body of an incoming callback, verify the
   * provider-specific signature, and return either a verified order
   * result or a typed error.
   *
   * Pass:
   *   - `rawBody`: the request body as a string (do NOT pre-parse —
   *     ECPay form-encoding and NewebPay's JSON envelope have
   *     adapter-specific quirks)
   *   - `headers`: the request headers (some providers use header
   *     metadata; ECPay does not but the signature future-proofs us)
   *
   * Does NOT touch the DB — the consuming route is responsible for
   * the cross-checks that need DB context (amount, idempotency,
   * existence of the order).
   */
  verifyCallback(rawBody: string, headers: Headers): CallbackResult;

  /**
   * Format the ack body the provider expects after processing the
   * callback.
   *
   *   - `verdict: 'ok'`: success ack. ECPay → `"1|OK"`. NewebPay
   *     accepts the same string, so both adapters return it for v1.
   *   - `verdict: 'reject'`: failure ack with optional `detail`
   *     (becomes `"0|<detail>"` for ECPay). Use sparingly — only
   *     when we want the provider to retry. For clearly-malformed
   *     requests that no retry will fix, prefer HTTP 400 with no body.
   */
  formatAck(verdict: "ok" | "reject", detail?: string): Ack;
}

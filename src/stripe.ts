/**
 * Stripe adapter for `commonpayment`.
 *
 * Unlike the ECPay / NewebPay rails (synchronous, no-I/O, HTML-form auto-POST),
 * Stripe Checkout is **async + network I/O + redirect URL**. Forcing it into the
 * v1 synchronous `PaymentProvider` interface would mean breaking that interface
 * (and the live Taiwan rails), so Stripe is a **standalone provider with its own
 * async API**. The ECPay/NewebPay modules and the `PaymentProvider` contract are
 * untouched. See `docs/stripe-integration-plan.md`.
 *
 * SCOPE — this module is deliberately **amount-policy-agnostic**. It:
 *   - constructs the Stripe client,
 *   - creates a Checkout Session with a **server-fixed** `unit_amount`
 *     (the price is set by the caller from ITS server, never from the browser),
 *   - verifies the webhook signature and hands back the typed event.
 * It does NOT compare amounts, decide promo policy, touch a database, or fulfil
 * anything. Amount verification, idempotency, promo stance, and fulfilment stay
 * in the consuming app — because different apps make different (valid) choices
 * (e.g. promos-on + trust-`amount_total` vs. promos-off + strict equality).
 *
 * MONEY CODE: changes here need explicit per-change sign-off.
 */

import type Stripe from "stripe";
import type { ProviderName } from "./types";

// The 'stripe' SDK is an OPTIONAL peer dependency, loaded lazily at
// StripeProvider construction — never at module load. This file is
// re-exported by index.ts, so a top-level `import Stripe from "stripe"`
// would make EVERY consumer crash at boot with "Cannot find module
// 'stripe'" unless they install an SDK they don't use (this took famchat's
// Render deploy down on 2026-08-01: the app only uses the ECPay adapter,
// but importing anything from commonpayment pulled in stripe.js).
// The `import type` above is erased at compile time and costs nothing.
// stripe's typings are `export =` style, so the module type IS the ctor.
type StripeCtor = typeof import("stripe");
let cachedStripeCtor: StripeCtor | null = null;

function loadStripeSdk(): StripeCtor {
  if (cachedStripeCtor) return cachedStripeCtor;
  let mod: unknown;
  try {
    // Plain require — this package compiles to CJS (no "type":"module").
    mod = require("stripe");
  } catch {
    throw new Error(
      "commonpayment(stripe): the optional peer dependency 'stripe' is not " +
        "installed. Run `npm install stripe` in the consuming app to use " +
        "StripeProvider. (ECPay/NewebPay adapters do not need it.)",
    );
  }
  const ctor =
    (mod as { default?: StripeCtor }).default ?? (mod as StripeCtor);
  cachedStripeCtor = ctor;
  return ctor;
}

/**
 * Informational mode label. Stripe's live/test split is encoded in the secret
 * key itself (`sk_live_…` vs `sk_test_…`); this is only for config/labels — the
 * SDK behaves per the key regardless of this value.
 */
export type StripeMode = "test" | "live";

/**
 * Resolved Stripe config. The factory (`createStripeProvider`) reads these from
 * env with a passed-in override; the class takes the resolved object.
 * There is intentionally **no shared sandbox fallback** the way ECPay/NewebPay
 * have — Stripe test keys are per-account, so each consumer supplies its own.
 */
export interface StripeConfig {
  /** `sk_live_…` or `sk_test_…`. Required. */
  secretKey: string;
  /** `whsec_…`. Required only to call `verifyWebhook`. */
  webhookSecret?: string;
}

/**
 * Everything needed to create a hosted Checkout Session. The caller computes
 * `amountMinor` from ITS OWN server-side pricing — this module never derives or
 * trusts a client-supplied amount.
 */
export interface CreateCheckoutSessionInput {
  /**
   * Price in the currency's MINOR unit (e.g. USD cents). MUST be a positive
   * integer set server-side. This is the single most important anti-fraud
   * property: the browser never supplies the amount.
   */
  amountMinor: number;
  /** ISO-4217 currency, lowercase (e.g. `"usd"`). */
  currency: string;
  /** Line-item product name shown on the hosted page + card statement. */
  productName: string;
  /** Line-item quantity. Default 1. */
  quantity?: number;
  /** Prefill the customer's email on the hosted page. */
  customerEmail?: string;
  /** Arbitrary key/values echoed back on the webhook event (all strings). */
  metadata?: Record<string, string>;
  /** Absolute URL Stripe returns the browser to after success. */
  successUrl: string;
  /** Absolute URL Stripe returns the browser to on cancel. */
  cancelUrl: string;
  /**
   * Enable Stripe-managed promotion codes on the hosted page. The APP decides
   * its promo policy — the module just forwards this flag. If you enable it,
   * your webhook MUST NOT assert strict `amount_total === expected` (a promo
   * legitimately lowers the total); trust the server-fixed amount instead.
   */
  allowPromotionCodes?: boolean;
  /** Optional product images (e.g. a watermarked preview URL). */
  images?: string[];
  /** Optional line-item description shown under the product name. */
  description?: string;
  /**
   * Optional Stripe idempotency key for the create call — pass a stable key
   * (e.g. your order id) so a retried request can't mint a second session.
   */
  idempotencyKey?: string;
  /**
   * Escape hatch for provider-specific session params this helper doesn't model
   * directly — e.g. physical-goods `shipping_address_collection`,
   * `shipping_options`, `phone_number_collection`. Merged UNDER the core fields,
   * so the money-critical keys (`mode`, `line_items` with the server-fixed
   * `unit_amount`, `success_url`, `cancel_url`, `metadata`) always win and can
   * never be overridden here.
   */
  extraParams?: Partial<Stripe.Checkout.SessionCreateParams>;
}

/** What the caller needs from a created session. */
export interface CheckoutSessionResult {
  /** `cs_…` Checkout Session id — persist as your payment reference. */
  id: string;
  /** Hosted Checkout redirect URL — send the browser here. */
  url: string;
}

/**
 * Result of `verifyWebhook`. On `ok`, the event is signature-verified and safe
 * to act on (after the app's own amount/idempotency checks). On failure, the
 * `reason` maps to how the route should respond:
 *   - `not-configured`  → 503 (webhook secret missing — endpoint is down)
 *   - `missing-signature` / `invalid-signature` → 400 (do not process)
 */
export type WebhookVerifyResult =
  | { ok: true; event: Stripe.Event }
  | {
      ok: false;
      reason: "not-configured" | "missing-signature" | "invalid-signature";
      detail?: string;
    };

/**
 * The Stripe provider. Stateless across requests once constructed — safe to
 * build once and reuse.
 */
export class StripeProvider {
  readonly name: ProviderName = "stripe";
  private readonly client: Stripe;
  private readonly webhookSecret?: string;

  constructor(cfg: StripeConfig) {
    if (!cfg.secretKey) {
      throw new Error("commonpayment(stripe): secretKey is required.");
    }
    // No apiVersion pin — use the SDK's compiled-in version (matches how both
    // app consumers construct their clients today). SDK loaded lazily here so
    // ECPay/NewebPay-only consumers never need the optional 'stripe' peer dep.
    const StripeSdk = loadStripeSdk();
    this.client = new StripeSdk(cfg.secretKey);
    this.webhookSecret = cfg.webhookSecret;
  }

  /**
   * The raw Stripe SDK client, for app-specific operations this module doesn't
   * wrap (refunds, session/payment retrieval, customer lookups, etc.).
   */
  getClient(): Stripe {
    return this.client;
  }

  /**
   * Create a one-time hosted Checkout Session with a server-fixed price and
   * return `{ id, url }`. Throws if Stripe returns a session without a URL.
   */
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error(
        "commonpayment(stripe): amountMinor must be a positive integer (minor units).",
      );
    }

    const productData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData.ProductData =
      { name: input.productName };
    if (input.description) productData.description = input.description;
    if (input.images && input.images.length) productData.images = input.images;

    const params: Stripe.Checkout.SessionCreateParams = {
      // App-supplied extras first (shipping/phone/etc.); the money-critical
      // fields below are set last so they always win over extraParams.
      ...(input.extraParams ?? {}),
      mode: "payment",
      line_items: [
        {
          quantity: input.quantity ?? 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amountMinor, // server-fixed — never from client
            product_data: productData,
          },
        },
      ],
      metadata: input.metadata ?? {},
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
    if (input.customerEmail) params.customer_email = input.customerEmail;
    if (input.allowPromotionCodes) params.allow_promotion_codes = true;

    const session = await this.client.checkout.sessions.create(
      params,
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );

    if (!session.url) {
      throw new Error(
        "commonpayment(stripe): Checkout Session created without a redirect URL.",
      );
    }
    return { id: session.id, url: session.url };
  }

  /**
   * Verify a webhook request's signature and return the typed event. The caller
   * must pass the **raw** request body (unparsed string) and the value of the
   * `Stripe-Signature` header. Never trust an event that didn't come back `ok`.
   *
   * Amount verification, idempotency, and fulfilment are the CALLER's job — this
   * only proves the event genuinely came from Stripe.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookVerifyResult {
    if (!this.webhookSecret) return { ok: false, reason: "not-configured" };
    if (!signatureHeader) return { ok: false, reason: "missing-signature" };
    try {
      const event = this.client.webhooks.constructEvent(
        rawBody,
        signatureHeader,
        this.webhookSecret,
      );
      return { ok: true, event };
    } catch (err) {
      return {
        ok: false,
        reason: "invalid-signature",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Construct a `StripeProvider`, resolving config from env when not passed:
 *   - `secretKey`     ← `cfg.secretKey`     ?? `process.env.STRIPE_SECRET_KEY`
 *   - `webhookSecret` ← `cfg.webhookSecret` ?? `process.env.STRIPE_WEBHOOK_SECRET`
 *
 * Throws if no secret key is available (a mis-configured deploy should fail
 * loudly, not silently take payments through a broken client).
 */
export function createStripeProvider(cfg?: Partial<StripeConfig>): StripeProvider {
  const secretKey = cfg?.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "commonpayment(stripe): STRIPE_SECRET_KEY is not set (and no secretKey passed).",
    );
  }
  const webhookSecret = cfg?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  return new StripeProvider({ secretKey, webhookSecret });
}

/**
 * Resolve a TRUSTED absolute origin for Checkout success/cancel URLs, without
 * ever trusting the request's `Host`/`Origin` header (which an attacker can
 * spoof to mint a genuine session on your account that redirects to their site).
 *
 * Pure helper — reads no env. Pass your configured site URL (e.g. from
 * `NEXT_PUBLIC_SITE_URL`), whether you're in production, and an optional dev
 * fallback (e.g. the request URL's origin). In production a configured URL is
 * REQUIRED; otherwise it throws.
 */
export function trustedCheckoutOrigin(opts: {
  configuredUrl?: string | null;
  isProduction: boolean;
  fallbackUrl?: string | null;
}): string {
  const configured = opts.configuredUrl?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (opts.isProduction) {
    throw new Error(
      "commonpayment(stripe): a trusted site URL must be configured in production " +
        "(never derive checkout URLs from the request Host header).",
    );
  }
  const fallback = opts.fallbackUrl?.trim();
  if (fallback) return fallback.replace(/\/+$/, "");
  throw new Error(
    "commonpayment(stripe): no configured site URL and no fallback origin available.",
  );
}

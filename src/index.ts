/**
 * Public API for the `commonpayment` package.
 *
 * `commonpayment` is a provider-agnostic payment integration that lets
 * consuming apps switch between **ECPay (綠界)** and **NewebPay (藍新)**
 * — Taiwan's two major payment aggregators — via a single configuration
 * change, without rewriting checkout, callback, or state-machine code.
 *
 * Design notes
 * ------------
 * This package is **deliberately storage-agnostic** — it does NOT read
 * Supabase, environment variables (beyond the per-adapter
 * `ECPAY_*` / `NEWEBPAY_*` sandbox-creds fallback), or any other
 * host-app context to PICK a provider. The consuming app owns the
 * "which provider is active" decision (typically reading from its own
 * DB / settings / env) and then calls `createProvider(name)` to get
 * the matching adapter.
 *
 * Why: every consuming app has different storage (Supabase, Postgres,
 * Firebase, plain env vars, …). Coupling this package to one of them
 * would force every adopter to take that dependency. The thin
 * `createProvider(name)` factory pushes all the "where do I read the
 * config from" decisions to the host app, where they belong.
 *
 * Usage
 * -----
 *
 * ```ts
 * // Consumer's host-app code (e.g. a Next.js API route):
 * import { createProvider, isProviderName, type ProviderName } from "commonpayment";
 *
 * // 1. Decide which provider to use (your decision, your storage).
 * const settingsRow = await sb.from("settings")
 *   .select("value").eq("key", "payment_provider").single();
 * const name: ProviderName = isProviderName(settingsRow?.data?.value)
 *   ? settingsRow.data!.value as ProviderName
 *   : "ecpay";
 *
 * // 2. Instantiate the matching adapter.
 * const provider = createProvider(name);
 *
 * // 3. Build the redirect-POST form for the user's order.
 * const order = provider.buildOrder({
 *   merchantOrderId: provider.generateMerchantOrderId(),
 *   amountTwd: 899,
 *   itemName: "Sticker Pack",
 *   tradeDesc: "LINE 貼圖製作費",
 *   notifyUrl: "https://example.com/api/payment/ecpay/callback",
 *   returnUrl: "https://example.com/order/123",
 *   preferredMethod: "CREDIT",
 * });
 * // → order.endpoint, order.fields (POST these to a hidden HTML form)
 *
 * // 4. In your callback route, verify the provider's signed payload:
 * const rawBody = await req.text();
 * const result = provider.verifyCallback(rawBody, req.headers);
 * if (result.ok && result.orderResult.paymentStatus === "success") {
 *   // … mark application paid …
 * }
 * const { body, contentType } = provider.formatAck(result.ok ? "ok" : "reject");
 * return new Response(body, { headers: { "Content-Type": contentType } });
 * ```
 *
 * Callback URL ↔ adapter binding
 * -----------------------------
 *
 * For incoming callbacks (webhooks), DO NOT use whatever your
 * settings/env currently says. Instantiate the adapter that matches
 * the **URL the provider sent the callback to** (`/api/payment/ecpay/
 * callback` → `createProvider("ecpay")`). Otherwise an in-flight
 * ECPay callback sent while settings was just flipped to `newebpay`
 * would be handed to the wrong verifier and 400 on a "signature
 * invalid" false negative.
 */

export * from "./types";

export {
  EcpayProvider,
  createEcpayProvider,
  type EcpayMode,
  type EcpayProviderConfig,
} from "./ecpay";

export {
  NewebpayProvider,
  createNewebpayProvider,
  getNewebpayConfig,
  generateNewebpayMerchantOrderId,
  aesEncrypt,
  aesDecrypt,
  buildTradeSha,
  type NewebpayMode,
  type NewebpayConfig,
} from "./newebpay";

import { createEcpayProvider } from "./ecpay";
import { createNewebpayProvider, type NewebpayConfig } from "./newebpay";
import type { PaymentProvider, ProviderName } from "./types";

// ---------------------------------------------------------------------------
// createProvider — name-based factory (the public factory consumers need)
// ---------------------------------------------------------------------------

const VALID_PROVIDERS: readonly ProviderName[] = ["ecpay", "newebpay"];

/**
 * Type guard for provider names. Useful when validating an arbitrary
 * string (e.g. from a settings row, an env var, or a URL segment)
 * before passing it to `createProvider`.
 */
export function isProviderName(value: unknown): value is ProviderName {
  return (
    typeof value === "string" &&
    (VALID_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Optional per-provider override config for `createProvider`. Pass
 * `newebpay` config only when you want to bypass the env-var-driven
 * defaults (testing, multi-tenant setups). For production, leave
 * undefined and let the adapter read its own env (`ECPAY_*` /
 * `NEWEBPAY_*`) — falls back to the public sandbox creds when env
 * is blank.
 *
 * Note: `createEcpayProvider()` reads env directly and currently
 * accepts no config arg — pass `ECPAY_*` env vars to override.
 */
export interface CreateProviderOptions {
  newebpay?: NewebpayConfig;
}

/**
 * Instantiate the matching payment adapter by name.
 *
 * Throws if `name` isn't one of the supported provider names —
 * surface this as a 500 / config error in the consuming app rather
 * than silently falling back to a default (which masks misconfig).
 *
 * Defaults inside each adapter read sandbox creds from env vars
 * (`ECPAY_*` / `NEWEBPAY_*`) and fall back to the public sandbox
 * shared creds when env is blank.
 */
export function createProvider(
  name: ProviderName,
  opts: CreateProviderOptions = {},
): PaymentProvider {
  if (name === "ecpay") return createEcpayProvider();
  if (name === "newebpay") return createNewebpayProvider(opts.newebpay);
  // Exhaustiveness guard — the ProviderName union forbids other
  // values at the type level, but a runtime string from a settings
  // row could still slip through. Throw loudly.
  throw new Error(
    `commonpayment: unknown provider name "${name as string}". ` +
      `Valid: ${VALID_PROVIDERS.join(", ")}.`,
  );
}

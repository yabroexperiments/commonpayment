/**
 * ECPay (綠界) PaymentProvider adapter.
 *
 * Mirrors the `EcpayProvider` shape described in the design doc
 * `/Users/albert/Documents/ClaudeCodex/docs/PAYMENT_PROCESSOR.md` §3
 * — the same CheckMacValue / MerchantTradeNo / aio-form logic that
 * has lived inline in `src/lib/ecpay.ts` (the pure-library module
 * still in use by the legacy callback + checkout-page consumers),
 * wrapped behind the abstract `PaymentProvider` contract from
 * `./types`.
 *
 * Why two files exist during the transition:
 *   - `src/lib/ecpay.ts` is the LEGACY library — exports loose
 *     functions (`buildOrderFields`, `verifyCheckMacValue`,
 *     `generateMerchantTradeNo`). Still imported by
 *     `/api/ecpay/callback`, `/sticker/application/[id]/checkout`,
 *     and `/api/applications`. Leave it alone in this stage.
 *   - This file is the NEW adapter — the class that the
 *     forthcoming `commonpayment` package will export. The next
 *     stage's integration agent rewires the legacy consumers to
 *     this provider; once nothing imports the loose helpers, the
 *     legacy file gets deleted.
 *
 * Provider-specific quirks preserved verbatim:
 *   - .NET-style URL encoding for CheckMacValue input (lowercase
 *     hex, restore `- _ . ! * ( )`, `%20 → +` for spaces). The
 *     space→`+` replacement is load-bearing — MerchantTradeDate
 *     always has a space, omitting it produces signature error
 *     10200073 on every order. Verified live against ECPay
 *     sandbox 2026-05-28.
 *   - MerchantTradeDate must be TW-local time formatted
 *     `YYYY/MM/DD HH:mm:ss` (NOT ISO).
 *   - MerchantTradeNo: 20 chars max, alphanumeric only, must be
 *     unique forever (re-using one returns an error even if the
 *     prior order failed). `GS` + 18 hex chars from a random UUID.
 *   - Callback ack is the literal text `"1|OK"` for accepted /
 *     idempotent-noop, `"0|<reason>"` to signal failure (triggers
 *     ECPay's 24h retry queue).
 *
 * Reference: design doc §3 (ECPay adapter), §7 (callback route
 * changes), and the AioCheckOut V5 spec at
 * https://www.ecpay.com.tw/Service/API_Dwnld
 */

import crypto from "crypto";

import type {
  Ack,
  BuildOrderInput,
  BuildOrderResult,
  CallbackResult,
  PaymentMethod,
  PaymentProvider,
  ProviderName,
  VerifiedOrderResult,
} from "./types";

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export type EcpayMode = "stage" | "production";

const ENDPOINTS: Record<EcpayMode, string> = {
  stage: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
  production: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
};

/**
 * Public ECPay sandbox credentials — anyone can use these for
 * testing without signing up. NEVER use in production. Baked in
 * as fallbacks so `npm run dev` works with an empty `.env.local`.
 */
const SANDBOX_DEFAULTS = {
  merchantId: "2000132",
  hashKey: "5294y06JbISpM5x9",
  hashIV: "v77hoKGq4kWxNNIS",
} as const;

export interface EcpayProviderConfig {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  endpoint: string;
}

// ---------------------------------------------------------------------------
// Method enum mapping — abstract `PaymentMethod` → ECPay `ChoosePayment`
// ---------------------------------------------------------------------------

/**
 * ECPay's documented `ChoosePayment` values. `ALL` is the default
 * — ECPay's hosted page shows every method the merchant has
 * enabled. Any other value pre-selects (or restricts to) one
 * method. See https://developers.ecpay.com.tw/?p=2862 for the
 * canonical list.
 */
type EcpayChoosePayment =
  | "ALL"
  | "Credit"
  | "WebATM"
  | "ATM"
  | "CVS"
  | "BARCODE"
  | "ApplePay"
  | "TWQR";

const METHOD_MAP: Record<PaymentMethod, EcpayChoosePayment> = {
  CREDIT: "Credit",
  APPLEPAY: "ApplePay",
  ATM: "ATM",
  CVS: "CVS",
  TWQR: "TWQR",
  ALL: "ALL",
};

function mapMethod(method: PaymentMethod | undefined): EcpayChoosePayment {
  if (!method) return "ALL";
  return METHOD_MAP[method] ?? "ALL";
}

// ---------------------------------------------------------------------------
// Crypto + encoding primitives (preserve legacy semantics exactly)
// ---------------------------------------------------------------------------

/**
 * ECPay's CheckMacValue input is URL-encoded with .NET's
 * HttpUtility.UrlEncode rules — lowercase hex output, a specific
 * set of "safe" chars left unescaped, AND space encoded as `+`
 * (NOT `%20`).
 *
 * The `%20 → +` replacement is the load-bearing piece that earlier
 * implementations elsewhere have missed. MerchantTradeDate always
 * contains a space (e.g. `"2026/05/28 18:30:00"`), so without it
 * EVERY signature is off by one character and ECPay rejects with
 * `10200073 CheckMacValue Error`. Verified live against the
 * sandbox 2026-05-28 — do not remove the `.replace(/%20/g, "+")`
 * line thinking it's redundant with `encodeURIComponent`.
 */
function ecpayUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .toLowerCase()
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%20/g, "+");
}

/**
 * Compute ECPay's CheckMacValue per spec:
 *   1. Sort params alphabetically by key (case-insensitive),
 *      omitting any existing `CheckMacValue` field.
 *   2. Prepend `HashKey=...&` and append `&HashIV=...`.
 *   3. URL-encode the joined string with `.NET` conventions
 *      (above).
 *   4. Lowercase the whole string.
 *   5. SHA256 → hex → uppercase.
 */
function buildCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return crypto.createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

/**
 * Verify a CheckMacValue submitted in an incoming callback.
 *
 * Constant-time compare would be ideal in principle, but the
 * strings are fixed-length uppercase hex and the callback is
 * server-to-server (no realistic timing attack surface), so a
 * simple uppercased `===` is fine here. Matches the legacy
 * implementation.
 */
function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): boolean {
  const submitted = params.CheckMacValue;
  if (!submitted) return false;
  const expected = buildCheckMacValue(params, hashKey, hashIV);
  return submitted.toUpperCase() === expected.toUpperCase();
}

// ---------------------------------------------------------------------------
// Time formatting — ECPay wants TW-local `YYYY/MM/DD HH:mm:ss`
// ---------------------------------------------------------------------------

function formatTwTradeDate(now: Date = new Date()): string {
  // ECPay wants TW-local time formatted `YYYY/MM/DD HH:mm:ss`.
  // `toLocaleString("zh-TW")` returns Chinese-style date strings —
  // easier to build from UTC + 8h offset.
  const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${twTime.getUTCFullYear()}/${pad(twTime.getUTCMonth() + 1)}/${pad(twTime.getUTCDate())} ` +
    `${pad(twTime.getUTCHours())}:${pad(twTime.getUTCMinutes())}:${pad(twTime.getUTCSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// Callback parsing
// ---------------------------------------------------------------------------

/**
 * Parse a form-urlencoded callback body into a plain string map.
 * Returns `null` when the body isn't parseable as
 * `application/x-www-form-urlencoded` or yields zero entries.
 */
function parseFormBody(rawBody: string): Record<string, string> | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of params.entries()) {
    out[k] = v;
    count++;
  }
  if (count === 0) return null;
  return out;
}

// ---------------------------------------------------------------------------
// EcpayProvider — the PaymentProvider implementation
// ---------------------------------------------------------------------------

export class EcpayProvider implements PaymentProvider {
  readonly name: ProviderName = "ecpay";

  constructor(private readonly cfg: EcpayProviderConfig) {}

  /**
   * Generate a fresh `MerchantTradeNo` — 20 chars, alphanumeric.
   * Format: `GS` (gogosticker prefix, for easy log-grepping) + 18
   * uppercase hex chars from 9 random bytes.
   *
   * ECPay rejects re-use of any historical MerchantTradeNo even
   * if the original order failed — caller MUST persist this before
   * `buildOrder` so a fast callback can correlate via the DB.
   */
  generateMerchantOrderId(): string {
    const hex = crypto.randomBytes(9).toString("hex"); // 18 chars
    return `GS${hex}`.toUpperCase();
  }

  /**
   * Build the auto-POST handoff: returns the AioCheckOut V5
   * endpoint plus the hidden form fields (including the computed
   * CheckMacValue). The consuming app renders a
   * `<form action={endpoint} method="POST">` with one hidden
   * `<input>` per entry and auto-submits.
   *
   * Defaults:
   *   - `PaymentType = aio` (means "use AioCheckOut; ECPay picks
   *     the underlying gateway")
   *   - `ChoosePayment = ALL` (let the user pick on ECPay's page)
   *   - `EncryptType = 1` (SHA256)
   *   - `MerchantTradeDate = <current TW time formatted>`
   */
  buildOrder(input: BuildOrderInput): BuildOrderResult {
    const fields: Record<string, string> = {
      MerchantID: this.cfg.merchantId,
      MerchantTradeNo: input.merchantOrderId,
      MerchantTradeDate: formatTwTradeDate(),
      PaymentType: "aio",
      TotalAmount: String(input.amountTwd),
      TradeDesc: input.tradeDesc,
      ItemName: input.itemName,
      ReturnURL: input.notifyUrl,
      ClientBackURL: input.returnUrl,
      ChoosePayment: mapMethod(input.preferredMethod),
      EncryptType: "1",
    };

    // OrderResultURL (optional) — when present ECPay auto-POSTs the
    // browser here after payment instead of only rendering a manual
    // "返回商店" button (that's ClientBackURL). We keep ClientBackURL
    // too as a fallback. CheckMacValue is computed over ALL fields,
    // so add this BEFORE the signature below.
    if (input.orderResultUrl) {
      fields.OrderResultURL = input.orderResultUrl;
    }

    fields.CheckMacValue = buildCheckMacValue(
      fields,
      this.cfg.hashKey,
      this.cfg.hashIV,
    );

    return { endpoint: this.cfg.endpoint, fields };
  }

  /**
   * Parse + verify an incoming server-to-server callback. Does
   * NOT touch the DB — the consuming route is responsible for the
   * cross-checks that need DB context (amount, idempotency,
   * existence of the order). ECPay does not use header metadata,
   * but `headers` is accepted to keep the contract uniform with
   * future providers.
   */
  verifyCallback(rawBody: string, _headers: Headers): CallbackResult {
    const fields = parseFormBody(rawBody);
    if (!fields) {
      return {
        ok: false,
        reason: "unknown-format",
        detail: "body was not parseable as application/x-www-form-urlencoded",
      };
    }

    const merchantOrderId = fields.MerchantTradeNo;
    if (!merchantOrderId) {
      return {
        ok: false,
        reason: "missing-fields",
        detail: "MerchantTradeNo missing",
      };
    }

    const valid = verifyCheckMacValue(fields, this.cfg.hashKey, this.cfg.hashIV);
    if (!valid) {
      return {
        ok: false,
        reason: "invalid-signature",
        detail: "CheckMacValue did not match",
      };
    }

    const rtnCodeRaw = fields.RtnCode ?? "";
    const paymentStatus: VerifiedOrderResult["paymentStatus"] =
      rtnCodeRaw === "1" ? "success" : "failed";

    const amountRaw = fields.TradeAmt ?? "0";
    const amountTwd = Number.parseInt(amountRaw, 10);

    const orderResult: VerifiedOrderResult = {
      merchantOrderId,
      providerTradeNo: fields.TradeNo ?? "",
      amountTwd: Number.isFinite(amountTwd) ? amountTwd : 0,
      paymentStatus,
      paymentMethod: fields.PaymentType ?? "",
      // ECPay sends all values as strings in the form-encoded body —
      // hand them through verbatim for the consuming route to
      // persist as audit JSON on `applications.payment_meta`.
      rawFields: { ...fields },
    };

    return { ok: true, orderResult };
  }

  /**
   * Format the ack body ECPay requires after processing the
   * callback. The literal `"1|OK"` text is mandatory for the
   * success path — anything else and ECPay's retry queue keeps
   * hammering the endpoint every 10 minutes for ~24h.
   *
   * For rejection we return `"0|<reason>"`. Use sparingly — only
   * when we genuinely want ECPay to retry. For clearly-malformed
   * requests that no retry will fix, the consuming route should
   * skip this helper and return HTTP 400 with no body.
   */
  formatAck(verdict: "ok" | "reject", detail?: string): Ack {
    const body = verdict === "ok" ? "1|OK" : `0|${detail ?? "rejected"}`;
    return { body, contentType: "text/plain; charset=utf-8" };
  }
}

// ---------------------------------------------------------------------------
// Factory — read env / fall back to public sandbox
// ---------------------------------------------------------------------------

/**
 * Build an `EcpayProvider` from environment variables, falling
 * back to the public sandbox credentials when env values are
 * blank. Sandbox endpoint is used unless `ECPAY_MODE=production`.
 *
 * Mirrors the env shape used by `getEcpayConfig()` in the legacy
 * `src/lib/ecpay.ts`, so swapping consumers from the loose
 * helpers to this factory is a one-line import change at each
 * call site (the next stage's integration work).
 */
export function createEcpayProvider(): EcpayProvider {
  const mode: EcpayMode =
    process.env.ECPAY_MODE === "production" ? "production" : "stage";
  const merchantId =
    process.env.ECPAY_MERCHANT_ID?.trim() || SANDBOX_DEFAULTS.merchantId;
  const hashKey =
    process.env.ECPAY_HASH_KEY?.trim() || SANDBOX_DEFAULTS.hashKey;
  const hashIV =
    process.env.ECPAY_HASH_IV?.trim() || SANDBOX_DEFAULTS.hashIV;
  return new EcpayProvider({
    merchantId,
    hashKey,
    hashIV,
    endpoint: ENDPOINTS[mode],
  });
}

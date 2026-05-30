/**
 * 藍新 (NewebPay) MPG adapter — implements the `PaymentProvider`
 * interface defined in `./types.ts`.
 *
 * This is the second adapter (sibling to `src/lib/ecpay.ts`),
 * brought online so the consuming app can flip processors at
 * runtime via `settings.payment_provider`. Built fresh against the
 * NewebPay MPG (Merchant Payment Gateway) v2.0 spec — NOT a port of
 * the ECPay code.
 *
 * The two providers' on-the-wire shapes differ substantially:
 *   - ECPay: ~20 cleartext fields + a single `CheckMacValue` field
 *     (HMAC-style; signature is over the URL-encoded sorted params).
 *   - NewebPay: 4 outer fields, where ALL business data is
 *     AES-256-CBC encrypted into one `TradeInfo` blob, with the
 *     blob's SHA256 (over `HashKey=…&TradeInfo=…&HashIV=…`) sitting
 *     beside it as `TradeSha`.
 *
 * The shared `PaymentProvider` interface hides both schemes from
 * the consuming app — both adapters return the same
 * `{endpoint, fields}` shape and the consuming page POSTs whatever's
 * in `fields`. See `./types.ts` for the contract.
 *
 * Inverted URL semantics — read carefully when wiring callback
 * routes:
 *   - ECPay uses `ReturnURL` as the SERVER-to-server webhook.
 *   - NewebPay uses `ReturnURL` as the BROWSER landing URL and
 *     `NotifyURL` as the server-to-server webhook.
 * The `PaymentProvider` interface normalises this — `notifyUrl` is
 * always the webhook, `returnUrl` is always the browser landing.
 * Each adapter maps to the right field internally.
 *
 * References (cite these before editing):
 *   - NewebPay MPG API docs: https://www.newebpay.com/website/Page/content/download_api
 *   - depresto/newebpay-mpg-sdk (community reference impl):
 *     https://github.com/depresto/newebpay-mpg-sdk
 *   - Design doc §4 (NewebPay adapter shape):
 *     /Users/albert/Documents/ClaudeCodex/docs/PAYMENT_PROCESSOR.md
 */

import * as crypto from "node:crypto";
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
// Config — env with public-sandbox fallback
// ---------------------------------------------------------------------------

/** `'stage'` (sandbox) | `'production'` (live). */
export type NewebpayMode = "stage" | "production";

/**
 * Resolved NewebPay credentials + endpoint.
 *
 * `hashKey` MUST be exactly 32 ASCII bytes (used as AES-256-CBC key).
 * `hashIV`  MUST be exactly 16 ASCII bytes (used as AES-256-CBC IV /
 * one cipher block). Per-merchant, per-environment — sandbox and
 * production differ. NewebPay rotates these in their merchant
 * backend; if rotation lands a value of a different byte length, the
 * adapter will throw at first use (see `assertKeyShapes`).
 */
export interface NewebpayConfig {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  mode: NewebpayMode;
  endpoint: string;
}

/**
 * Sandbox credentials are public — they appear in every community
 * SDK + NewebPay's own quick-start docs. They let local dev work
 * with an empty `.env.local`. Replace via env vars in any deployed
 * environment.
 *
 * Tied to the matching `ccore.newebpay.com` sandbox gateway below.
 */
const SANDBOX_MERCHANT_ID = "MS17361556";
const SANDBOX_HASH_KEY = "MCmYlwSGnG1bvT4x7cKPqJSWXuQFjgXd";
const SANDBOX_HASH_IV = "C5b72pgzdVZofYGP";
const SANDBOX_ENDPOINT = "https://ccore.newebpay.com/MPG/mpg_gateway";
const PRODUCTION_ENDPOINT = "https://core.newebpay.com/MPG/mpg_gateway";

/**
 * Resolve config from env, falling back to public sandbox creds.
 *
 * Env vars (deliberately omit the `KEY` / `SECRET` substring on
 * public names; see PetBusiness/CLAUDE.md → "Vercel 'Sensitive'
 * gotcha"). For NewebPay all four are server-only so the naming
 * doesn't matter for build-time inlining — `HASH_KEY` / `HASH_IV`
 * keep the trigger words because they ARE genuinely private.
 *
 *   - `NEWEBPAY_MERCHANT_ID`
 *   - `NEWEBPAY_HASH_KEY` (32 bytes ASCII)
 *   - `NEWEBPAY_HASH_IV`  (16 bytes ASCII)
 *   - `NEWEBPAY_MODE` = `'stage' | 'production'` (default `'stage'`)
 */
export function getNewebpayConfig(): NewebpayConfig {
  const merchantId = (process.env.NEWEBPAY_MERCHANT_ID ?? "").trim() || SANDBOX_MERCHANT_ID;
  const hashKey = (process.env.NEWEBPAY_HASH_KEY ?? "").trim() || SANDBOX_HASH_KEY;
  const hashIV = (process.env.NEWEBPAY_HASH_IV ?? "").trim() || SANDBOX_HASH_IV;
  const modeRaw = (process.env.NEWEBPAY_MODE ?? "").trim().toLowerCase();
  const mode: NewebpayMode = modeRaw === "production" ? "production" : "stage";
  const endpoint = mode === "production" ? PRODUCTION_ENDPOINT : SANDBOX_ENDPOINT;
  return { merchantId, hashKey, hashIV, mode, endpoint };
}

/**
 * Throw a helpful error early if key/IV byte counts are wrong. The
 * AES primitives will throw too but with cryptic messages — this
 * front-loads a readable failure mode for ops.
 */
function assertKeyShapes(cfg: NewebpayConfig): void {
  const keyBytes = Buffer.byteLength(cfg.hashKey, "utf8");
  const ivBytes = Buffer.byteLength(cfg.hashIV, "utf8");
  if (keyBytes !== 32) {
    throw new Error(
      `newebpay: HashKey must be exactly 32 ASCII bytes for AES-256-CBC; got ${keyBytes}`,
    );
  }
  if (ivBytes !== 16) {
    throw new Error(
      `newebpay: HashIV must be exactly 16 ASCII bytes for AES-256-CBC; got ${ivBytes}`,
    );
  }
}

// ---------------------------------------------------------------------------
// AES + SHA helpers
// ---------------------------------------------------------------------------

/** AES-256-CBC block size in bytes. NewebPay uses 32-byte PKCS7 padding. */
const AES_BLOCK_SIZE = 32;

/**
 * PKCS7 padding to the AES-256-CBC block size.
 *
 * Note: standard AES-256-CBC block size is 16 bytes, but NewebPay's
 * reference implementation pads to 32 (a multiple of the AES block
 * size — still valid PKCS7 on a 16-byte cipher, just rounded up).
 * We follow the NewebPay convention so produced ciphertexts match
 * what their gateway expects.
 *
 * We do padding by hand because Node's `setAutoPadding(true)` has
 * historically had off-by-one quirks with non-default block sizes
 * and some Node versions. Manual padding + `setAutoPadding(false)`
 * is the durable shape.
 */
function pkcs7Pad(data: string, blockSize = AES_BLOCK_SIZE): Buffer {
  const buf = Buffer.from(data, "utf8");
  const padLen = blockSize - (buf.length % blockSize);
  // padLen is in [1, blockSize] — never 0. PKCS7 spec.
  return Buffer.concat([buf, Buffer.alloc(padLen, padLen)]);
}

/**
 * Strip PKCS7 padding. Returns null on invalid padding so callers
 * can flag a `decrypt-failed` reason instead of crashing.
 *
 * Validates the last byte's value (1..blockSize) AND that all
 * trailing bytes match it — guards against truncated ciphertexts
 * that happen to end in a numerically-valid byte.
 */
function pkcs7Unpad(buf: Buffer): Buffer | null {
  if (buf.length === 0) return null;
  const padLen = buf[buf.length - 1]!;
  if (padLen < 1 || padLen > AES_BLOCK_SIZE) return null;
  if (padLen > buf.length) return null;
  for (let i = buf.length - padLen; i < buf.length; i++) {
    if (buf[i] !== padLen) return null;
  }
  return buf.subarray(0, buf.length - padLen);
}

/**
 * AES-256-CBC encrypt with PKCS7 padding → lowercase hex.
 *
 * NewebPay accepts and produces lowercase hex specifically for
 * `TradeInfo`. (Uppercase would re-hash to a different SHA256.)
 */
export function aesEncrypt(plaintext: string, key: string, iv: string): string {
  const padded = pkcs7Pad(plaintext);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8"),
  );
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("hex"); // lowercase by Buffer convention
}

/**
 * AES-256-CBC decrypt hex → UTF-8 plaintext (or null on any
 * decrypt / unpad failure).
 *
 * Common failure modes returning null:
 *   - wrong HashKey / HashIV (HMAC mismatch upstream wouldn't even
 *     get us here, so this almost always means a key-rotation skew
 *     between our env and NewebPay's account)
 *   - truncated body
 *   - tampered TradeInfo with valid SHA (impossible without our key)
 */
export function aesDecrypt(hex: string, key: string, iv: string): string | null {
  try {
    const encrypted = Buffer.from(hex, "hex");
    if (encrypted.length === 0 || encrypted.length % 16 !== 0) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(key, "utf8"),
      Buffer.from(iv, "utf8"),
    );
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const unpadded = pkcs7Unpad(decrypted);
    if (!unpadded) return null;
    return unpadded.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Build the `TradeSha` value NewebPay expects.
 *
 * The exact format string is load-bearing — NewebPay does the same
 * concatenation server-side and compares hashes byte-for-byte.
 *   `HashKey={HashKey}&TradeInfo={TradeInfo}&HashIV={HashIV}`
 * Do NOT reorder, do NOT add a space, do NOT lowercase the output.
 *
 * Note: NewebPay also has a separate `CheckCode` scheme for the
 * QueryTradeInfo response with a different ordering:
 *   `HashIV={iv}&Amt={amt}&MerchantID={mid}&MerchantOrderNo={ono}&TradeNo={tno}&HashKey={key}`
 * — don't reuse this builder there. We don't ship QueryTradeInfo
 * support yet (deferred per design doc §2 "Defer for v1"), but
 * the comment is here for the next person who implements it.
 */
export function buildTradeSha(tradeInfoHex: string, key: string, iv: string): string {
  return crypto
    .createHash("sha256")
    .update(`HashKey=${key}&TradeInfo=${tradeInfoHex}&HashIV=${iv}`)
    .digest("hex")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Merchant order ID
// ---------------------------------------------------------------------------

/**
 * Generate a merchant-unique order ID: `NB` + 18 uppercase hex chars,
 * total 20 chars `[A-Z0-9]`. NewebPay allows up to 30 chars
 * (`[A-Za-z0-9_]`); we match ECPay's 20-char shape for cross-
 * provider uniformity in DB columns and merchant-backend
 * spreadsheets.
 *
 * `NB` prefix instead of `GS` (ECPay's) so an order ID alone
 * disambiguates the provider when debugging.
 *
 * Uses `crypto.randomBytes` (cryptographically random) rather than
 * `Date.now()` to avoid collisions on the rare same-millisecond
 * double-submit. Unique-across-all-history is mandatory — NewebPay
 * rejects re-used IDs even if the prior order failed.
 */
export function generateNewebpayMerchantOrderId(): string {
  const hex = crypto.randomBytes(9).toString("hex").toUpperCase(); // 18 chars
  return `NB${hex}`;
}

// ---------------------------------------------------------------------------
// Payment method mapping
// ---------------------------------------------------------------------------

/**
 * Map our abstract `PaymentMethod` enum onto NewebPay's per-channel
 * flag fields. Each returned object's entries get spread into the
 * inner params block (each one is a string `"1"` or `"0"`).
 *
 *   - `'CREDIT'`   → `{ CREDIT: '1' }`
 *   - `'APPLEPAY'` → `{ APPLEPAY: '1' }`
 *   - `'ATM'`      → `{ VACC: '1' }`    (虛擬帳號 ATM)
 *   - `'CVS'`      → `{ CVS: '1' }`
 *   - `'TWQR'`     → `{}` (no native NewebPay channel; documented gap)
 *   - `'ALL'`      → `{}` (gateway shows every enabled channel)
 *   - undefined    → `{}` (same as ALL)
 *
 * **TWQR gap.** NewebPay doesn't have a direct TWQR (台灣 Pay QR)
 * channel; closest fits would be ESUNWALLET / EZPAY which require
 * separate sub-merchant onboarding. For v1 we silently fall through
 * to "show all enabled methods" — the gateway's method picker still
 * lets the user pick whatever's enabled on the merchant account.
 * Revisit if TWQR-specific routing becomes a product requirement.
 *
 * **LINEPAY note.** LINE Pay channel requires LINE Pay's own
 * merchant approval (statutory 統編 + business registration). Not
 * exposed here because individual sellers (the gogoLINEsticker
 * audience target) can't enable it. If we add `'LINEPAY'` to the
 * `PaymentMethod` enum later, map it to `{ LINEPAY: '1' }`.
 */
function mapMethodToFlags(method: PaymentMethod | undefined): Record<string, string> {
  switch (method) {
    case "CREDIT":
      return { CREDIT: "1" };
    case "APPLEPAY":
      return { APPLEPAY: "1" };
    case "ATM":
      return { VACC: "1" };
    case "CVS":
      return { CVS: "1" };
    case "TWQR":
      // Documented gap — no direct NewebPay channel. Fall through to "show all".
      return {};
    case "ALL":
    case undefined:
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * `PaymentProvider` impl for 藍新 (NewebPay) MPG.
 *
 * Stateless after construction. Safe to share one instance across
 * all request handlers in the Next.js process — every per-request
 * input is passed in via method args.
 *
 * Construct via `createNewebpayProvider()` (factory function below)
 * rather than `new NewebpayProvider(getNewebpayConfig())` directly,
 * so the env-resolution + key-shape validation happens in one place.
 */
export class NewebpayProvider implements PaymentProvider {
  readonly name: ProviderName = "newebpay";

  /** Resolved config — captured once at construction. */
  private readonly cfg: NewebpayConfig;

  constructor(cfg: NewebpayConfig) {
    assertKeyShapes(cfg);
    this.cfg = cfg;
  }

  /** See `./types.ts` `PaymentProvider.generateMerchantOrderId`. */
  generateMerchantOrderId(): string {
    return generateNewebpayMerchantOrderId();
  }

  /**
   * Build the auto-POST handoff. Resulting `fields` are the FOUR
   * outer values NewebPay's gateway page expects:
   *
   *   - `MerchantID`
   *   - `TradeInfo`  (AES-encrypted hex blob of the inner params)
   *   - `TradeSha`   (uppercase SHA256 of HashKey/TradeInfo/HashIV)
   *   - `Version`    (`'2.0'`)
   *
   * `EncryptType=1` is part of the INNER params (per NewebPay spec
   * — they want it inside the encrypted blob, NOT at the outer
   * level), so it does NOT appear in `fields`.
   *
   * (Earlier drafts of the design doc had `EncryptType` at the
   * outer level matching some community SDKs; correct per NewebPay's
   * own API doc is inside TradeInfo. If the gateway rejects with
   * `MPG02002` "缺少參數 EncryptType", move it to the outer fields.)
   */
  buildOrder(input: BuildOrderInput): BuildOrderResult {
    // Step 1: build inner params.
    // ItemDesc has a NewebPay-imposed 50-char cap (vs ECPay's 200) —
    // truncate to be safe. CJK is fine in TradeInfo (AES-encrypted),
    // so the truncate is purely character-count not byte-count.
    const itemDesc = input.itemName.length > 50 ? input.itemName.slice(0, 50) : input.itemName;

    // RespondType: 'String' returns the callback as URL-encoded form
    // body (so the Result.* fields come back as `Result=<urlencoded>`
    // inside the decrypted TradeInfo). 'JSON' would return them as a
    // JSON-stringified Result object. String is closer to ECPay's
    // shape and slightly simpler to debug (no JSON-in-AES Russian
    // doll). Switch to 'JSON' if a downstream tool needs structured
    // access without the URL-decoding step.
    const inner: Record<string, string> = {
      MerchantID: this.cfg.merchantId,
      RespondType: "String",
      TimeStamp: String(Math.floor(Date.now() / 1000)),
      Version: "2.0",
      MerchantOrderNo: input.merchantOrderId,
      Amt: String(Math.floor(input.amountTwd)),
      ItemDesc: itemDesc,
      Email: "", // optional; we don't collect a customer email at buildOrder time in v1
      NotifyURL: input.notifyUrl, // server-to-server webhook (opposite of ECPay's ReturnURL semantic!)
      ReturnURL: input.returnUrl, // browser landing (opposite of ECPay's ReturnURL semantic!)
      ...mapMethodToFlags(input.preferredMethod),
    };

    // Step 2: URL-encode as a query string (the plaintext that
    // becomes the AES input). `URLSearchParams.toString()` produces
    // application/x-www-form-urlencoded output, which is exactly
    // what NewebPay expects. Order of keys follows insertion order
    // — NewebPay does NOT require sorted keys for the encrypted
    // blob (unlike ECPay's CheckMacValue).
    const queryString = new URLSearchParams(inner).toString();

    // Step 3: AES-256-CBC encrypt → lowercase hex.
    const tradeInfo = aesEncrypt(queryString, this.cfg.hashKey, this.cfg.hashIV);

    // Step 4: TradeSha — SHA256 of HashKey={key}&TradeInfo={hex}&HashIV={iv}, uppercase.
    const tradeSha = buildTradeSha(tradeInfo, this.cfg.hashKey, this.cfg.hashIV);

    // Step 5: outer form fields (only 4).
    const fields: Record<string, string> = {
      MerchantID: this.cfg.merchantId,
      TradeInfo: tradeInfo,
      TradeSha: tradeSha,
      Version: "2.0",
    };

    return {
      endpoint: this.cfg.endpoint,
      fields,
    };
  }

  /**
   * Parse + verify an incoming callback POST body.
   *
   * NewebPay's NotifyURL callback POSTs application/x-www-form-
   * urlencoded with the SAME 4-field shape we sent out
   * (`MerchantID`, `TradeInfo`, `TradeSha`, `Status`, `Version`)
   * plus an outer `Status` field. The encrypted `TradeInfo` carries
   * the actual transaction result.
   *
   * Verification order (each step's failure short-circuits):
   *   1. Parse form-urlencoded body.
   *   2. Recompute TradeSha; mismatch → `invalid-signature`.
   *   3. AES-decrypt TradeInfo; failure → `decrypt-failed`.
   *   4. URL-decode the inner body; missing required fields →
   *      `missing-fields`.
   *   5. Construct VerifiedOrderResult; outer Status === 'SUCCESS'
   *      (inner RespondCode === '00' for credit) marks paid.
   *
   * Headers param is unused today but kept on the interface for
   * future-proofing (if NewebPay starts using header metadata).
   */
  verifyCallback(rawBody: string, _headers: Headers): CallbackResult {
    // Step 1: parse the outer form-urlencoded body.
    let outer: URLSearchParams;
    try {
      outer = new URLSearchParams(rawBody);
    } catch {
      return { ok: false, reason: "unknown-format", detail: "could not parse form body" };
    }

    const receivedTradeInfo = outer.get("TradeInfo");
    const receivedTradeSha = outer.get("TradeSha");
    const outerStatus = outer.get("Status"); // 'SUCCESS' on the happy path

    if (!receivedTradeInfo || !receivedTradeSha) {
      return {
        ok: false,
        reason: "unknown-format",
        detail: "missing TradeInfo or TradeSha in outer body",
      };
    }

    // Step 2: recompute TradeSha; reject mismatch.
    const expectedSha = buildTradeSha(receivedTradeInfo, this.cfg.hashKey, this.cfg.hashIV);
    if (!constantTimeEqualHex(expectedSha, receivedTradeSha)) {
      return {
        ok: false,
        reason: "invalid-signature",
        detail: "TradeSha mismatch",
      };
    }

    // Step 3: AES-decrypt TradeInfo.
    const plaintext = aesDecrypt(receivedTradeInfo, this.cfg.hashKey, this.cfg.hashIV);
    if (plaintext === null) {
      return {
        ok: false,
        reason: "decrypt-failed",
        detail: "AES-CBC decrypt or PKCS7 unpad failed (likely HashKey/HashIV mismatch)",
      };
    }

    // Step 4: parse the inner body. For RespondType=String, the
    // plaintext is application/x-www-form-urlencoded, with the
    // result fields living under a top-level `Result` key whose
    // VALUE is itself a URL-encoded sub-form. NewebPay also exposes
    // the same fields at the top level of the plaintext for some
    // accounts/versions, so we try BOTH unwrap strategies.
    let inner: URLSearchParams;
    try {
      inner = new URLSearchParams(plaintext);
    } catch {
      return {
        ok: false,
        reason: "unknown-format",
        detail: "could not parse decrypted plaintext as form-urlencoded",
      };
    }

    // Prefer Result sub-form if present (RespondType=String shape).
    let result: URLSearchParams = inner;
    const resultBlob = inner.get("Result");
    if (resultBlob) {
      try {
        result = new URLSearchParams(resultBlob);
      } catch {
        // fall back to inner if Result is malformed
      }
    }

    const merchantOrderId = result.get("MerchantOrderNo");
    const providerTradeNo = result.get("TradeNo") ?? "";
    const amtRaw = result.get("Amt");
    const paymentMethod = result.get("PaymentType") ?? "";

    if (!merchantOrderId || amtRaw === null) {
      return {
        ok: false,
        reason: "missing-fields",
        detail: `decrypted body missing required fields (MerchantOrderNo=${!!merchantOrderId}, Amt=${amtRaw !== null})`,
      };
    }

    const amountTwd = Number.parseInt(amtRaw, 10);
    if (!Number.isFinite(amountTwd)) {
      return {
        ok: false,
        reason: "missing-fields",
        detail: `Amt is not a finite integer: ${amtRaw}`,
      };
    }

    // Step 5: build the verified result. Status determination —
    //
    //   - For CREDIT/APPLEPAY: outer Status === 'SUCCESS' means
    //     payment captured.
    //   - For VACC (ATM) / CVS: outer Status === 'SUCCESS' at the
    //     FIRST callback means a code was issued — actual payment
    //     lands later via a SECOND NotifyURL hit with the same
    //     MerchantOrderNo. The consuming route is responsible for
    //     interpreting "code issued vs paid" — we just report
    //     `paymentStatus: 'success'` when NewebPay says SUCCESS
    //     and leave the semantic call to the caller (which has
    //     DB context to know whether this is the first or second
    //     callback for this order).
    //
    // RespondCode === '00' is the credit-card-specific success
    // signal nested inside Result; we surface it via rawFields for
    // observability but don't gate on it (would falsely fail
    // non-credit channels).
    const isSuccess = (outerStatus ?? "").toUpperCase() === "SUCCESS";

    // Flatten Result into rawFields for `applications.payment_meta`
    // JSONB persistence (audit trail). Convert URLSearchParams ->
    // plain object; numeric Amt comes through as the original string
    // (consuming route can cross-check against amountTwd).
    const rawFields: Record<string, string | number | boolean> = {};
    for (const [k, v] of result.entries()) {
      rawFields[k] = v;
    }
    // Also include outer fields that aren't in Result (Status itself,
    // MerchantID echo) — useful for forensics.
    for (const k of ["Status", "MerchantID", "Version", "MessageType"]) {
      const v = outer.get(k);
      if (v !== null && !(k in rawFields)) {
        rawFields[k] = v;
      }
    }

    const orderResult: VerifiedOrderResult = {
      merchantOrderId,
      providerTradeNo,
      amountTwd,
      paymentStatus: isSuccess ? "success" : "failed",
      paymentMethod,
      rawFields,
    };

    return { ok: true, orderResult };
  }

  /**
   * Format the ack body. NewebPay tolerates any HTTP 200 response
   * (unlike ECPay's strict `"1|OK"` requirement). We return the
   * same `"1|OK"` / `"0|<detail>"` strings for cross-provider
   * symmetry — the consuming callback route can use the same
   * `formatAck` call regardless of which adapter is active.
   *
   * Don't change the body strings without also auditing every
   * callback route that does response-text assertions in tests.
   */
  formatAck(verdict: "ok" | "reject", detail?: string): Ack {
    if (verdict === "ok") {
      return { body: "1|OK", contentType: "text/plain; charset=utf-8" };
    }
    const reason = (detail ?? "Rejected").replace(/\|/g, "/"); // pipe is the delimiter
    return { body: `0|${reason}`, contentType: "text/plain; charset=utf-8" };
  }
}

// ---------------------------------------------------------------------------
// Factory + helpers
// ---------------------------------------------------------------------------

/**
 * Construct a NewebpayProvider with config resolved from env (or
 * the public sandbox fallback). Prefer this over `new
 * NewebpayProvider(...)` so the env-resolution + key-shape
 * validation lives in one place.
 *
 * Pass an explicit `cfg` to override for testing (e.g. a mocked
 * config with a captured-payload HashKey/HashIV for replaying
 * fixtures).
 */
export function createNewebpayProvider(cfg?: NewebpayConfig): NewebpayProvider {
  return new NewebpayProvider(cfg ?? getNewebpayConfig());
}

/**
 * Constant-time comparison of two hex strings. Used for TradeSha
 * verification to avoid timing oracles on signature checks.
 *
 * `crypto.timingSafeEqual` requires equal-length buffers; we
 * normalise both sides to uppercase (TradeSha is documented as
 * uppercase hex) and bail early on length mismatch BEFORE doing
 * the timing-safe compare — length comparison leaks no useful info
 * for fixed-output hashes like SHA256.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a.toUpperCase(), "utf8");
  const bufB = Buffer.from(b.toUpperCase(), "utf8");
  return crypto.timingSafeEqual(bufA, bufB);
}

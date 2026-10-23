/**
 * Resend Email Provider Adapter
 *
 * Implements the `EmailProviderAdapter` interface against the Resend REST API
 * using native `fetch` — no SDK. Sending is a single POST, and the `resend`
 * package pulls `svix` and `postal-mime` (webhook verification and inbound MIME
 * parsing) that nothing here calls, so every install carried megabytes of
 * unreachable code to make one HTTP request. Mirrors the SendLayer adapter,
 * which has always worked this way.
 *
 * @module services/email/providers/resend-provider
 * @since 1.0.0
 */

import { httpFailure, providerFailure, withEmailFailure } from "../../failure";
import type {
  ConnectionTestResult,
  EmailDomainStatus,
} from "../../provider-definition";
import {
  setupFromStatus,
  withSetupCategory,
  type EmailSetupCategory,
} from "../../setup-category";
import type { EmailProviderAdapter } from "../../types";
import { messageToAddresses } from "../recipients";

/** Resend's public API host, used when nothing overrides it. */
const RESEND_DEFAULT_BASE_URL = "https://api.resend.com";

/**
 * Where to send, honouring the same environment override the Resend SDK read.
 *
 * Deployments point `RESEND_BASE_URL` at a capture server for testing, or at a
 * controlled egress proxy where outbound traffic is the only route off the
 * network. Hardcoding the public host does not fail loudly in either case — the
 * request succeeds against the wrong endpoint — so the override has to survive
 * the move off the SDK.
 *
 * Read per call rather than at module load: the value is captured at import
 * time otherwise, which a test that sets the variable between cases cannot
 * change, and a serverless runtime may populate the environment after the
 * module graph is already warm.
 */
function resendEndpoint(): string {
  return resendUrl("/emails");
}

/** A path on the Resend API, at the same base the send uses. */
function resendUrl(path: string): string {
  const base = process.env.RESEND_BASE_URL?.trim() || RESEND_DEFAULT_BASE_URL;
  // Tolerate a trailing slash so `https://host/` and `https://host` agree.
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** The headers every read of the Resend API carries. */
function resendReadHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const userAgent = resendUserAgent();
  if (userAgent) headers["User-Agent"] = userAgent;
  return headers;
}

/**
 * The `User-Agent` the SDK sent, overridable by the same variable it used.
 * Some egress proxies filter on it, so it travels with the base URL rather
 * than being dropped as cosmetic.
 */
function resendUserAgent(): string | undefined {
  return process.env.RESEND_USER_AGENT?.trim() || undefined;
}

/**
 * Resend configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `ResendConfig` type minus the discriminant `provider` field.
 */
interface ResendProviderConfig {
  apiKey: string;
}

/**
 * The most `to` addresses Resend accepts on one message.
 *
 * Resend's send-email reference gives `to` a maximum of 50 and states no limit
 * for `cc` or `bcc`. Declared so a longer list is refused before the request
 * with the limit named, instead of failing at Resend.
 */
export const RESEND_MAX_TO = 50;

/**
 * Resend's named 409 reasons, which decide whether a retry can help where the
 * status alone cannot. A concurrent request with the same idempotency key is
 * still being processed, so a later retry can succeed; a key reused with a
 * different body never can.
 */
const RESEND_RETRYABLE_BY_NAME: Readonly<Record<string, boolean>> = {
  concurrent_idempotent_requests: true,
  invalid_idempotent_request: false,
};

/**
 * What a person setting Resend up should check, by the error name Resend
 * gives. A key Resend does not know, or one missing, is the credentials; an
 * unverified domain, or a test address outside a sandbox account's own, is
 * refused as a `validation_error` with 403, and a bad From as
 * `invalid_from_address`, both of which are the sender; the quota names are a
 * rate limit. A `validation_error` with another status says too little to
 * place, so it falls to the status.
 */
export function resendSetupCategory(
  status: number,
  name: string | undefined
): EmailSetupCategory {
  switch (name) {
    case "missing_api_key":
    case "invalid_api_key":
    case "restricted_api_key":
      return "credentials";
    case "invalid_from_address":
      return "sender";
    case "validation_error":
      return status === 403 ? "sender" : setupFromStatus(status);
    case "rate_limit_exceeded":
    case "daily_quota_exceeded":
    case "monthly_quota_exceeded":
      return "rate-limited";
    default:
      return status === 403 ? "credentials" : setupFromStatus(status);
  }
}

/**
 * Error body Resend returns for a rejected send. Every field is optional
 * because an error response is the one shape a caller cannot assume: a gateway
 * or proxy failure yields a status without this envelope at all.
 */
interface ResendErrorBody {
  statusCode?: number;
  name?: string;
  message?: string;
}

/**
 * Create a Resend email provider adapter.
 *
 * @param config - Decrypted Resend configuration from the email provider record
 * @returns An `EmailProviderAdapter` that sends emails via the Resend REST API
 *
 * @example
 * ```typescript
 * const adapter = createResendProvider({
 *   apiKey: 're_xxxxxxxxxxxx',
 * });
 *
 * await adapter.send({
 *   to: 'recipient@example.com',
 *   from: 'App <noreply@example.com>',
 *   subject: 'Hello',
 *   html: '<p>Hello World</p>',
 * });
 * ```
 */
export function createResendProvider(
  config: ResendProviderConfig
): EmailProviderAdapter {
  return {
    maxToPerMessage: RESEND_MAX_TO,
    acceptsIdempotencyKey: true,
    async send(options) {
      // Whether Resend answered at all: a throw before it did is a network
      // failure, and a throw after it a classified or unreadable answer.
      let answered = false;
      try {
        const response = await fetch(resendEndpoint(), {
          method: "POST",
          headers: resendSendHeaders(config.apiKey, options.idempotencyKey),
          body: JSON.stringify(resendSendBody(options)),
          // Stops the request at the call deadline.
          ...(options.signal ? { signal: options.signal } : {}),
        });
        answered = true;

        if (!response.ok) throw await resendRefusal(response);

        const data = (await response.json()) as { id?: string };

        return {
          success: true,
          messageId: data.id,
        };
      } catch (error) {
        throw providerFailure(
          { prefix: "Resend provider error", fallback: "Resend send failed" },
          error,
          answered
        );
      }
    },
  };
}

/** A non-empty list, or nothing. */
function nonEmpty<T>(list: T[] | undefined): list is T[] {
  return list !== undefined && list.length > 0;
}

/**
 * The message as Resend's API takes it. Built conditionally so unset fields
 * are absent from the JSON rather than present and null, which Resend rejects
 * for `reply_to`.
 */
function resendSendBody(
  options: Parameters<EmailProviderAdapter["send"]>[0]
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from: options.from,
    // The REST API takes a recipient LIST even for a single address; the
    // SDK accepted a bare string and wrapped it. `toList` carries every
    // `to` address when there is more than one.
    to: messageToAddresses(options),
    subject: options.subject,
    html: options.html,
  };

  if (options.text) {
    body.text = options.text;
  }

  // Wire name is snake_case; the SDK's `replyTo` was its own camelCase
  // surface, and sending that key here would silently drop the header.
  if (options.replyTo) {
    body.reply_to = options.replyTo;
  }

  if (nonEmpty(options.cc)) {
    body.cc = options.cc;
  }

  if (nonEmpty(options.bcc)) {
    body.bcc = options.bcc;
  }

  if (nonEmpty(options.attachments)) {
    body.attachments = options.attachments.map(a => ({
      filename: a.filename,
      // Base64, not the Buffer itself: JSON.stringify turns a Buffer into
      // `{"type":"Buffer","data":[...]}`, which is not what the API reads.
      content: a.content.toString("base64"),
      content_type: a.mimeType,
    }));
  }

  return body;
}

function resendSendHeaders(
  apiKey: string,
  idempotencyKey: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const userAgent = resendUserAgent();
  if (userAgent) headers["User-Agent"] = userAgent;
  // Resend sends a message once per key for 24 hours.
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return headers;
}

/**
 * Resend's refusal, classified for the send and for the person at the setup.
 * Resend's own message is preferred; the status line stands in when the body
 * is absent or not JSON (a proxy or gateway failure).
 */
async function resendRefusal(response: Response): Promise<Error> {
  let detail = response.statusText;
  let name: string | undefined;
  try {
    const errorBody = (await response.json()) as ResendErrorBody;
    if (errorBody.message) detail = errorBody.message;
    if (typeof errorBody.name === "string") name = errorBody.name;
  } catch {
    // Body was not JSON — the status line is all there is to report.
  }
  return withSetupCategory(
    withEmailFailure(
      new Error(`HTTP ${response.status}: ${detail}`),
      httpFailure(response.status, name, RESEND_RETRYABLE_BY_NAME)
    ),
    resendSetupCategory(response.status, name)
  );
}

/**
 * How long a read of the account may take. The provider's page and the check
 * before a save wait on these reads, so a Resend that stalls is given up on,
 * and read as unreachable, rather than holding the page for minutes.
 */
const RESEND_READ_TIMEOUT_MS = 10_000;

function resendRead(
  path: string,
  headers: Record<string, string>
): Promise<Response> {
  return fetch(resendUrl(path), {
    headers,
    signal: AbortSignal.timeout(RESEND_READ_TIMEOUT_MS),
  });
}

/**
 * Check a Resend key without sending: read the account's domains.
 *
 * A key restricted to sending is a working key that may not read domains, and
 * Resend says so by name; it is reported as working, since sending is all the
 * provider needs it for. Any other refusal is the key itself.
 */
export async function verifyResendKey(config: {
  apiKey: string;
}): Promise<ConnectionTestResult> {
  let response: Response;
  try {
    response = await resendRead("/domains", resendReadHeaders(config.apiKey));
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Resend unreachable",
      setup: "connect",
    };
  }
  if (response.ok) return { ok: true };
  let name: string | undefined;
  let detail = response.statusText;
  try {
    const body = (await response.json()) as ResendErrorBody;
    if (typeof body.name === "string") name = body.name;
    if (body.message) detail = body.message;
  } catch {
    // Not JSON: the status line is all there is.
  }
  if (name === "restricted_api_key") return { ok: true };
  return {
    ok: false,
    detail: `HTTP ${response.status}: ${detail}`,
    setup: resendSetupCategory(response.status, name),
  };
}

/**
 * The DNS records Resend expects for a domain, from its domain detail. An MX
 * record keeps its priority, which some DNS hosts ask for in a field of its
 * own.
 */
function resendRecords(body: unknown): EmailDomainStatus["records"] {
  const listed = (body as { records?: unknown } | null)?.records;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((record: Record<string, unknown>) =>
    typeof record.type === "string" &&
    typeof record.name === "string" &&
    typeof record.value === "string"
      ? [
          {
            type: record.type,
            name: record.name,
            value: record.value,
            ...(typeof record.priority === "number"
              ? { priority: record.priority }
              : {}),
          },
        ]
      : []
  );
}

/**
 * Resend's domain states, read as the three a person acts on. A partly failed
 * domain has a feature that did not verify, so it needs fixing, not waiting.
 */
function domainState(status: unknown): EmailDomainStatus["status"] {
  if (status === "verified") return "verified";
  if (
    status === "failed" ||
    status === "partially_failed" ||
    status === "temporary_failure"
  ) {
    return "failed";
  }
  return "pending";
}

/**
 * Whether Resend has verified `domain`, and the DNS records it expects. Null
 * when the account has no such domain, or the key may not read domains.
 */
export async function resendDomainStatus(
  config: { apiKey: string },
  domain: string
): Promise<EmailDomainStatus | null> {
  const headers = resendReadHeaders(config.apiKey);
  const list = await resendRead("/domains", headers);
  if (!list.ok) return null;
  const { data } = (await list.json()) as {
    data?: Array<{ id?: unknown; name?: unknown; status?: unknown }>;
  };
  const found = (data ?? []).find(
    entry =>
      typeof entry.name === "string" &&
      entry.name.toLowerCase() === domain.toLowerCase()
  );
  if (!found || typeof found.id !== "string") return null;
  const detail = await resendRead(
    `/domains/${encodeURIComponent(found.id)}`,
    headers
  );
  // Without the records a pending domain can't be set up, so a status that
  // lacks them is reported as unavailable rather than as complete.
  if (!detail.ok) return null;
  const records = resendRecords(await detail.json());
  return {
    domain: found.name as string,
    status: domainState(found.status),
    records,
  };
}

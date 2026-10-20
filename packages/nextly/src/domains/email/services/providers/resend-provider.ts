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
  const base = process.env.RESEND_BASE_URL?.trim() || RESEND_DEFAULT_BASE_URL;
  // Tolerate a trailing slash so `https://host/` and `https://host` agree.
  return `${base.replace(/\/+$/, "")}/emails`;
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
    async send(options) {
      // Built conditionally so unset fields are absent from the JSON rather
      // than present and null, which Resend rejects for `reply_to`.
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

      if (options.cc && options.cc.length > 0) {
        body.cc = options.cc;
      }

      if (options.bcc && options.bcc.length > 0) {
        body.bcc = options.bcc;
      }

      if (options.attachments && options.attachments.length > 0) {
        body.attachments = options.attachments.map(a => ({
          filename: a.filename,
          // Base64, not the Buffer itself: JSON.stringify turns a Buffer into
          // `{"type":"Buffer","data":[...]}`, which is not what the API reads.
          content: a.content.toString("base64"),
          content_type: a.mimeType,
        }));
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      };
      const userAgent = resendUserAgent();
      if (userAgent) headers["User-Agent"] = userAgent;

      // Whether Resend answered at all: a throw before it did is a network
      // failure, and a throw after it a classified or unreadable answer.
      let answered = false;
      try {
        const response = await fetch(resendEndpoint(), {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        answered = true;

        if (!response.ok) {
          // Prefer Resend's own message; fall back to the status line when the
          // body is absent or not JSON (a proxy or gateway failure).
          let detail = response.statusText;
          let name: string | undefined;
          try {
            const errorBody = (await response.json()) as ResendErrorBody;
            if (errorBody.message) detail = errorBody.message;
            if (typeof errorBody.name === "string") name = errorBody.name;
          } catch {
            // Body was not JSON — the status line is all there is to report.
          }
          throw withEmailFailure(
            new Error(`HTTP ${response.status}: ${detail}`),
            httpFailure(response.status, name, RESEND_RETRYABLE_BY_NAME)
          );
        }

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

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

import type { EmailProviderAdapter } from "../../types";

/** Resend's send endpoint. */
const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Resend configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `ResendConfig` type minus the discriminant `provider` field.
 */
interface ResendProviderConfig {
  apiKey: string;
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
    async send(options) {
      // Built conditionally so unset fields are absent from the JSON rather
      // than present and null, which Resend rejects for `reply_to`.
      const body: Record<string, unknown> = {
        from: options.from,
        // The REST API takes a recipient LIST even for a single address; the
        // SDK accepted a bare string and wrapped it.
        to: [options.to],
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

      try {
        const response = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          // Prefer Resend's own message; fall back to the status line when the
          // body is absent or not JSON (a proxy or gateway failure).
          let detail = response.statusText;
          try {
            const errorBody = (await response.json()) as ResendErrorBody;
            if (errorBody.message) detail = errorBody.message;
          } catch {
            // Body was not JSON — the status line is all there is to report.
          }
          throw new Error(`HTTP ${response.status}: ${detail}`);
        }

        const data = (await response.json()) as { id?: string };

        return {
          success: true,
          messageId: data.id,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Resend send failed";
        throw new Error(`Resend provider error: ${message}`);
      }
    },
  };
}

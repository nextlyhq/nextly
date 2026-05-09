/**
 * SendLayer Email Provider Adapter
 *
 * Implements the `EmailProviderAdapter` interface using the SendLayer REST API.
 * Each `send()` call makes a POST request to the SendLayer API — no SDK needed,
 * uses native `fetch`. Serverless-friendly.
 *
 * @module services/email/providers/sendlayer-provider
 * @since 1.0.0
 */

import type { EmailProviderAdapter } from "../../types";

/** SendLayer API base URL. */
const SENDLAYER_API_URL = "https://console.sendlayer.com/api/v1/email";

/**
 * SendLayer configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `SendLayerConfig` type minus the discriminant `provider` field.
 */
interface SendLayerProviderConfig {
  apiKey: string;
}

/**
 * Parse a "from" address string into name and email parts.
 *
 * Handles formats:
 * - `"App Name <noreply@example.com>"` → `{ name: "App Name", email: "noreply@example.com" }`
 * - `"noreply@example.com"` → `{ name: "", email: "noreply@example.com" }`
 */
function parseFromAddress(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: "", email: from.trim() };
}

/**
 * Create a SendLayer email provider adapter.
 *
 * @param config - Decrypted SendLayer configuration from the email provider record
 * @returns An `EmailProviderAdapter` that sends emails via SendLayer REST API
 *
 * @example
 * ```typescript
 * const adapter = createSendLayerProvider({
 *   apiKey: 'your-sendlayer-api-key',
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
export function createSendLayerProvider(
  config: SendLayerProviderConfig
): EmailProviderAdapter {
  return {
    async send(options) {
      const from = parseFromAddress(options.from);

      const body: Record<string, unknown> = {
        From: from,
        To: [{ name: "", email: options.to }],
        Subject: options.subject,
        ContentType: "HTML",
        HTMLContent: options.html,
      };

      if (options.cc && options.cc.length > 0) {
        body.CC = options.cc.map(email => ({ name: "", email }));
      }

      if (options.bcc && options.bcc.length > 0) {
        body.BCC = options.bcc.map(email => ({ name: "", email }));
      }

      if (options.attachments && options.attachments.length > 0) {
        body.Attachments = options.attachments.map((a) => ({
          Name: a.filename,
          Content: a.content.toString("base64"),
          Type: a.mimeType,
        }));
      }

      try {
        const response = await fetch(SENDLAYER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `HTTP ${response.status}: ${errorBody || response.statusText}`
          );
        }

        const data = (await response.json()) as { MessageID?: string };

        return {
          success: true,
          messageId: data.MessageID,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "SendLayer send failed";
        throw new Error(`SendLayer provider error: ${message}`);
      }
    },
  };
}

/**
 * Resend Email Provider Adapter
 *
 * Implements the `EmailProviderAdapter` interface using the Resend SDK.
 * The Resend client is created once in the factory closure and reused
 * across `send()` calls — no persistent connections, serverless-friendly.
 *
 * @module services/email/providers/resend-provider
 * @since 1.0.0
 */

import { Resend } from "resend";

import type { EmailProviderAdapter } from "../../types";

/**
 * Resend configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `ResendConfig` type minus the discriminant `provider` field.
 */
interface ResendProviderConfig {
  apiKey: string;
}

/**
 * Create a Resend email provider adapter.
 *
 * @param config - Decrypted Resend configuration from the email provider record
 * @returns An `EmailProviderAdapter` that sends emails via Resend
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
  const client = new Resend(config.apiKey);

  return {
    async send(options) {
      try {
        const { data, error } = await client.emails.send({
          from: options.from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          cc: options.cc,
          bcc: options.bcc,
          attachments: options.attachments?.map((a) => ({
            filename: a.filename,
            // Resend SDK accepts Buffer directly (Node) or base64 string.
            content: a.content,
            contentType: a.mimeType,
          })),
        });

        if (error) {
          throw new Error(error.message);
        }

        return {
          success: true,
          messageId: data?.id,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Resend send failed";
        throw new Error(`Resend provider error: ${message}`);
      }
    },
  };
}

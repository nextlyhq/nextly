/**
 * SMTP Email Provider Adapter
 *
 * Implements the `EmailProviderAdapter` interface using nodemailer.
 * Each `send()` call creates a fresh SMTP transport from the provided
 * configuration — no persistent connections, serverless-friendly.
 *
 * @module services/email/providers/smtp-provider
 * @since 1.0.0
 */

import nodemailer from "nodemailer";

import type { EmailProviderAdapter } from "../../types";

/**
 * SMTP configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `SmtpConfig` type minus the discriminant `provider` field.
 */
interface SmtpProviderConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Create an SMTP email provider adapter.
 *
 * @param config - Decrypted SMTP configuration from the email provider record
 * @returns An `EmailProviderAdapter` that sends emails via SMTP
 *
 * @example
 * ```typescript
 * const adapter = createSmtpProvider({
 *   host: 'smtp.gmail.com',
 *   port: 587,
 *   secure: false,
 *   auth: { user: 'user@gmail.com', pass: 'app-password' },
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
export function createSmtpProvider(
  config: SmtpProviderConfig
): EmailProviderAdapter {
  // Audit H7 (T-007): default `secure` to true. Reject obviously
  // insecure setups at construction time so misconfiguration fails
  // loudly rather than silently sending plaintext credentials over
  // the network. STARTTLS on port 587 is allowed via secure: false
  // (nodemailer upgrades implicitly when requireTLS is set, but the
  // common pattern in the wild is to leave secure: false on 587).
  const secure = config.secure ?? true;
  const isLocalhost =
    config.host === "localhost" ||
    config.host === "127.0.0.1" ||
    config.host === "::1";
  if (!secure && !isLocalhost && config.port !== 587) {
    throw new Error(
      `[nextly/email/smtp] Refusing to use plaintext SMTP to remote host ` +
        `${config.host}:${config.port}. Set secure: true (port 465) or use ` +
        `port 587 (STARTTLS), or set host to localhost for plaintext-on-loopback ` +
        `setups. See docs/email/smtp.md.`
    );
  }
  return {
    async send(options) {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure,
        auth: {
          user: config.auth.user,
          pass: config.auth.pass,
        },
      });

      try {
        const info = await transport.sendMail({
          from: options.from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          cc: options.cc,
          bcc: options.bcc,
          attachments: options.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.mimeType,
          })),
        });

        return {
          success: true,
          messageId: info.messageId,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "SMTP send failed";
        throw new Error(`SMTP provider error: ${message}`);
      }
    },
  };
}

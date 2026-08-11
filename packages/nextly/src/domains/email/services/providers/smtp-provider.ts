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
export interface SmtpProviderConfig {
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
/**
 * Refuse a configuration that would put credentials on the wire unprotected.
 *
 * Shared by every path that opens a transport. A connection probe authenticates
 * exactly as a send does, so a probe with its own transport construction would
 * happily hand credentials to a plaintext remote host the send path refuses —
 * and then report success, which is worse than failing.
 *
 * Returns the resolved `secure` value so callers cannot re-derive it differently.
 */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertTransportIsSafe(config: SmtpProviderConfig): boolean {
  // Default `secure` to true. Reject obviously insecure setups at construction
  // time so misconfiguration fails loudly rather than silently sending
  // plaintext credentials over the network. STARTTLS on port 587 is allowed via
  // secure: false (nodemailer upgrades implicitly when requireTLS is set, but
  // the common pattern in the wild is to leave secure: false on 587).
  const secure = config.secure ?? true;
  if (!secure && !isLoopbackHost(config.host) && config.port !== 587) {
    throw new Error(
      `[nextly/email/smtp] Refusing to use plaintext SMTP to remote host ` +
        `${config.host}:${config.port}. Set secure: true (port 465) or use ` +
        `port 587 (STARTTLS), or set host to localhost for plaintext-on-loopback ` +
        `setups. See docs/email/smtp.md.`
    );
  }
  return secure;
}

/**
 * The transport options every SMTP connection uses.
 *
 * Shared so a send and a probe cannot disagree about what they will trust.
 * `requireTLS` is the part that matters: on port 587 with `secure: false`,
 * nodemailer upgrades ONLY if the server advertises STARTTLS, and otherwise
 * proceeds to authenticate in the clear -- so a misconfigured or intercepted
 * server could collect the username and password. Forcing it makes the
 * connection fail instead, which is the correct outcome for a link that cannot
 * be secured. Implicit TLS (`secure: true`, port 465) needs no upgrade and is
 * unaffected.
 */
function smtpTransportOptions(config: SmtpProviderConfig) {
  const secure = assertTransportIsSafe(config);
  return {
    host: config.host,
    port: config.port,
    secure,
    // Forced only for the remote plaintext case the guard permits -- port 587,
    // which starts in the clear and upgrades. NOT for loopback: a local Mailpit
    // or MailHog sink speaks plaintext by design and offers no STARTTLS, so
    // requiring one there fails a configuration the guard deliberately allows
    // and that this repository ships in its own docker-compose.
    requireTLS: !secure && !isLoopbackHost(config.host),
    // Omitted entirely when empty rather than sent blank: nodemailer attempts
    // an AUTH exchange whenever the key is present, and a local sink that wants
    // no credentials should not be asked to negotiate them.
    ...(config.auth.user === "" && config.auth.pass === ""
      ? {}
      : { auth: { user: config.auth.user, pass: config.auth.pass } }),
  };
}

export function createSmtpProvider(
  config: SmtpProviderConfig
): EmailProviderAdapter {
  // Default `secure` to true. Reject obviously insecure setups at
  // construction time so misconfiguration fails loudly rather than
  // silently sending plaintext credentials over the network. STARTTLS on port 587 is allowed via secure: false
  // (nodemailer upgrades implicitly when requireTLS is set, but the
  // common pattern in the wild is to leave secure: false on 587).
  // Validate at construction so a bad configuration fails when it is created,
  // not on the first send.
  assertTransportIsSafe(config);

  return {
    async send(options) {
      const transport = nodemailer.createTransport(
        smtpTransportOptions(config)
      );

      try {
        const info = await transport.sendMail({
          from: options.from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
          replyTo: options.replyTo,
          cc: options.cc,
          bcc: options.bcc,
          attachments: options.attachments?.map(a => ({
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

/**
 * Open an SMTP session and authenticate, without sending anything.
 *
 * SMTP is the one built-in protocol where a real connection test exists: the
 * server can be reached, the TLS handshake completed and the credentials
 * checked, all before any message is composed. The REST providers have no
 * equivalent — short of sending, there is nothing to ask them — which is why
 * only this definition advertises `capabilities.connectionTest`.
 *
 * Reuses the same transport options as `send`, so a probe that passes is
 * evidence about the configuration that will actually be used.
 */
export async function verifySmtpConnection(
  config: SmtpProviderConfig
): Promise<{ ok: boolean; detail?: string }> {
  // Identical options to the send path, including requireTLS: a probe
  // authenticates too, so it must not trust anything a send would not.
  const transport = nodemailer.createTransport(smtpTransportOptions(config));

  try {
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Connection failed",
    };
  } finally {
    // Close the pool the probe opened; leaving it holds a socket for the
    // lifetime of the process in a long-running server.
    transport.close();
  }
}

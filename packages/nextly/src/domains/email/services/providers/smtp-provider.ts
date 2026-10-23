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

import {
  type EmailFailure,
  failureOf,
  lostAnswerFailure,
  networkFailure,
  smtpFailure,
  unclassifiedFailure,
  withEmailFailure,
} from "../../failure";
import {
  setupFromStatus,
  withSetupCategory,
  type EmailSetupCategory,
} from "../../setup-category";
import type { EmailProviderAdapter } from "../../types";

import { loadNodemailer } from "./nodemailer-loader";

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

/**
 * The address out of whatever nodemailer reports as a rejected recipient.
 *
 * It returns either a plain string or an envelope-style object depending on
 * how the message was addressed, so the shape is narrowed rather than assumed.
 */
function addressOf(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry !== null && typeof entry === "object" && "address" in entry) {
    const address = (entry as { address?: unknown }).address;
    if (typeof address === "string") return address;
  }
  return "";
}

/**
 * The most `to` addresses sent in one SMTP message.
 *
 * SMTP itself sets no maximum, and servers set their own. RFC 5321 section
 * 4.5.3.1.8 requires every server to accept at least 100 recipients for one
 * message, so 100 is the number any server takes. Declared so a longer list is
 * refused before the session with the limit named, rather than refused part
 * way through by whichever server is configured.
 */
export const SMTP_MAX_TO = 100;

/** Nodemailer's codes for a connection that failed or never answered. */
const SMTP_NETWORK_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ECONNREFUSED",
  "ECONNRESET",
]);

/**
 * The classification of a nodemailer error: by its SMTP reply code when the
 * server gave one, as a network failure when the connection failed, and
 * otherwise as unclassified.
 */
function smtpErrorFailure(error: unknown): EmailFailure {
  const { responseCode, code, command } = (error ?? {}) as {
    responseCode?: unknown;
    code?: unknown;
    command?: unknown;
  };
  if (typeof responseCode === "number") return smtpFailure(responseCode);
  if (typeof code === "string" && SMTP_NETWORK_CODES.has(code)) {
    // Lost during DATA, the message may already be with the server, which
    // had yet to answer: unknown. Before it, nothing was sent.
    return command === "DATA" ? lostAnswerFailure() : networkFailure();
  }
  return unclassifiedFailure();
}

/**
 * What a person setting SMTP up should check, from a nodemailer error.
 *
 * Nodemailer names the command the server refused, which says more than the
 * reply code: a refused AUTH is the credentials, a refused MAIL FROM the
 * sender, a refused RCPT TO the recipient. A connection that failed could not
 * be reached; anything else is read from the reply code.
 */
export function smtpSetupCategory(error: unknown): EmailSetupCategory {
  const { responseCode, code, command } = (error ?? {}) as {
    responseCode?: unknown;
    code?: unknown;
    command?: unknown;
  };
  if (code === "EAUTH") return "credentials";
  if (typeof code === "string" && SMTP_NETWORK_CODES.has(code)) {
    return "connect";
  }
  if (typeof command === "string") {
    const verb = command.toUpperCase();
    if (verb.startsWith("AUTH")) return "credentials";
    if (verb.startsWith("MAIL FROM")) return "sender";
    if (verb.startsWith("RCPT TO")) return "recipient";
  }
  return setupFromStatus(
    typeof responseCode === "number" ? responseCode : undefined
  );
}

/**
 * Each refused recipient nodemailer reports, with what its reply code says.
 */
function refusalsOf(
  rejectedErrors: unknown[] | undefined
): Array<{ address: string } & EmailFailure> | undefined {
  if (!rejectedErrors?.length) return undefined;
  const refusals = rejectedErrors.flatMap(entry => {
    const address = addressOf((entry as { recipient?: unknown })?.recipient);
    return address ? [{ address, ...smtpErrorFailure(entry) }] : [];
  });
  return refusals.length > 0 ? refusals : undefined;
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
    maxToPerMessage: SMTP_MAX_TO,
    async send(options) {
      // Loaded per send rather than held at module scope: this is the optional
      // peer, and a module-level handle would have to resolve at import time,
      // which is exactly what an optional dependency cannot promise.
      const nodemailer = await loadNodemailer();
      const transport = nodemailer.createTransport(
        smtpTransportOptions(config)
      );

      try {
        const info = await transport.sendMail({
          from: options.from,
          // Every `to` address when there is more than one, else the one.
          to: options.toList ?? options.to,
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

        const refusals = refusalsOf(info.rejectedErrors);
        return {
          success: true,
          messageId: info.messageId,
          // Nodemailer reports `RCPT TO` outcomes per address. Discarding them
          // would let a partially refused send be recorded as delivered to
          // everyone it was addressed to.
          rejected: info.rejected?.map(addressOf).filter(Boolean),
          // And what each refusal's reply code says about trying again.
          ...(refusals ? { refusals } : {}),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "SMTP send failed";
        throw withSetupCategory(
          withEmailFailure(
            new Error(`SMTP provider error: ${message}`),
            failureOf(error) ?? smtpErrorFailure(error)
          ),
          smtpSetupCategory(error)
        );
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
): Promise<{ ok: boolean; detail?: string; setup?: EmailSetupCategory }> {
  // Loading sits inside its own try, unlike the send path: this function
  // reports a verdict rather than throwing, and a missing library is a probe
  // failure the admin renders like any other. Letting it escape would surface
  // as an unhandled error where a readable instruction belongs.
  let nodemailer: Awaited<ReturnType<typeof loadNodemailer>>;
  try {
    nodemailer = await loadNodemailer();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Connection failed",
    };
  }

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
      setup: smtpSetupCategory(error),
    };
  } finally {
    // Close the pool the probe opened; leaving it holds a socket for the
    // lifetime of the process in a long-running server.
    transport.close();
  }
}

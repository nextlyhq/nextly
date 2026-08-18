/**
 * The transport an install uses before it has configured a real one.
 *
 * A fresh install used to fail its first send with a 422, which lands on the
 * password-reset flow -- the first thing a new user reaches after signing up.
 * Writing the message to the log instead keeps that flow working with no
 * configuration at all.
 *
 * Mailpit remains the recommended local inbox and ships in this repository's
 * docker-compose; this is the zero-setup floor beneath it, not a replacement.
 *
 * @module domains/email/services/providers/log-provider
 */

import type { EmailProviderAdapter } from "../../types";

/** The registered type id for the fallback transport. */
export const LOG_PROVIDER_TYPE = "log";

export interface LogProviderConfig {
  /**
   * Whether the rendered body is written alongside the envelope.
   *
   * Password-reset and verification bodies carry live tokens, so a production
   * install writing them would put credentials into whatever aggregates its
   * logs. The caller decides once, at construction, rather than this module
   * reading the environment per send: one decision point is testable by
   * building two adapters, and cannot drift between the log line and the
   * delivery record.
   */
  includeBody: boolean;
}

/**
 * Whether a given environment may see rendered bodies.
 *
 * Separated from the adapter so the rule is one testable function rather than
 * a condition buried at a construction site. Anything that is not explicitly
 * production is treated as a developer's machine, so an unset NODE_ENV shows
 * the body rather than hiding it.
 */
export function shouldIncludeBody(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}

/**
 * A message id that is recognisable as not having left the process.
 *
 * Kept inside the 24 characters the delivery log accepts for an opaque token:
 * a longer id is refused as unrecognised and dropped, so the send would report
 * no identifier at all. Both parts are base36 to buy that room -- the
 * timestamp orders ids within a run, and the suffix separates two sends landing
 * in the same millisecond.
 */
function logMessageId(): string {
  const stamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `log-${stamp}-${suffix}`;
}

/**
 * Build the fallback adapter.
 *
 * Returns success because the message did reach its configured destination,
 * which is the log. Reporting failure would make the auth flows treat a
 * working development install as broken.
 */
export function createLogProvider(
  config: LogProviderConfig
): EmailProviderAdapter {
  return {
    // Not `async`: writing a log line involves no waiting, and the adapter
    // contract asks only for a promise. Marking it async would claim work that
    // never happens and read as though delivery were being awaited.
    send(options) {
      const envelope = {
        provider: LOG_PROVIDER_TYPE,
        to: options.to,
        from: options.from,
        subject: options.subject,
        ...(options.cc ? { cc: options.cc } : {}),
        ...(options.bcc ? { bcc: options.bcc } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      };

      if (config.includeBody) {
        console.info(
          "[nextly/email] no provider configured, message written to the log:",
          JSON.stringify(envelope, null, 2),
          `\n${options.html}`
        );
      } else {
        console.info(
          "[nextly/email] no provider configured, message written to the log:",
          JSON.stringify(envelope)
        );
      }

      return Promise.resolve({ success: true, messageId: logMessageId() });
    },
  };
}

/**
 * What the provider setup says when a check or a test send fails, by what to
 * check, and what it says when one is accepted.
 *
 * @module components/features/email-hub/sending/setup-copy
 */

import type { EmailSetupCategory } from "@admin/services/emailProviderApi";

/** A failure explained: what happened, and what to check. */
export interface SetupExplanation {
  title: string;
  check: string;
}

/**
 * Explain a failed check or test send.
 *
 * @param provider - the provider's label, such as "Resend"
 * @param context - the addresses involved, where the sentence names them
 */
export function explainSetupFailure(
  setup: EmailSetupCategory | undefined,
  provider: string,
  context: { from?: string; to?: string } = {}
): SetupExplanation {
  switch (setup) {
    case "credentials":
      return {
        title: `${provider} refused the sign-in.`,
        check:
          "Check the API key, or the username and password. Google Workspace and Microsoft 365 need an app password, not your usual one.",
      };
    case "sender":
      return {
        title: context.from
          ? `${provider} won't send from ${context.from}.`
          : `${provider} won't send from this address.`,
        check: `Check that the From address uses a domain verified with ${provider}.`,
      };
    case "recipient":
      return {
        title: context.to
          ? `${provider} refused ${context.to}.`
          : `${provider} refused the address.`,
        check:
          "A test goes to your own address. Check it on your account, and whether the provider is blocking it, such as after an earlier bounce.",
      };
    case "rate-limited":
      return {
        title: `${provider} is limiting how much is sent right now.`,
        check: "Wait a minute, then send again.",
      };
    case "connect":
      return {
        title: `Nextly couldn't reach ${provider}.`,
        check:
          "Check the host and port, and that this server can reach the internet.",
      };
    default:
      return {
        title: `${provider} didn't accept the test.`,
        check: "The reason is in the server log.",
      };
  }
}

/**
 * What an accepted test send says. Accepted, not delivered: the provider took
 * the email, and only the inbox can say it arrived.
 */
export function acceptedTest(provider: string, to: string): SetupExplanation {
  return {
    title: `${provider} accepted the test email.`,
    check: `Check ${to}; it can take a minute. Not there after a few minutes? Look in spam.`,
  };
}

/** What a test through the Log provider says: logged, never sent. */
export function loggedTest(): SetupExplanation {
  return {
    title: "The test email was logged, not sent.",
    check:
      "Log writes each email to the server log instead of delivering it. Look in the terminal where the site runs, or in your host's log viewer.",
  };
}

/** The Log provider's type: it delivers nothing. */
export const LOG_PROVIDER_TYPE = "log";

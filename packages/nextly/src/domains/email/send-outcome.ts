/**
 * What a send route tells its caller about the send it just made.
 *
 * One sentence for both send routes, so the raw and the template route cannot
 * describe the same outcome differently. A send is synchronous: when the route
 * answers, the provider has accepted the message or the send has failed.
 *
 * @module domains/email/send-outcome
 */

/** The message a send route answers with, for a send that did or did not succeed. */
export function sendOutcomeMessage(success: boolean): string {
  return success ? "Email sent." : "Email could not be sent.";
}

/**
 * How long a send waits on a provider, and how long its claim is held.
 *
 * - **Call deadline**: a provider call that has not answered by then is
 *   reported to the caller as without an answer (retryable), and the adapter
 *   is told to stop through the call's cancellation signal.
 * - **Lease limit**: a fixed multiple of the call deadline. While a call is
 *   still unsettled after its deadline, the claim's lease is renewed, so a
 *   later send with the key is told the send is in progress rather than
 *   sending it again. Past the limit renewal stops, the outcome is recorded as
 *   unknown, and a later send may take the claim over. For an adapter that
 *   ignores cancellation this can repeat the email; it never loses it.
 * - **Takeover period**: how long a claim's lease runs from its last renewal.
 *   A claim whose holder has stopped is taken over once it lapses.
 *
 * @module domains/email/send-timing
 */

/** A provider call answers within this, or is reported as without an answer. */
export const CALL_DEADLINE_MS = 2 * 60_000;

/** How long after a call starts its claim's lease is still renewed. */
export const LEASE_LIMIT_MS = 5 * CALL_DEADLINE_MS;

/** How often a held claim's lease is renewed while a call is unsettled. */
export const LEASE_RENEWAL_MS = 60_000;

/**
 * How long a claim's lease runs from its last renewal before a later send may
 * take it over: longer than the longest a built-in provider call can take.
 */
export const CLAIM_TAKEOVER_MS = 15 * 60_000;

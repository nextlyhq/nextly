/**
 * Passing a simple form's answers on, from the site's server to the form's
 * "Send to" address. The visitor's browser never posts there itself.
 *
 * Sent through core's `safeFetch`, the one outbound guard the rest of Nextly
 * sends through, rather than a second copy of it: `https` only, every address
 * the host resolves to vetted (private, loopback, link-local and the other
 * internal ranges refused) and the vetted one dialled, so a name answering
 * differently the second time cannot turn the send inward. Its redirects are
 * not followed: a redirect is a failed send, and nothing reaches the address
 * it names. The whole send, the lookup included, has ten seconds.
 *
 * The answers are never logged. What a failure says is the outcome and the
 * address's host, and nothing of the path, which can carry a key.
 *
 * @module forms/deliver
 */
import { ExternalUrlError, SafeFetchError, safeFetch } from "nextly";

import type { CheckedAnswer } from "./answers";

/** How long one send may take, from the lookup to the answer. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * The most of an answer's body read back. Nothing in it is used; a receiving
 * service answering with a large page is still a delivered send.
 */
const MOST_RESPONSE_BYTES = 64 * 1024;

/** What one send came to. */
export type Delivery =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * - `refused`: the address is not an `https` address of a public host;
       * - `redirected`: it answered with a redirect, which is not followed;
       * - `answered`: it answered with another status that is not success;
       * - `timed-out`: no answer within {@link DELIVERY_TIMEOUT_MS};
       * - `unreachable`: no connection, or the exchange broke off.
       */
      readonly reason:
        | "refused"
        | "redirected"
        | "answered"
        | "timed-out"
        | "unreachable";
      readonly status?: number;
    };

/** The statuses that redirect, as `fetch` itself reads them. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** How a send reaches the network: `safeFetch`'s own signature. */
export type DeliveryFetch = typeof safeFetch;

/** Send `answers` to `address` as a form post, and say how it went. */
export async function deliverAnswers(
  address: string,
  answers: readonly CheckedAnswer[],
  send: DeliveryFetch = safeFetch
): Promise<Delivery> {
  const body = new URLSearchParams();
  for (const answer of answers) {
    // A field left empty is still sent, empty, so the receiving end sees
    // every field the form asked.
    if (answer.values.length === 0) body.append(answer.name, "");
    for (const value of answer.values) body.append(answer.name, value);
  }
  try {
    const response = await send(address, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Nextly form relay",
      },
      body: body.toString(),
      timeoutMs: DELIVERY_TIMEOUT_MS,
      maxResponseBytes: MOST_RESPONSE_BYTES,
      allowedProtocols: ["https:"],
    });
    return outcomeOf(response.status);
  } catch (error) {
    return failureOf(error);
  }
}

/** A status as a send's outcome. */
function outcomeOf(status: number): Delivery {
  if (status >= 200 && status < 300) return { ok: true };
  if (REDIRECTS.has(status)) return { ok: false, reason: "redirected", status };
  return { ok: false, reason: "answered", status };
}

/** A thrown send as its outcome. */
function failureOf(error: unknown): Delivery {
  if (error instanceof ExternalUrlError)
    return { ok: false, reason: "refused" };
  if (error instanceof SafeFetchError) {
    if (error.reason === "timeout") return { ok: false, reason: "timed-out" };
    // The answer arrived with a status before its body ran long: judged by
    // the status, since the address did receive the answers.
    if (error.status !== undefined) return outcomeOf(error.status);
  }
  return { ok: false, reason: "unreachable" };
}

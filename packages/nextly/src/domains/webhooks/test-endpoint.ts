/**
 * Webhook endpoint connectivity probe ("test ping").
 *
 * Sends a synthetic, signed `webhook.ping` payload to an endpoint's URL and
 * reports the outcome, so an operator can verify — before or after wiring a
 * receiver — that the endpoint is reachable AND that their signature check
 * accepts Nextly's `webhook-signature` header. The probe is deliberately
 * out-of-band: it writes nothing to `nextly_events` or
 * `nextly_webhook_deliveries`, so a test never fans out, never enters the retry
 * queue, and never pollutes the real delivery log. Reuses the exact signing and
 * SSRF-safe transport the delivery engine uses.
 */
import { safeFetch } from "../../utils/validate-external-url";

import { DEFAULT_REQUEST_TIMEOUT_MS, type DeliverTransport } from "./deliver";
import { classifyResponse } from "./delivery-policy";
import { buildSignatureHeaders } from "./signing";

/** How much of the receiver's response body is retained for the operator. */
const RESPONSE_SNIPPET_LIMIT = 500;
/** Cap the response we read back, matching the delivery engine. */
const MAX_RESPONSE_BYTES = 64 * 1024;
// Wait the same as a real delivery, so a receiver that answers within the
// delivery window is never falsely reported unreachable by a test.
const TEST_REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

/**
 * The synthetic payload a test-ping delivers. Intentionally NOT a
 * `WebhookEvent`: a ping carries no content and is not a subscribable event
 * type, so it uses its own minimal, self-describing shape (mirrors GitHub's
 * distinct `ping` event) rather than widening the content-event catalog.
 */
export interface WebhookPingPayload {
  id: string;
  type: "webhook.ping";
  /** Event time, ISO-8601 (the signed `webhook-timestamp` header is unix seconds). */
  timestamp: string;
  webhookId: string;
  message: string;
}

/** The result of a connectivity probe, surfaced to the operator. */
export interface WebhookTestResult {
  /** True only for a 2xx response (per {@link classifyResponse}). */
  delivered: boolean;
  /** The HTTP status, when a response was received (absent if the request threw). */
  statusCode?: number;
  latencyMs: number;
  /** A short reason when not delivered: `http <status>` or the transport error. */
  error?: string;
  /** A truncated copy of the receiver's response body, when readable. */
  responseSnippet?: string;
}

export interface EndpointProbeInput {
  webhookId: string;
  url: string;
  /** The endpoint's stored custom headers (raw values, not the read-redaction). */
  headers?: Record<string, string> | null;
  /** Active plaintext signing secrets, primary first (one signature per secret). */
  secrets: readonly string[];
  /** A fresh id for this ping; doubles as the `webhook-id` header. */
  pingId: string;
  /** Injectable transport (defaults to the SSRF-safe {@link safeFetch}). */
  transport?: DeliverTransport;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Build, sign, and POST the ping, returning the outcome. Never throws for a
 * failed delivery — a connection refusal or an SSRF rejection is a valid,
 * reportable result, not an error. (The caller must ensure `secrets` is
 * non-empty; an unsigned delivery is meaningless and `buildSignatureHeaders`
 * rejects it.)
 */
export async function runEndpointProbe(
  input: EndpointProbeInput
): Promise<WebhookTestResult> {
  const transport = input.transport ?? safeFetch;
  const now = input.now ?? (() => new Date());
  const at = now();

  const payload: WebhookPingPayload = {
    id: input.pingId,
    type: "webhook.ping",
    timestamp: at.toISOString(),
    webhookId: input.webhookId,
    message:
      "Nextly webhook test event. If your receiver verifies this signature, " +
      "the endpoint is configured correctly.",
  };
  const body = JSON.stringify(payload);
  // Standard Webhooks signs over the unix-seconds timestamp, matching the
  // delivery engine, so a receiver's shared verifier accepts a test the same
  // way it accepts a real delivery.
  const timestampSeconds = Math.floor(at.getTime() / 1000).toString();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Custom headers first; the signature headers are applied LAST so a stored
    // header can never shadow the signature the receiver must verify.
    ...(input.headers ?? {}),
    ...buildSignatureHeaders({
      id: input.pingId,
      timestamp: timestampSeconds,
      body,
      secrets: input.secrets,
    }),
  };

  const sentAt = now().getTime();
  try {
    const response = await transport(input.url, {
      method: "POST",
      headers,
      body,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      timeoutMs: TEST_REQUEST_TIMEOUT_MS,
    });
    const latencyMs = now().getTime() - sentAt;
    const outcome = classifyResponse(response.status);
    let responseSnippet: string | undefined;
    try {
      responseSnippet = (await response.text()).slice(
        0,
        RESPONSE_SNIPPET_LIMIT
      );
    } catch {
      // The status decides the outcome; an unreadable body is simply omitted.
    }
    return {
      delivered: outcome === "delivered",
      statusCode: response.status,
      latencyMs,
      responseSnippet,
      error: outcome === "delivered" ? undefined : `http ${response.status}`,
    };
  } catch (err) {
    // A thrown request (DNS/SSRF rejection, connection refused, timeout) is a
    // reportable "not delivered", not a 500 for the operator.
    return {
      delivered: false,
      latencyMs: now().getTime() - sentAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

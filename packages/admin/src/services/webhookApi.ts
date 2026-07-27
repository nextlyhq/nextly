/**
 * Webhook API service.
 *
 * Thin typed wrappers over the shared `fetcher`, one per REST operation, each
 * unwrapping the canonical envelope it returns. Every write is session-only
 * (the fetcher's protected mode sends the cookie); the raw signing secret is
 * only ever present on create and reveal, never on a list or read.
 */

import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  ListResponse,
  MutationResponse,
} from "../lib/api/response-types";
import type {
  CreateWebhookInput,
  CreatedWebhook,
  RotateWebhookInput,
  UpdateWebhookInput,
  WebhookEndpointSummary,
  WebhookTestResult,
} from "../types/webhooks";

/** List every endpoint (the server returns a single synthetic page). */
export async function listWebhooks(): Promise<WebhookEndpointSummary[]> {
  const result = await fetcher<ListResponse<WebhookEndpointSummary>>(
    "/webhooks",
    {},
    true
  );
  return result.items;
}

/** Read one endpoint (bare document; 404 if missing or retired). */
export function getWebhook(id: string): Promise<WebhookEndpointSummary> {
  return fetcher<WebhookEndpointSummary>(`/webhooks/${id}`, {}, true);
}

/** Create an endpoint. The returned `secret` is shown once and never retrievable. */
export async function createWebhook(
  input: CreateWebhookInput
): Promise<CreatedWebhook> {
  const result = await fetcher<MutationResponse<CreatedWebhook>>(
    "/webhooks",
    { method: "POST", body: JSON.stringify(input) },
    true
  );
  return result.item;
}

/** Patch an endpoint (also the enable/disable path via `{ enabled }`). */
export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput
): Promise<WebhookEndpointSummary> {
  const result = await fetcher<MutationResponse<WebhookEndpointSummary>>(
    `/webhooks/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    true
  );
  return result.item;
}

/** Soft-delete an endpoint; the response body is discarded. */
export async function deleteWebhook(id: string): Promise<void> {
  await fetcher<ActionResponse<{ id: string }>>(
    `/webhooks/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Rotate the signing secret with an overlap window. Returns the new endpoint
 * plus the fresh secret, shown once (same shape as create).
 */
export async function rotateSecret(
  id: string,
  input: RotateWebhookInput
): Promise<CreatedWebhook> {
  const result = await fetcher<MutationResponse<CreatedWebhook>>(
    `/webhooks/${id}/secret/rotate`,
    { method: "POST", body: JSON.stringify(input) },
    true
  );
  return result.item;
}

/** Retire every overlapping (rotated-away) secret now, leaving only the primary. */
export async function expireOldSecrets(
  id: string
): Promise<WebhookEndpointSummary> {
  const result = await fetcher<MutationResponse<WebhookEndpointSummary>>(
    `/webhooks/${id}/secret/expire-old`,
    { method: "POST" },
    true
  );
  return result.item;
}

/** Reveal the active signing secret(s) — rotation can keep more than one alive. */
export async function revealSecret(id: string): Promise<string[]> {
  const result = await fetcher<{ secrets: string[] }>(
    `/webhooks/${id}/secret`,
    {},
    true
  );
  return result.secrets;
}

/** Send a synthetic signed ping; the message is dropped, the outcome returned. */
export async function testEndpoint(id: string): Promise<WebhookTestResult> {
  const result = await fetcher<ActionResponse<WebhookTestResult>>(
    `/webhooks/${id}/test`,
    { method: "POST" },
    true
  );
  return {
    delivered: result.delivered,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
    responseSnippet: result.responseSnippet,
  };
}

export const webhookApi = {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateSecret,
  expireOldSecrets,
  revealSecret,
  testEndpoint,
} as const;

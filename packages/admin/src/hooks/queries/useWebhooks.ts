"use client";

/**
 * Webhook query hooks.
 *
 * TanStack Query hooks for webhook endpoint CRUD, secret reveal, and the
 * connectivity test. Mutations invalidate the base `["webhooks"]` key so the
 * list refetches after a change (the house style — no optimistic updates).
 * Reveal and test are actions, not cache mutations, so they invalidate nothing;
 * the calling page reads their result via an `onSuccess` at the call site.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { webhookApi } from "@admin/services/webhookApi";
import type {
  CreateWebhookInput,
  CreatedWebhook,
  RotateWebhookInput,
  UpdateWebhookInput,
  WebhookEndpointSummary,
  WebhookTestResult,
} from "@admin/types/webhooks";

export const webhookKeys = {
  all: () => ["webhooks"] as const,
  lists: () => [...webhookKeys.all(), "list"] as const,
  detail: (id: string) => [...webhookKeys.all(), "detail", id] as const,
};

/**
 * All endpoints. 30s stale keeps the list fresh across a settings session.
 * `enabled` lets a caller skip the fetch when the user can't read the list
 * (e.g. a create-only role that would otherwise get a 403).
 */
export function useWebhooks(options?: { enabled?: boolean }) {
  return useQuery<WebhookEndpointSummary[], Error>({
    queryKey: webhookKeys.lists(),
    queryFn: () => webhookApi.listWebhooks(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

/** One endpoint, for the edit page. */
export function useWebhook(id: string) {
  return useQuery<WebhookEndpointSummary, Error>({
    queryKey: webhookKeys.detail(id),
    queryFn: () => webhookApi.getWebhook(id),
    enabled: Boolean(id),
  });
}

/**
 * Create an endpoint. The result carries the one-time signing secret; the page
 * captures it in `onSuccess` and shows the reveal modal — it is gone after.
 */
export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation<CreatedWebhook, Error, CreateWebhookInput>({
    mutationFn: input => webhookApi.createWebhook(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.all() });
    },
  });
}

/** Patch an endpoint (also enable/disable via `{ enabled }`). */
export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation<
    WebhookEndpointSummary,
    Error,
    { id: string; input: UpdateWebhookInput }
  >({
    mutationFn: ({ id, input }) => webhookApi.updateWebhook(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.all() });
    },
  });
}

/** Soft-delete an endpoint. */
export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: id => webhookApi.deleteWebhook(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.all() });
    },
  });
}

/**
 * Rotate the signing secret. Invalidates the endpoint cache so the secret
 * lifecycle (primary + any overlapping secret) refetches; the page captures the
 * one-time new secret from the result in `onSuccess`.
 */
export function useRotateSecret() {
  const queryClient = useQueryClient();
  return useMutation<
    CreatedWebhook,
    Error,
    { id: string; input: RotateWebhookInput }
  >({
    mutationFn: ({ id, input }) => webhookApi.rotateSecret(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.all() });
    },
  });
}

/** Retire overlapping secrets now; refetch so the lifecycle reflects it. */
export function useExpireOldSecrets() {
  const queryClient = useQueryClient();
  return useMutation<WebhookEndpointSummary, Error, string>({
    mutationFn: id => webhookApi.expireOldSecrets(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.all() });
    },
  });
}

/** Reveal the signing secret(s) on demand (an action, not a cache mutation). */
export function useRevealSecret() {
  return useMutation<string[], Error, string>({
    mutationFn: id => webhookApi.revealSecret(id),
  });
}

/** Send a test ping and return its outcome. */
export function useTestEndpoint() {
  return useMutation<WebhookTestResult, Error, string>({
    mutationFn: id => webhookApi.testEndpoint(id),
  });
}

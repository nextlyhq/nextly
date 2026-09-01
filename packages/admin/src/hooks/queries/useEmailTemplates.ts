/**
 * Email Template Query Hooks
 *
 * TanStack Query hooks for email template CRUD, layout, and preview operations.
 * Used by the Settings > Email Templates pages.
 *
 * Query Keys:
 * - `["emailTemplates"]` — base key for invalidation
 * - `["emailTemplates", "list"]` — template list
 * - `["emailTemplates", "detail", id]` — single template
 * - `["emailTemplates", "layout"]` — shared layout (header/footer)
 *
 * @example
 * ```ts
 * const { data: templates, isLoading } = useEmailTemplates();
 * const { data: template } = useEmailTemplate('template-id');
 * const { data: layout } = useEmailLayout();
 * const { mutate: create } = useCreateEmailTemplate();
 * ```
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  previewDraft,
  sendTestEmail,
  type DraftPreviewResult,
  type DraftPreviewTemplate,
  type EmailTemplateRecord,
  type CreateEmailTemplatePayload,
  type UpdateEmailTemplatePayload,
  type EmailTemplatePreviewResult,
  type SendTestEmailResult,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Query Key Factory
// ============================================================

export const emailTemplateKeys = {
  all: () => ["emailTemplates"] as const,
  lists: () => [...emailTemplateKeys.all(), "list"] as const,
  details: () => [...emailTemplateKeys.all(), "detail"] as const,
  detail: (id: string) => [...emailTemplateKeys.details(), id] as const,
  /**
   * A rendered draft, keyed by everything the render reads.
   *
   * The fields ARE the key: a preview is a pure function of them, so two
   * identical drafts share one cache entry and a changed character is a
   * different entry. Keying by template id instead would serve one draft's
   * render for another's edits, and would have no key at all while creating.
   */
  draftPreview: (
    template: DraftPreviewTemplate,
    data: Record<string, unknown>
  ) => [...emailTemplateKeys.all(), "draftPreview", template, data] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * useEmailTemplates — Fetch all email templates.
 * Returns a flat array (client-side pagination is handled by the page component).
 */
export function useEmailTemplates(
  options?: Omit<
    UseQueryOptions<EmailTemplateRecord[], Error>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery<EmailTemplateRecord[], Error>({
    queryKey: emailTemplateKeys.lists(),
    queryFn: () => listTemplates(),
    ...options,
  });
}

/**
 * useEmailTemplate — Fetch a single email template by ID.
 * Only runs when `id` is provided (truthy).
 */
export function useEmailTemplate(
  id?: string,
  options?: Omit<
    UseQueryOptions<EmailTemplateRecord, Error>,
    "queryKey" | "queryFn" | "enabled"
  >
) {
  return useQuery<EmailTemplateRecord, Error>({
    queryKey: emailTemplateKeys.detail(id!),
    queryFn: () => {
      if (!id) throw new Error("Template ID is required");
      return getTemplate(id);
    },
    enabled: !!id,
    ...options,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * useCreateEmailTemplate — Create a new email template.
 * Invalidates all template queries on success.
 */
export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation<EmailTemplateRecord, Error, CreateEmailTemplatePayload>({
    mutationFn: data => createTemplate(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: emailTemplateKeys.all(),
      });
    },
  });
}

/**
 * useUpdateEmailTemplate — Update an existing email template.
 * Invalidates all template queries on success.
 */
export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation<
    EmailTemplateRecord,
    Error,
    { id: string; data: UpdateEmailTemplatePayload }
  >({
    mutationFn: ({ id, data }) => updateTemplate(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: emailTemplateKeys.all(),
      });
    },
  });
}

/**
 * useDeleteEmailTemplate — Delete an email template.
 * Uses optimistic updates to immediately remove the template from the UI.
 */
export function useDeleteEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    string,
    { previousTemplates?: EmailTemplateRecord[] }
  >({
    mutationFn: id => deleteTemplate(id),
    // Optimistically remove the template from the cache before the API call completes
    onMutate: async deletedId => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: emailTemplateKeys.lists() });

      // Snapshot the previous value
      const previousTemplates = queryClient.getQueryData<EmailTemplateRecord[]>(
        emailTemplateKeys.lists()
      );

      // Optimistically update to the new value
      if (previousTemplates) {
        queryClient.setQueryData<EmailTemplateRecord[]>(
          emailTemplateKeys.lists(),
          previousTemplates.filter(template => template.id !== deletedId)
        );
      }

      // Return context object with the snapshotted value
      return { previousTemplates };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (_err, _deletedId, context) => {
      if (context?.previousTemplates) {
        queryClient.setQueryData(
          emailTemplateKeys.lists(),
          context.previousTemplates
        );
      }
    },
    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: emailTemplateKeys.all(),
      });
    },
  });
}

/**
 * usePreviewEmailTemplate — Preview a template with sample data.
 */
export function usePreviewEmailTemplate() {
  return useMutation<
    EmailTemplatePreviewResult,
    Error,
    { id: string; sampleData: Record<string, unknown> }
  >({
    mutationFn: ({ id, sampleData }) => previewTemplate(id, sampleData),
  });
}

/**
 * useSendTestEmailTemplate — send a real test email from a saved template.
 */
export function useSendTestEmailTemplate() {
  return useMutation<
    SendTestEmailResult,
    Error,
    { slug: string; to: string; variables: Record<string, unknown> }
  >({
    mutationFn: ({ slug, to, variables }) => sendTestEmail(slug, to, variables),
  });
}

/**
 * useDraftEmailTemplatePreview — render UNSAVED fields on the server.
 *
 * A QUERY rather than a mutation, though the transport is a POST. The render
 * is a read: it writes nothing, and it is re-run whenever the fields change.
 * As a mutation, typing would fire one per keystroke with no relationship
 * between them, and whichever RESPONDED last would win — not the one typed
 * last — leaving a stale preview on screen with nothing to indicate it. As a
 * query, React Query dedupes identical fields, discards superseded results,
 * and `keepPreviousData` holds the last good render in place instead of
 * flashing empty between keystrokes.
 *
 * Debouncing belongs to the CALLER: this hook renders whatever key it is
 * given, and only the caller knows which of its fields are typed into.
 */
export function useDraftEmailTemplatePreview(
  template: DraftPreviewTemplate,
  data: Record<string, unknown>,
  options?: { enabled?: boolean }
) {
  return useQuery<DraftPreviewResult, Error>({
    queryKey: emailTemplateKeys.draftPreview(template, data),
    queryFn: () => previewDraft(template, data),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    // A render is deterministic in its key, so a cached entry never goes
    // stale: the only thing that can change the answer is a different key.
    staleTime: Infinity,
    retry: false,
  });
}

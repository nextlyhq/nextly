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
  getLayout,
  updateLayout,
  previewTemplate,
  type EmailTemplateRecord,
  type CreateEmailTemplatePayload,
  type UpdateEmailTemplatePayload,
  type EmailLayout,
  type EmailTemplatePreviewResult,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Query Key Factory
// ============================================================

export const emailTemplateKeys = {
  all: () => ["emailTemplates"] as const,
  lists: () => [...emailTemplateKeys.all(), "list"] as const,
  details: () => [...emailTemplateKeys.all(), "detail"] as const,
  detail: (id: string) => [...emailTemplateKeys.details(), id] as const,
  layout: () => [...emailTemplateKeys.all(), "layout"] as const,
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

/**
 * useEmailLayout — Fetch the shared email layout (header/footer).
 */
export function useEmailLayout(
  options?: Omit<UseQueryOptions<EmailLayout, Error>, "queryKey" | "queryFn">
) {
  return useQuery<EmailLayout, Error>({
    queryKey: emailTemplateKeys.layout(),
    queryFn: () => getLayout(),
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
      queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
        queryKey: emailTemplateKeys.all(),
      });
    },
  });
}

/**
 * useUpdateEmailLayout — Update the shared email layout.
 * Invalidates the layout query on success.
 */
export function useUpdateEmailLayout() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, Partial<EmailLayout>>({
    mutationFn: data => updateLayout(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: emailTemplateKeys.layout(),
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

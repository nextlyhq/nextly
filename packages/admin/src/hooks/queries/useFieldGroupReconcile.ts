"use client";

/**
 * Reading and applying a field group's definition repair.
 *
 * Two hooks for two genuinely different operations, rather than one that does both: the preview is
 * a read that may run on any field group at any time, and the repair is a write the operator has
 * to approve. Keeping them apart is what lets the dialog show a plan before anything happens.
 *
 * @module hooks/queries/useFieldGroupReconcile
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ReconcileFieldGroupPreview,
  ReconcileFieldGroupResult,
} from "nextly/field-group-reconcile";

import { fieldGroupApi } from "@admin/services/fieldGroupApi";

import { fieldGroupKeys } from "./useFieldGroups";

/** Query key for one field group's repair plan. */
const reconcilePreviewKey = (fieldGroupSlug: string) =>
  [...fieldGroupKeys.detail(fieldGroupSlug), "reconcile-preview"] as const;

/**
 * What repairing this field group would change.
 *
 * 🔴 Never served from cache. A plan describes the database at one moment, and the operator is
 * about to approve it — showing a remembered one would put a stale list in front of the decision
 * that acts on it. The server refuses a stale approval regardless, so a cached plan could not
 * produce a wrong write; it would produce a confusing refusal, which is a worse experience than
 * simply asking again.
 *
 * `enabled` is what keeps this from running on every rendered row: the dialog turns it on.
 */
export function useFieldGroupReconcilePreview(
  fieldGroupSlug: string,
  enabled: boolean
) {
  return useQuery<ReconcileFieldGroupPreview, Error>({
    queryKey: reconcilePreviewKey(fieldGroupSlug),
    queryFn: () => fieldGroupApi.previewReconcile(fieldGroupSlug),
    enabled: enabled && Boolean(fieldGroupSlug),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    // A refused preview is a considered answer from the server — a locked group, a missing table.
    // Retrying re-asks a question already answered and delays showing the operator why.
    retry: false,
  });
}

/**
 * Apply the repair the operator approved.
 *
 * `expectedSchemaVersion` is required rather than optional on purpose: this hook exists to serve
 * an approval, and an approval that does not name the plan it approves is the failure the pin
 * exists to prevent. A caller with no plan in hand should not be using this hook.
 */
export function useFieldGroupReconcile() {
  const queryClient = useQueryClient();

  return useMutation<
    ReconcileFieldGroupResult,
    Error,
    { fieldGroupSlug: string; expectedSchemaVersion: number }
  >({
    mutationFn: async ({ fieldGroupSlug, expectedSchemaVersion }) => {
      const result = await fieldGroupApi.reconcile(
        fieldGroupSlug,
        expectedSchemaVersion
      );
      return result.item;
    },
    onSuccess: (_result, { fieldGroupSlug }) => {
      // The repair rewrites the definition and clears the status, so every view of this group is
      // now stale — the list badge, the detail, and any plan still held for it.
      void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
      void queryClient.invalidateQueries({
        queryKey: fieldGroupKeys.detail(fieldGroupSlug),
      });
      void queryClient.invalidateQueries({
        queryKey: reconcilePreviewKey(fieldGroupSlug),
      });
    },
  });
}

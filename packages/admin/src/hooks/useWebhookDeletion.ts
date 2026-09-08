"use client";

/**
 * Deleting an endpoint: the confirmation it requires, and the act itself.
 *
 * Its own hook for the same reason the secret's actions are — a destructive act
 * with a confirmation gate is a concern, not a line of the page. Kept SEPARATE
 * from `useWebhookSecretActions` rather than folded in with it: rotating a
 * secret and deleting an endpoint are gated on different permissions and have
 * different consequences, and one hook holding both would invite a caller to
 * treat them as interchangeable.
 *
 * @module hooks/useWebhookDeletion
 */

import { useCallback, useState } from "react";

import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useDeleteWebhook } from "@admin/hooks/queries/useWebhooks";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";

export interface WebhookDeletion {
  confirming: boolean;
  setConfirming: (open: boolean) => void;
  confirm: () => void;
  isDeleting: boolean;
}

/**
 * `name` is captured for the success message BEFORE the row is gone, which is
 * why it is a parameter rather than read from a document the delete invalidates.
 *
 * NULLABLE on purpose, and it is the readiness signal rather than a nicety. A
 * caller mounts this hook while the endpoint is still loading — hooks cannot be
 * called conditionally — so there is a window in which the document does not
 * exist yet. Passing `null` for it says so, and `confirm` refuses rather than
 * deleting a row whose name it would then report as an empty string.
 *
 * A default of `""` would type-check and read as harmless, which is what makes
 * it the wrong shape: it turns "not loaded yet" into a legal value and leaves
 * the guard to whichever caller remembers it. Today only the confirmation
 * dialog stands between that window and a destructive write, and a guard that
 * depends on the current call graph is one the call graph is free to remove.
 */
export function useWebhookDeletion(
  id: string,
  name: string | null
): WebhookDeletion {
  const { mutate: doDelete, isPending: isDeleting } = useDeleteWebhook();
  const [confirming, setConfirming] = useState(false);

  const confirm = useCallback(() => {
    // Refuses rather than proceeding: the endpoint is not loaded, so there is
    // nothing to confirm the deletion OF.
    if (name === null) return;
    doDelete(id, {
      onSuccess: () => {
        toast.success("Endpoint deleted", {
          description: `"${name}" will no longer receive events.`,
        });
        navigateTo(ROUTES.SETTINGS_WEBHOOKS);
      },
      onError: (err: Error) => {
        toast.error("Delete failed", { description: apiErrorMessage(err) });
      },
    });
  }, [doDelete, id, name]);

  return { confirming, setConfirming, confirm, isDeleting };
}

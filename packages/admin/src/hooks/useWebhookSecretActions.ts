"use client";

/**
 * Everything the signing secret's own lifecycle needs: revealing it, rotating
 * it, and retiring an overlapping predecessor early.
 *
 * Split from the edit page because it is a different concern from editing the
 * endpoint's configuration. The page fetches a document and saves a form; these
 * three acts operate on a credential, each owns a piece of transient state — a
 * revealed value, a one-time rotation result, a confirmation — and none of it
 * outlives the page or belongs to the form.
 *
 * The state is here rather than in the panel that renders it because two of the
 * three results are shown in MODALS, which the page mounts. A panel owning state
 * its sibling renders would be the same coupling wearing a different shape.
 *
 * @module hooks/useWebhookSecretActions
 */

import { useCallback, useState } from "react";

import { toast } from "@admin/components/ui";
import {
  useExpireOldSecrets,
  useRevealSecret,
  useRotateSecret,
} from "@admin/hooks/queries/useWebhooks";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

export interface WebhookSecretActions {
  /** Secrets returned by a reveal, shown in a modal until dismissed. */
  revealed: string[] | null;
  dismissRevealed: () => void;
  reveal: () => void;
  isRevealing: boolean;
  /** The one-time secret a rotation mints, shown once. */
  rotated: string | null;
  dismissRotated: () => void;
  confirmingRotate: boolean;
  setConfirmingRotate: (open: boolean) => void;
  rotate: (overlapSeconds: number) => void;
  isRotating: boolean;
  expireOld: () => void;
  isExpiring: boolean;
}

export function useWebhookSecretActions(id: string): WebhookSecretActions {
  const { mutate: doReveal, isPending: isRevealing } = useRevealSecret();
  const { mutate: doRotate, isPending: isRotating } = useRotateSecret();
  const { mutate: doExpireOld, isPending: isExpiring } = useExpireOldSecrets();

  const [revealed, setRevealed] = useState<string[] | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const reveal = useCallback(() => {
    doReveal(id, {
      onSuccess: setRevealed,
      onError: (err: Error) => {
        toast.error("Could not reveal the secret", {
          description: apiErrorMessage(err),
        });
      },
    });
  }, [doReveal, id]);

  const rotate = useCallback(
    (overlapSeconds: number) => {
      doRotate(
        { id, input: { overlapSeconds } },
        {
          onSuccess: result => {
            setConfirmingRotate(false);
            // The fresh secret is shown once here; the reveal action can return
            // it again later while it remains the primary.
            setRotated(result.secret);
            toast.success("Signing secret rotated", {
              description:
                overlapSeconds > 0
                  ? "The previous secret keeps working until the overlap window ends."
                  : "The previous secret was retired immediately.",
            });
          },
          onError: (err: Error) => {
            toast.error("Could not rotate the secret", {
              description: apiErrorMessage(err),
            });
          },
        }
      );
    },
    [doRotate, id]
  );

  const expireOld = useCallback(() => {
    doExpireOld(id, {
      onSuccess: () => {
        toast.success("Old signing secret expired", {
          description: "Only the current secret can sign deliveries now.",
        });
      },
      onError: (err: Error) => {
        toast.error("Could not expire the old secret", {
          description: apiErrorMessage(err),
        });
      },
    });
  }, [doExpireOld, id]);

  return {
    revealed,
    dismissRevealed: useCallback(() => setRevealed(null), []),
    reveal,
    isRevealing,
    rotated,
    dismissRotated: useCallback(() => setRotated(null), []),
    confirmingRotate,
    setConfirmingRotate,
    rotate,
    isRotating,
    expireOld,
    isExpiring,
  };
}

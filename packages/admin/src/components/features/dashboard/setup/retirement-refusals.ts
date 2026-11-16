"use client";

/**
 * The setup steps the host last refused to call "You're all set" for, per reader, kept outside the
 * card so a refusal outlives the card that asked.
 *
 * The dashboard draws a card's skeleton while its data is asked for again on its own (a Retry, or
 * a write that refreshes the card), which unmounts the card's component. A refusal held in the
 * component was lost with it, and the card drawn again asked the same question again, the host
 * refused it again, and so on without end. Held here, a card drawn again over the same steps
 * remembers it was refused; the first card drawn over different steps forgets it, so those steps,
 * or the refused ones reached again later, are asked about once more.
 *
 * Kept per admin session, as long as its query client lives, and per reader within it, so a
 * reader who signs in after another on the same page never inherits their refusal. Never stored:
 * a reload asks once more, which is one request.
 *
 * @module components/features/dashboard/setup/retirement-refusals
 */

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { currentUserKey } from "@admin/hooks/useDashboardUser";

/** The refused steps' signature, by reader, for each admin session's query client. */
const refusals = new WeakMap<QueryClient, Map<string, string>>();

/** The reader the dashboard is drawn for, as its chrome already read them; "" before that. */
function readerOf(queryClient: QueryClient): string {
  return queryClient.getQueryData<{ id: string }>(currentUserKey)?.id ?? "";
}

/** What this reader's last refused retirement was about, and how to record a new refusal. */
export interface RetirementRefusals {
  /** The signature of the steps last refused, or `undefined` when none was. */
  refused: () => string | undefined;
  /** Records that the host refused the retirement over the steps `signature` describes. */
  refuse: (signature: string) => void;
  /** Forgets the refusal: the steps have changed since. */
  forget: () => void;
}

export function useRetirementRefusals(): RetirementRefusals {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const ofSession = () => {
      let held = refusals.get(queryClient);
      if (held === undefined) {
        held = new Map();
        refusals.set(queryClient, held);
      }
      return held;
    };
    return {
      refused: () => ofSession().get(readerOf(queryClient)),
      refuse: signature => {
        ofSession().set(readerOf(queryClient), signature);
      },
      forget: () => {
        ofSession().delete(readerOf(queryClient));
      },
    };
  }, [queryClient]);
}

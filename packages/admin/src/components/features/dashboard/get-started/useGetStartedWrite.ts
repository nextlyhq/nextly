"use client";

/**
 * What the Get started card writes: that the reader acted on it, and which steps they skipped.
 *
 * Stored in the card's own settings through the dashboard's single-card write, the guarded write
 * every card setting at rest goes through, so a skip is kept on the server for this reader and
 * travels with the card: removed, it comes back with its skips. `acted` is what keeps a finished
 * card drawn as "You're all set" for the reader who used it; the host leaves anyone else's
 * finished card dormant.
 *
 * @module components/features/dashboard/get-started/useGetStartedWrite
 */

import type { GetStartedAnswer } from "nextly/config";
import { useCallback } from "react";

import { useAtRestSettingsWrite } from "@admin/components/features/widgets/edit/at-rest-settings-write";

const TITLE = "Get started";

export interface GetStartedWrite {
  /** Skip a waiting step, or restore one the reader skipped. */
  setSkipped: (key: string, skipped: boolean) => void;
  /**
   * Record that the reader acted on the card, once, before they leave it for a step; `then`
   * runs once that record has landed, or at once when there is nothing to record.
   */
  markActed: (then?: () => void) => void;
  /** Why the card's controls cannot save now, or `undefined` when they can. */
  unavailable: string | undefined;
  isWriting: boolean;
}

const WHILE_CUSTOMISING =
  "Finish customising the dashboard to skip or restore a step.";

/** The skipped step keys an answer reports: core marks a skip it honours as "skipped". */
function skippedIn(answer: GetStartedAnswer): string[] {
  return answer.steps
    .filter(step => step.status === "skipped")
    .map(step => step.key);
}

export function useGetStartedWrite(
  placementId: string,
  answer: GetStartedAnswer | undefined,
  acted: boolean
): GetStartedWrite {
  const settings = useAtRestSettingsWrite();

  const write = useCallback(
    (skipped: readonly string[], then?: () => void) => {
      if (settings === undefined) {
        then?.();
        return;
      }
      settings.write(
        placementId,
        TITLE,
        {
          acted: true,
          ...(skipped.length > 0 ? { skipped: [...skipped] } : {}),
        },
        // 🔴 After the record lands, not beside it: an action that finishes first (loading sample
        // content) changes what the reader is shown, the write is then refused as stale, and the
        // card goes instead of saying "You're all set". A write that fails says so itself; the
        // action the reader asked for still runs.
        then === undefined ? {} : { onLanded: then, onFailed: () => then() }
      );
    },
    [settings, placementId]
  );

  const setSkipped = useCallback(
    (key: string, skipped: boolean) => {
      if (!answer) return;
      const current = skippedIn(answer).filter(k => k !== key);
      write(skipped ? [...current, key] : current);
    },
    [answer, write]
  );

  const markActed = useCallback(
    (then?: () => void) => {
      if (acted || !answer) {
        then?.();
        return;
      }
      write(skippedIn(answer), then);
    },
    [acted, answer, write]
  );

  return {
    setSkipped,
    markActed,
    unavailable:
      settings === undefined ? WHILE_CUSTOMISING : settings.unavailable,
    isWriting: settings?.isWriting ?? false,
  };
}

"use client";

/**
 * A reader asking to save their customisation, from the bar or from the
 * unsaved-changes prompt.
 *
 * One request for both, because both have to honour the same rule: over a
 * stored arrangement the server could not read, Save first asks whether to
 * replace it. The server refuses that save unless the reader confirmed, and
 * the question is this hook's to ask, so neither caller can skip it.
 *
 * @module components/features/widgets/edit/useSaveRequest
 */

import { useCallback, useRef, useState } from "react";

import type { SaveOptions, SaveOutcome } from "./useLayoutLifecycle";

export interface SaveRequest {
  /**
   * Save the draft, or ask first over an unreadable stored arrangement, and
   * answer whether the reader's work is now stored. Asking answers `false`:
   * nothing is stored until they confirm, and a caller waiting to navigate
   * away must not.
   */
  request: () => Promise<boolean>;
  /** Whether the replace question is open. */
  askingReplace: boolean;
  setAskingReplace: (open: boolean) => void;
  /** The reader confirmed replacing the unreadable arrangement: save it. */
  confirmReplace: () => void;
}

export function useSaveRequest(
  save: (options?: SaveOptions) => Promise<SaveOutcome>,
  isUnreadable: boolean
): SaveRequest {
  const [askingReplace, setAskingReplace] = useState(false);
  // The save on its way, if any. A second request while one is pending -- the
  // prompt's Save during the bar's -- waits for that one rather than sending
  // a second write against the same version, which the server would refuse
  // as a conflict the reader did not cause.
  const pending = useRef<Promise<boolean> | null>(null);

  const request = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (isUnreadable) {
      setAskingReplace(true);
      return false;
    }
    const saving = save().then(outcome => outcome === "saved");
    pending.current = saving;
    try {
      return await saving;
    } finally {
      pending.current = null;
    }
  }, [isUnreadable, save]);

  const confirmReplace = useCallback(() => {
    void save({ replaceUnreadable: true });
  }, [save]);

  return { request, askingReplace, setAskingReplace, confirmReplace };
}

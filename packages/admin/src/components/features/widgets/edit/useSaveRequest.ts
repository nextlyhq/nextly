"use client";

/**
 * A reader asking to save their customisation, from the bar or from the
 * unsaved-changes prompt.
 *
 * One request for both, because both have to honour the same rule: over a
 * stored arrangement the server could not read, Save first asks whether to
 * replace it. The server refuses that save unless the reader confirmed, and
 * the question is this hook's to ask, so neither caller can skip it. So is
 * the change still in a card's open settings panel: each Save keeps it with
 * the draft, as that panel's Done would, or stops when the panel refuses it.
 *
 * @module components/features/widgets/edit/useSaveRequest
 */

import { useCallback, useRef, useState } from "react";

import {
  bringRefusedPanelForward,
  stagePendingPanels,
} from "./settings-panel-registry";
import type {
  SaveOptions,
  SaveOutcome,
  StagedSettings,
} from "./useLayoutLifecycle";

export interface SaveRequest {
  /**
   * Save the draft, or ask first over an unreadable stored arrangement, and
   * answer whether the reader's work is now stored. Asking answers `false`:
   * nothing is stored until they confirm, and a caller waiting to navigate
   * away must not. A card's open settings panel holding a change has it
   * saved with the draft, as its Done would keep it; a change the panel's own
   * checks refuse stops the save, answering `false`, with the panel saying why
   * and focus on what it refused.
   */
  request: () => Promise<boolean>;
  /** Whether the replace question is open. */
  askingReplace: boolean;
  setAskingReplace: (open: boolean) => void;
  /** The reader confirmed replacing the unreadable arrangement: save it. */
  confirmReplace: () => void;
}

/** One open panel's change, as the save applies it to the draft. */
function stagedSettings({
  placementId,
  kept,
}: {
  placementId: string;
  kept: { config: Record<string, unknown>; ownTitle: string };
}): StagedSettings {
  return { placementId, config: kept.config, ownTitle: kept.ownTitle };
}

/**
 * Save with every open settings panel's change staged, as each panel's Done would keep it, and
 * answer whether the reader's work is now stored. A change a panel refuses saves nothing: that
 * panel says why and takes focus. The one path every Save of the customised dashboard takes.
 */
async function withPanelsStaged(
  save: (options?: SaveOptions) => Promise<SaveOutcome>,
  options: SaveOptions = {}
): Promise<boolean> {
  const staged = await stagePendingPanels();
  if (staged === "invalid") {
    bringRefusedPanelForward();
    return false;
  }
  const outcome = await save(
    staged.length === 0
      ? Object.keys(options).length === 0
        ? undefined
        : options
      : { ...options, staged: staged.map(stagedSettings) }
  );
  return outcome === "saved";
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
    // Pending from the first step, the panels' staging included, so a second
    // request while they are judged waits for this one too.
    const saving = withPanelsStaged(save);
    pending.current = saving;
    try {
      return await saving;
    } finally {
      pending.current = null;
    }
  }, [isUnreadable, save]);

  // The confirmed replacement saves an open panel's change too, judged as any Save's is.
  const confirmReplace = useCallback(() => {
    void withPanelsStaged(save, { replaceUnreadable: true });
  }, [save]);

  return { request, askingReplace, setAskingReplace, confirmReplace };
}

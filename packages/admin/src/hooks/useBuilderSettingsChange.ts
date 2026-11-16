"use client";

/**
 * What a Builder editor does with the settings its modal hands back.
 *
 * Each change of the settings is one step of the editor's history. An unsaved
 * entity's address is the exception: nothing refers to it yet, so it can still
 * change, and the change moves the entity at once, outside the history. The
 * store entry and the editor's route take the new address, and every state
 * the history holds is rewritten with it, so Undo never takes the address back
 * to one the store and the route no longer hold.
 *
 * @module hooks/useBuilderSettingsChange
 */
import { useCallback } from "react";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { toast } from "@admin/components/ui";
import { settingChanges } from "@admin/lib/builder/settings-changes";
import {
  renameUnsavedEntity,
  type UnsavedEntity,
  useUnsavedAddressesBesides,
} from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";
import type { PendingAddress } from "@admin/services/addressCheckApi";

export interface UseBuilderSettingsChangeOptions {
  kind: BuilderKind;
  /** The entity, when it is not saved yet. */
  unsaved: UnsavedEntity | undefined;
  /** The settings shown. */
  settings: BuilderSettingsValues | null;
  /** Records a change of the settings as one step. */
  setSettings: (next: BuilderSettingsValues) => void;
  /** Rewrites the history and the baseline with a moved address. */
  moveAddress: (address: string) => void;
  /** The editor's route for an address. */
  editRoute: (address: string) => string;
}

export interface BuilderSettingsChange {
  /**
   * Records `next`. `leaveWithoutWarning`, the leave guard's, is called
   * before an unsaved entity's address moves the route: the same entity under
   * a new address is no leave, and the guard would otherwise hold the route
   * at an address the store no longer holds.
   */
  onSettingsChange: (
    next: BuilderSettingsValues,
    leaveWithoutWarning?: () => void
  ) => void;
  /** For an unsaved entity, what its address is checked against. */
  unsavedAddress?: { otherAddresses: readonly PendingAddress[] };
}

export function useBuilderSettingsChange({
  kind,
  unsaved,
  settings,
  setSettings,
  moveAddress,
  editRoute,
}: UseBuilderSettingsChangeOptions): BuilderSettingsChange {
  // Every other unsaved entity's address; this one's own is not held against it.
  const otherAddresses = useUnsavedAddressesBesides(
    kind,
    unsaved?.address ?? ""
  );

  const onSettingsChange = useCallback(
    (next: BuilderSettingsValues, leaveWithoutWarning?: () => void) => {
      let shown = settings;
      if (unsaved && next.slug !== unsaved.address) {
        // The settings checked the address against every other unsaved
        // entity, so the move is refused only if one took it meanwhile.
        if (!renameUnsavedEntity(kind, unsaved.address, next.slug)) {
          toast.error(
            "Another entity not saved yet already uses this address. Choose another."
          );
          return;
        }
        moveAddress(next.slug);
        leaveWithoutWarning?.();
        navigateTo(editRoute(next.slug));
        shown = settings && { ...settings, slug: next.slug };
      }
      // The rest of what changed, as one step. A move of the address alone
      // changes nothing else, and is no step.
      if (shown && settingChanges(shown, next).length === 0) return;
      setSettings(next);
    },
    [kind, unsaved, settings, setSettings, moveAddress, editRoute]
  );

  return {
    onSettingsChange,
    unsavedAddress: unsaved ? { otherAddresses } : undefined,
  };
}

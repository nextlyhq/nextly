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
import { useCallback, useRef } from "react";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { checkAddressAgain } from "@admin/components/features/schema-builder/new-entity/useAddressCheck";
import { toast } from "@admin/components/ui";
import { settingChanges } from "@admin/lib/builder/settings-changes";
import {
  renameUnsavedEntity,
  type UnsavedEntity,
  useUnsavedAddressesBesides,
} from "@admin/lib/builder/unsaved-entities";
import { replaceTo } from "@admin/lib/navigation";
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
  /**
   * A save is on its way. The first save creates the entity under its address
   * and then lets the unsaved one go by that address, so the address does not
   * move until it ends.
   */
  busy: boolean;
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
  busy,
  editRoute,
}: UseBuilderSettingsChangeOptions): BuilderSettingsChange {
  // Every other unsaved entity's address; this one's own is not held against it.
  const otherAddresses = useUnsavedAddressesBesides(
    kind,
    unsaved?.address ?? ""
  );

  /** Records what changed, as one step; a move of the address alone is none. */
  const recordRest = useCallback(
    (shown: BuilderSettingsValues | null, next: BuilderSettingsValues) => {
      if (shown && settingChanges(shown, next).length === 0) return;
      setSettings(next);
    },
    [setSettings]
  );

  /**
   * Moves the unsaved entity to `to`: asked of the server's rule once more
   * (the namespace it shares with other kinds and the snake_case form both
   * count), then the store entry, the history and the route move with it.
   * Answers whether it moved.
   */
  const moveTo = useCallback(
    async (
      from: string,
      to: string,
      leaveWithoutWarning?: () => void
    ): Promise<boolean> => {
      let refusal: string | null;
      try {
        refusal = await checkAddressAgain(kind, to, from);
      } catch {
        // Unanswered, the move is not made on a guess.
        toast.error(
          "The new address could not be checked, so it was not moved. The other settings are kept."
        );
        return false;
      }
      if (refusal !== null) {
        toast.error(refusal);
        return false;
      }
      if (!renameUnsavedEntity(kind, from, to)) {
        toast.error(
          "Another entity not saved yet already uses this address. Choose another."
        );
        return false;
      }
      moveAddress(to);
      // The same entity under a corrected address, not a new place: the leave
      // guard is told it is deliberate, and the route is replaced, so Back
      // does not return to an address that holds nothing.
      leaveWithoutWarning?.();
      replaceTo(editRoute(to));
      return true;
    },
    [kind, moveAddress, editRoute]
  );

  // A move under way: one at a time, and no other change meanwhile, so the
  // move, finishing later, never writes over a change made after it.
  const moving = useRef(false);

  const onSettingsChange = useCallback(
    (next: BuilderSettingsValues, leaveWithoutWarning?: () => void) => {
      if (moving.current) {
        toast.error(
          "The address is still being moved. Change the settings again once it has."
        );
        return;
      }
      if (!unsaved || next.slug === unsaved.address) {
        recordRest(settings, next);
        return;
      }
      // The rest of the settings are kept whatever becomes of the address.
      const keepingAddress = { ...next, slug: unsaved.address };
      if (busy) {
        toast.error(
          `This ${kind === "field-group" ? "field group" : kind === "single" ? "Single" : "collection"} is being saved. Change its address once the save ends.`
        );
        recordRest(settings, keepingAddress);
        return;
      }
      moving.current = true;
      void moveTo(unsaved.address, next.slug, leaveWithoutWarning)
        .then(moved =>
          moved
            ? recordRest(settings && { ...settings, slug: next.slug }, next)
            : recordRest(settings, keepingAddress)
        )
        .finally(() => {
          moving.current = false;
        });
    },
    [unsaved, settings, busy, kind, moveTo, recordRest]
  );

  return {
    onSettingsChange,
    unsavedAddress: unsaved ? { otherAddresses } : undefined,
  };
}

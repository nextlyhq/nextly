"use client";

/**
 * The header's save state and leading action, for a surface that replaces the
 * header: a plugin's document view, such as a full-window editor.
 *
 * Drawn BY THE ADMIN from the host's own context rather than rebuilt by each
 * view from `useDocumentActions()`. A chip and a split button rebuilt from
 * the data would be a second implementation of what the header draws — its
 * words, its reserved width, its Retry, its live regions and the reason each
 * held row shows — and the two would drift.
 *
 * Both render nothing outside a document editor.
 *
 * @module components/features/entries/EntryForm/DocumentSurfaceControls
 */
import type { JSX } from "react";

import {
  CompactDocumentActionBar,
  type ActionBinding,
} from "./DocumentActionBar";
import {
  useDocumentActionsContext,
  useHostedRecoveryPoint,
  useHostedStored,
  useSaveChipDrawn,
} from "./DocumentActionsContext";
import { DocumentStatusLive } from "./DocumentStatusLive";
import { useHostedRecoveryOffer } from "./RecoveryOfferContext";
import { SaveStateIndicator, type OfferedSave } from "./SaveStateIndicator";
import type { DocumentActionBindings } from "./useDocumentActionBindings";

/**
 * Whether the document's work is stored: the header's chip, with the
 * recovery point in its tooltip, and the header's spoken status beside it —
 * settled states politely, a failed save assertively, saving not at all.
 */
export function DocumentSaveIndicator({
  className,
}: {
  /** Placement only: where the chip sits in the surface's bar. */
  className?: string;
}): JSX.Element | null {
  const hosted = useDocumentActionsContext();
  if (hosted === null) return null;
  return <HostedSaveIndicator hosted={hosted} className={className} />;
}

/**
 * The chip inside an editor. Apart from the null check above, so the recovery
 * offer is claimed only by a chip that is actually drawn.
 */
function HostedSaveIndicator({
  hosted,
  className,
}: {
  hosted: DocumentActionBindings;
  className: string | undefined;
}): JSX.Element {
  const recovery = useHostedRecoveryPoint();
  // The editor reports a stored document saved from the moment it opens, with
  // when in the tooltip; the entry form's own bar does not pass this.
  const stored = useHostedStored();
  // The recovery offer, made in the chip; its control claims it, which takes
  // down the banner.
  const offer = useHostedRecoveryOffer();
  // Drawn, so the document's Save keeps that offer while it waits.
  useSaveChipDrawn();
  return (
    <>
      <SaveStateIndicator
        saveState={hosted.saveState}
        recovery={recovery}
        stored={stored}
        offer={offer}
        // The document's own Save, which keeps changes on offer while they
        // wait (see `pendingRecovery`), so the chip's Save and the bar's
        // are one action, refused for the same reasons.
        save={offeredSave(hosted)}
        {...(className === undefined ? {} : { className })}
      />
      <DocumentStatusLive
        saveState={hosted.saveState}
        pendingRecovery={recovery.pendingOfferAt !== null}
      />
    </>
  );
}

/** The document's Save, as the chip's recovery offer runs it. */
function offeredSave(hosted: DocumentActionBindings): OfferedSave {
  const reason = hosted.bindings.save?.disabledReason;
  return {
    run: () => {
      void hosted.run("save");
    },
    ...(reason === undefined ? {} : { disabledReason: reason }),
  };
}

/**
 * The document's leading action, with its other ways to publish and
 * Unpublish on its arrow: the header's own actions as one control.
 *
 * Every control runs its action through the host's `run`, never a native
 * submit. A collection with no lifecycle saves the header's form by
 * submitting it, and a view that replaced the body has no such form to
 * submit; `run` refuses for exactly the reasons the control shows.
 */
export function DocumentPrimaryAction(): JSX.Element | null {
  const hosted = useDocumentActionsContext();
  if (hosted === null) return null;
  const bindings = bindingsThroughRun(hosted);
  // No spinner on the control: "saving" includes a write the page depends on
  // (a site-wide style), which Publish waits for rather than being busy
  // with, and the save chip beside it already says so.
  return (
    <CompactDocumentActionBar actions={hosted.actions} bindings={bindings} />
  );
}

/**
 * The host's bindings as a surface's controls take them: each runs its
 * action through the host's `run`, never a native submit, with the reason it
 * can't run now. One adapter for every control drawn outside the header, so
 * they run and refuse alike.
 */
export function bindingsThroughRun(
  hosted: DocumentActionBindings
): Record<string, ActionBinding | undefined> {
  const bindings: Record<string, ActionBinding | undefined> = {};
  for (const [id, binding] of Object.entries(hosted.bindings)) {
    if (binding === undefined) continue;
    bindings[id] = {
      onSelect: () => {
        void hosted.run(id);
      },
      ...(binding.disabledReason === undefined
        ? {}
        : { disabledReason: binding.disabledReason }),
    };
  }
  return bindings;
}

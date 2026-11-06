"use client";

/**
 * What plugins change on this collection's document screen, made ready for
 * the editor: the overrides its actions run through, the component a replaced
 * action opens, and the sections its panel draws after Details.
 *
 * One hook for all three because they share one answer to "what did the
 * plugin do to the document": a replaced Delete and a panel section that
 * removes the document both end in the editor leaving it, and a section that
 * changes it, like a replacement that does, ends in the editor reading it
 * again. Spelled once here, the two cannot come to answer it differently.
 *
 * @module components/features/entries/EntryForm/usePluginDocumentSurfaces
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  OVERRIDABLE_DOCUMENT_ACTIONS,
  type OverridableDocumentAction,
} from "nextly/config";
import { useMemo, useRef, useState, type JSX } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import {
  refreshAfterEntryChange,
  refreshAfterEntryDelete,
} from "@admin/hooks/queries/entry-cache";
import type {
  DocumentActionReplacementProps,
  DocumentChangeResult,
  DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";
import {
  documentSurfacesFor,
  type CollectionDocumentSurfaces,
  type PluginPanelSectionEntry,
} from "@admin/lib/plugins/document-surfaces";

import type { DocumentLockGates } from "./document-lock-affordances";
import type {
  DocumentActionOutcome,
  DocumentActionOverrides,
} from "./useDocumentActionBindings";

/** What a replaced action answers once its component closes with nothing. */
const BACKED_OUT: DocumentActionOutcome = {
  ok: false,
  reason: "cancelled",
  message: "Cancelled.",
};

/**
 * A replacement on screen: which action, what it draws, and the one answer
 * every caller of it is given.
 */
interface OpenReplacement {
  action: OverridableDocumentAction;
  component: string;
  answered: Promise<DocumentActionOutcome>;
  answer: (outcome: DocumentActionOutcome) => void;
}

/** What another action is answered while a replacement is open. */
const ANOTHER_OPEN: DocumentActionOutcome = {
  ok: false,
  reason: "busy",
  message: "Finish the open action first.",
};

/**
 * Why every overridable action is held before the plugin list is known: it
 * may be hidden or replaced on this collection, and its built-in write must
 * not run in the meantime. Said to the author on the row.
 */
const AWAITING_PLUGINS =
  "Waiting for the admin to load what its plugins change here.";

/** Every overridable action, held for `AWAITING_PLUGINS`. */
function heldUntilPluginsLoad(): DocumentActionOverrides {
  return Object.fromEntries(
    OVERRIDABLE_DOCUMENT_ACTIONS.map(action => [
      action,
      { kind: "held", reason: AWAITING_PLUGINS },
    ])
  );
}

/**
 * The editor's overrides from a plugin's: a hidden action stays hidden, and a
 * replaced one runs `openReplacement` with the component it names.
 */
function overridesFor(
  actions: CollectionDocumentSurfaces["actions"],
  openReplacement: (
    action: OverridableDocumentAction,
    component: string
  ) => Promise<DocumentActionOutcome>
): DocumentActionOverrides {
  const overrides: DocumentActionOverrides = {};
  for (const action of Object.keys(actions) as OverridableDocumentAction[]) {
    const override = actions[action];
    if (override === undefined) continue;
    overrides[action] =
      override === "hidden"
        ? { kind: "hidden" }
        : {
            kind: "replaced",
            ...(override.label === undefined ? {} : { label: override.label }),
            open: () => openReplacement(action, override.component),
          };
  }
  return overrides;
}

export interface PluginDocumentSurfaces {
  /** The overrides the editor's actions run through. */
  actionOverrides: DocumentActionOverrides;
  /** The replacement component the author opened, or null. */
  replacement: JSX.Element | null;
  /** The sections the document panel draws after Details. */
  sections: readonly PluginPanelSectionEntry[];
  /** What each section is handed; absent before the document is saved. */
  sectionProps: DocumentPanelSectionProps | undefined;
}

export function usePluginDocumentSurfaces({
  collectionSlug,
  entryId,
  documentLock,
  onDeleted,
}: {
  collectionSlug: string;
  /** The saved document's id, or "" before it is saved. */
  entryId: string;
  /** What holds the document right now, as a section is told. */
  documentLock: DocumentLockGates;
  /** Leaves the document once a plugin removed it, as the built-in Delete does. */
  onDeleted: (() => void) | undefined;
}): PluginDocumentSurfaces {
  const { plugins } = useBranding();
  // Until the list has arrived, an absent override says nothing: the plugin
  // that overrides an action may simply not be known yet.
  const { isPending, isUnavailable } = useBrandingStatus();
  const queryClient = useQueryClient();
  const surfaces = useMemo(
    () => documentSurfacesFor(plugins, collectionSlug),
    [plugins, collectionSlug]
  );
  const [open, setOpen] = useState<OpenReplacement | null>(null);
  // The replacement asked for, read when it closes: a close from a render
  // before the open state reached it must still answer the one on screen.
  const openNow = useRef<OpenReplacement | null>(null);

  /*
   * What the editor does once a plugin says what it did to the document: the
   * caches refresh exactly as after the built-in delete or update, through the
   * same functions those hooks call, and a deleted document is left. "changed"
   * reads it again, so the editor shows what the plugin wrote.
   */
  const documentChanged = (result: DocumentChangeResult): void => {
    if (result === "deleted") {
      refreshAfterEntryDelete(queryClient, collectionSlug, entryId);
      onDeleted?.();
      return;
    }
    refreshAfterEntryChange(queryClient, collectionSlug, entryId);
  };

  const openReplacement = (
    action: OverridableDocumentAction,
    component: string
  ): Promise<DocumentActionOutcome> => {
    // A second run of the open action joins it: one component is on screen,
    // so its callers share its answer. Another action waits for it to close.
    const current = openNow.current;
    if (current !== null) {
      return current.action === action
        ? current.answered
        : Promise.resolve(ANOTHER_OPEN);
    }
    // Answered when the component closes, with what it came to, so a caller
    // running Delete learns whether the document is gone.
    let answer: (outcome: DocumentActionOutcome) => void = () => {};
    const answered = new Promise<DocumentActionOutcome>(resolve => {
      answer = resolve;
    });
    const next = { action, component, answered, answer };
    openNow.current = next;
    setOpen(next);
    return answered;
  };

  const actionOverrides =
    isPending || isUnavailable
      ? heldUntilPluginsLoad()
      : overridesFor(surfaces.actions, openReplacement);

  const close = (result?: DocumentChangeResult): void => {
    const closing = openNow.current;
    openNow.current = null;
    setOpen(null);
    if (result !== undefined) documentChanged(result);
    closing?.answer(result === undefined ? BACKED_OUT : { ok: true });
  };

  return {
    actionOverrides,
    replacement:
      open === null || entryId === "" ? null : (
        <PluginSlot<DocumentActionReplacementProps>
          path={open.component}
          props={{ action: open.action, collectionSlug, entryId, close }}
        />
      ),
    sections: surfaces.sections,
    sectionProps:
      entryId === ""
        ? undefined
        : { collectionSlug, entryId, documentLock, documentChanged },
  };
}

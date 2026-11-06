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
import type { OverridableDocumentAction } from "nextly/config";
import { useMemo, useRef, useState, type JSX } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
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

/** A replacement on screen: which action, what it draws, whom to answer. */
interface OpenReplacement {
  action: OverridableDocumentAction;
  component: string;
  answer: (outcome: DocumentActionOutcome) => void;
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

  const actionOverrides = overridesFor(
    surfaces.actions,
    (action, component) =>
      // Answered when the component closes, with what it came to, so a caller
      // running Delete learns whether the document is gone.
      new Promise<DocumentActionOutcome>(answer => {
        const next = { action, component, answer };
        openNow.current = next;
        setOpen(next);
      })
  );

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

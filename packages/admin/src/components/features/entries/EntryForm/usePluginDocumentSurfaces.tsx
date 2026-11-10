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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
} from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { toast } from "@admin/components/ui";
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
  componentSettled,
  registryVersionNow,
  subscribeToRegistry,
} from "@admin/lib/plugins/component-registry-internal";
import {
  documentSurfacesFor,
  type CollectionDocumentSurfaces,
  type PluginPanelSectionEntry,
} from "@admin/lib/plugins/document-surfaces";

import type { DocumentLockGates } from "./document-lock-affordances";
import type {
  DocumentActionOutcome,
  DocumentActionOverride,
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
  /** The document it was opened for, which it acts on and nothing else. */
  collectionSlug: string;
  entryId: string;
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
 * What a row held before the plugin list is known says, in the two states it
 * can be in. One place for the words, so the rows, `run` and the docs read
 * the same. The failed one names the row's own action, from its label.
 */
const HELD_WORDS = {
  loading: (): string => "Loading this collection's plugin actions…",
  failed: (label: string): string =>
    `Couldn't load this collection's plugin actions, so ${label} is paused.`,
  retry: "Retry",
} as const;

/**
 * Every overridable action, held: it may be hidden or replaced on this
 * collection, and its built-in write must not run before that is known.
 * Loading, it says so and clears itself; failed, it says so with Retry, which
 * asks again: the list then reads as pending, so the rows read as loading.
 */
function heldUntilPluginsLoad(
  failed: boolean,
  retry: () => void
): DocumentActionOverrides {
  const held: DocumentActionOverride = failed
    ? {
        kind: "held",
        reason: HELD_WORDS.failed,
        retry: { label: HELD_WORDS.retry, onSelect: retry },
      }
    : { kind: "held", reason: HELD_WORDS.loading };
  return Object.fromEntries(
    OVERRIDABLE_DOCUMENT_ACTIONS.map(action => [action, held])
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
    overrides[action] = overrideFor(action, override, openReplacement);
  }
  return overrides;
}

/**
 * One action's override. A replacement whose component is still loading is
 * held with the loading words, as before the plugin list arrives: opened now,
 * it would be taken for a missing component and closed as failed.
 */
function overrideFor(
  action: OverridableDocumentAction,
  override: NonNullable<
    CollectionDocumentSurfaces["actions"][OverridableDocumentAction]
  >,
  openReplacement: (
    action: OverridableDocumentAction,
    component: string
  ) => Promise<DocumentActionOutcome>
): DocumentActionOverride {
  if (override === "hidden") return { kind: "hidden" };
  if (!componentSettled(override.component)) {
    return { kind: "held", reason: HELD_WORDS.loading };
  }
  return {
    kind: "replaced",
    ...(override.label === undefined ? {} : { label: override.label }),
    open: () => openReplacement(action, override.component),
  };
}

/** What the author is told when a plugin's replacement could not be drawn. */
const REPLACEMENT_FAILED =
  "This action couldn't open. Reload the page and try again.";

/**
 * Drawn where a replacement names a component nothing registered: closes it
 * as it mounts, which is the one moment the editor learns it drew nothing.
 */
function ClosesAsFailed({ onMount }: { onMount: () => void }): null {
  // Once, as it mounts: the replacement it stands for is then closed, and a
  // new `onMount` from a later render must not close the next one.
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    onMount();
  }, [onMount]);
  return null;
}

/** Whether a replacement was opened for this document, which must be saved. */
function isFor(
  request: OpenReplacement,
  collectionSlug: string,
  entryId: string
): boolean {
  return (
    entryId !== "" &&
    request.collectionSlug === collectionSlug &&
    request.entryId === entryId
  );
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

/**
 * What the editor does once a plugin says what it did to the document: the
 * caches refresh exactly as after the built-in delete or update, through the
 * same functions those hooks call, and a deleted document is left. "changed"
 * reads it again, so the editor shows what the plugin wrote.
 */
function useDocumentChanged({
  collectionSlug,
  entryId,
  onDeleted,
  onOwnChange,
}: {
  collectionSlug: string;
  entryId: string;
  onDeleted: (() => void) | undefined;
  onOwnChange: (() => void) | undefined;
}): (result: DocumentChangeResult) => void {
  const queryClient = useQueryClient();
  return result => {
    if (result === "deleted") {
      refreshAfterEntryDelete(queryClient, collectionSlug, entryId);
      onDeleted?.();
      return;
    }
    // The copy that arrives is the author's own change, so the form keeps
    // what they have not saved over it, as it does over its own save's echo,
    // rather than resetting to it as to someone else's. The form expects it
    // until a copy NEWER than the one on screen now arrives: a read that
    // started before the change, or one that failed, does not end it.
    onOwnChange?.();
    void refreshAfterEntryChange(queryClient, collectionSlug, entryId);
  };
}

/**
 * The replacement open on this document, if any, and how it is opened,
 * closed and failed: one request at a time, each answered once, bound to the
 * document it was opened for.
 */
function useReplacementRequests({
  collectionSlug,
  entryId,
  documentChanged,
}: {
  collectionSlug: string;
  entryId: string;
  documentChanged: (result: DocumentChangeResult) => void;
}): {
  open: OpenReplacement | null;
  openReplacement: (
    action: OverridableDocumentAction,
    component: string
  ) => Promise<DocumentActionOutcome>;
  closeRequest: (
    request: OpenReplacement,
    result?: DocumentChangeResult
  ) => void;
  failed: (request: OpenReplacement) => void;
} {
  const [open, setOpen] = useState<OpenReplacement | null>(null);
  // The replacement asked for, read when it closes: a close from a render
  // before the open state reached it must still answer the one on screen.
  const openNow = useRef<OpenReplacement | null>(null);
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
    const next = {
      action,
      component,
      collectionSlug,
      entryId,
      answered,
      answer,
    };
    openNow.current = next;
    setOpen(next);
    return answered;
  };

  /*
   * Closes `request`, with what it came to, if it is still the one open: a
   * close the component calls again after it closed, once another has opened,
   * is ignored rather than closing that one and applying a stale result.
   */
  const closeRequest = (
    request: OpenReplacement,
    result?: DocumentChangeResult
  ): void => {
    if (openNow.current !== request) return;
    openNow.current = null;
    setOpen(null);
    // Applied only to the document it was opened for, which is still the
    // one on screen: a request for another is cancelled below first.
    const onItsDocument = isFor(request, collectionSlug, entryId);
    if (result !== undefined && onItsDocument) documentChanged(result);
    request.answer(
      result === undefined || !onItsDocument ? BACKED_OUT : { ok: true }
    );
  };

  /*
   * The plugin's component could not be drawn: it names nothing registered,
   * or it threw. It can never call `close`, so the editor closes it, says so,
   * and answers the run as cancelled, or every caller would wait forever and
   * every other replaced action would answer busy.
   */
  const failed = (request: OpenReplacement): void => {
    if (openNow.current !== request) return;
    toast.error(REPLACEMENT_FAILED);
    closeRequest(request);
  };

  // Moving to another document while a replacement is open cancels it: it
  // was opened for the document it names, and must not act on the next one.
  useEffect(() => {
    const current = openNow.current;
    if (current !== null && !isFor(current, collectionSlug, entryId)) {
      closeRequest(current);
    }
  });

  return { open, openReplacement, closeRequest, failed };
}

/**
 * A section's report, bound to the document it was drawn for: the entry,
 * in this editor while it is mounted, and for a change the language it was
 * drawn in too (a deletion removes the entry in every language). A section
 * keeps the props it was drawn with, so a report can arrive once another
 * document is on screen, or once this editor is gone. Then the reported
 * document's own caches are still refreshed, since what the plugin did to it
 * stands, and nothing else happens: no redirect from a "deleted", and no
 * own-change expectation armed on the document now shown from a "changed".
 */
function useBoundSectionReport({
  collectionSlug,
  entryId,
  locale,
  documentChanged,
}: {
  collectionSlug: string;
  entryId: string;
  locale: string | undefined;
  documentChanged: (result: DocumentChangeResult) => void;
}): (result: DocumentChangeResult) => void {
  const queryClient = useQueryClient();
  const shown = { collectionSlug, entryId, locale: locale ?? null };
  // The document on screen, as the editor last COMMITTED it, and whether this
  // editor still is: set as the commit lands, not while rendering, so a
  // render React abandons cannot move it; its cleanup ends it, so a report
  // kept past an unmount is never this one's. The first render's value holds
  // until then: an editor whose first render is abandoned is never mounted.
  const shownNow = useRef<typeof shown | null>(shown);
  useLayoutEffect(() => {
    shownNow.current = { collectionSlug, entryId, locale: locale ?? null };
    return () => {
      shownNow.current = null;
    };
  }, [collectionSlug, entryId, locale]);
  return result => {
    const now = shownNow.current;
    // Deleting removes the entry in every language, so a deletion reported
    // from the entry in another language still leaves it. A change is the
    // language's own: only one reported in the language on screen is taken
    // for the author's, since it arms the expectation on that language.
    const sameEntry =
      now !== null &&
      now.collectionSlug === shown.collectionSlug &&
      now.entryId === shown.entryId;
    const stillShown =
      sameEntry && (result === "deleted" || now.locale === shown.locale);
    if (stillShown) {
      documentChanged(result);
      return;
    }
    // The reported document's caches, and nothing the screen shows now.
    if (result === "deleted") {
      refreshAfterEntryDelete(queryClient, shown.collectionSlug, shown.entryId);
    } else {
      void refreshAfterEntryChange(
        queryClient,
        shown.collectionSlug,
        shown.entryId
      );
    }
  };
}

/**
 * The open replacement, drawn with the identity it was opened for and the
 * document's live gates. An unregistered component or one that throws is
 * closed as failed, so its run is answered rather than left waiting.
 */
function replacementElement(
  open: OpenReplacement,
  {
    documentLock,
    mayWrite,
    close,
    fail,
  }: {
    documentLock: DocumentLockGates;
    mayWrite: () => boolean;
    close: (result?: DocumentChangeResult) => void;
    fail: () => void;
  }
): JSX.Element {
  return (
    <PluginSlot<DocumentActionReplacementProps>
      path={open.component}
      props={{
        action: open.action,
        collectionSlug: open.collectionSlug,
        entryId: open.entryId,
        documentLock,
        mayWrite,
        close,
      }}
      fallback={<ClosesAsFailed onMount={fail} />}
      // Nothing drawn in its place: the editor closes it at once.
      errorFallback={null}
      onError={fail}
    />
  );
}

export function usePluginDocumentSurfaces({
  collectionSlug,
  entryId,
  documentLock,
  mayWrite,
  onDeleted,
  onOwnChange,
  locale,
}: {
  collectionSlug: string;
  /** The saved document's id, or "" before it is saved. */
  entryId: string;
  /**
   * The language being edited: part of which document a section was drawn
   * for, as it is of the form's own idea of the document.
   */
  locale?: string | undefined;
  /** What holds the document right now, as a section is told. */
  documentLock: DocumentLockGates;
  /**
   * Whether the document may be written at this instant, read as the
   * editor's own write gate reads it: for a plugin to ask immediately before
   * its write, after anything it awaited.
   */
  mayWrite: () => boolean;
  /** Leaves the document once a plugin removed it, as the built-in Delete does. */
  onDeleted: (() => void) | undefined;
  /**
   * Tells the form the next copy of the document is this author's own change,
   * made by a plugin: it keeps the unsaved edits over it and starts from it,
   * as after its own save. Answers how to stop expecting it.
   */
  onOwnChange?: () => void;
}): PluginDocumentSurfaces {
  const { plugins } = useBranding();
  // Until the list has arrived, an absent override says nothing: the plugin
  // that overrides an action may simply not be known yet.
  const { isPending, isUnavailable, retry } = useBrandingStatus();
  const surfaces = useMemo(
    () => documentSurfacesFor(plugins, collectionSlug),
    [plugins, collectionSlug]
  );
  // Drawn again whenever a component arrives or a plugin module's loading
  // ends: registration runs after the first render, and nothing else would
  // draw a surface whose component arrived since.
  useSyncExternalStore(
    subscribeToRegistry,
    registryVersionNow,
    registryVersionNow
  );
  const documentChanged = useDocumentChanged({
    collectionSlug,
    entryId,
    onDeleted,
    onOwnChange,
  });

  const sectionDocumentChanged = useBoundSectionReport({
    collectionSlug,
    entryId,
    locale,
    documentChanged,
  });

  const { open, openReplacement, closeRequest, failed } =
    useReplacementRequests({ collectionSlug, entryId, documentChanged });

  const actionOverrides =
    isPending || isUnavailable
      ? heldUntilPluginsLoad(isUnavailable && !isPending, retry)
      : overridesFor(surfaces.actions, openReplacement);

  return {
    actionOverrides,
    // Drawn only on the document it was opened for, with that document's
    // identity: on another, it is not drawn while it is being cancelled.
    replacement:
      open === null || !isFor(open, collectionSlug, entryId)
        ? null
        : replacementElement(open, {
            documentLock,
            mayWrite,
            close: result => closeRequest(open, result),
            fail: () => failed(open),
          }),
    // Each with whether its component is still loading, so the panel draws
    // it as loading rather than blank until the component arrives.
    sections: surfaces.sections.map(section => ({
      ...section,
      loading: !componentSettled(section.component),
    })),
    sectionProps:
      entryId === ""
        ? undefined
        : {
            collectionSlug,
            entryId,
            documentLock,
            mayWrite,
            documentChanged: sectionDocumentChanged,
          },
  };
}

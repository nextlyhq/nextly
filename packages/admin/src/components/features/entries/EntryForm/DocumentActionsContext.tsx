"use client";

/**
 * The document's actions, decided once for everything the editor draws.
 *
 * The editor hosting the form renders `DocumentActionsHost` around both the
 * ordinary body and a plugin's document view, so a view that replaces the body
 * still offers — and runs — exactly the actions the header would, and the
 * questions an action asks first are drawn whichever surface asked them.
 *
 * Rendered INSIDE the editor's leave guard and history context rather than in
 * the editor's own body: deciding the actions reads both, and the guard's
 * "this leave is deliberate" is a no-op outside it, so Discard changes would
 * warn about the very changes it was asked to discard.
 *
 * @module components/features/entries/EntryForm/DocumentActionsContext
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";

import { DocumentActionConfirmations } from "./DocumentActionConfirmations";
import { hasPendingWorkingDraft } from "./EntryFormContext";
import {
  EntryFormProvider,
  type EntryFormProviderProps,
} from "./EntryFormProvider";
import type { RecoveryPointState, StoredDocument } from "./SaveStateIndicator";
import { useReportUnsavedWork } from "./UnsavedWorkContext";
import {
  useDocumentActionBindings,
  type DocumentActionBindings,
  type DocumentActionBindingsInput,
} from "./useDocumentActionBindings";

const DocumentActionsContext = createContext<DocumentActionBindings | null>(
  null
);

/** No recovery point is recorded: a host that keeps none. */
const NO_RECOVERY_POINT: RecoveryPointState = {
  enabled: false,
  storedAt: null,
  pendingOfferAt: null,
};

/**
 * The document's recovery point, beside its actions, so a surface that draws
 * the save state without the header reads the same one the header's chip
 * reads: a recovery point newer than the stored document keeps the work
 * "unsaved" wherever the save state is shown.
 */
const RecoveryPointContext =
  createContext<RecoveryPointState>(NO_RECOVERY_POINT);

/**
 * How the hosted document stands in storage, so a surface can report it saved
 * from the moment it opens. Null for a new document, or one with no readable
 * time.
 */
const StoredContext = createContext<StoredDocument | null>(null);

/**
 * How a document as read stands in storage. A pending working draft is stored,
 * but its row's `updatedAt` is the published version's (a draft save leaves it
 * frozen), so its time is unknown rather than wrong.
 */
function storedStateOf(
  entry: DocumentActionBindingsInput["entry"]
): StoredDocument | null {
  const updatedAt = entry?.updatedAt;
  if (updatedAt === undefined) return null;
  const time = Date.parse(updatedAt);
  if (Number.isNaN(time)) return null;
  return { at: hasPendingWorkingDraft(entry) ? null : new Date(time) };
}

export function DocumentActionsHost({
  input,
  recovery = NO_RECOVERY_POINT,
  children,
}: {
  input: DocumentActionBindingsInput;
  /** The document's recovery point, for a save state drawn without the header. */
  recovery?: RecoveryPointState;
  children: ReactNode;
}): JSX.Element {
  const documentActions = useDocumentActionBindings(input);
  /*
   * A write the document depends on, still on its way, is unsaved work: the
   * page would be left with it unfinished. Reported here, where the writes
   * are tracked for as long as the form lives, so the leave guard asks even
   * after the surface that started one (the page builder) has closed.
   */
  useReportUnsavedWork("tracked-writes", documentActions.writesPending);
  const { entry } = input;
  const stored = useMemo(() => storedStateOf(entry), [entry]);
  return (
    <DocumentActionsContext.Provider value={documentActions}>
      <RecoveryPointContext.Provider value={recovery}>
        <StoredContext.Provider value={stored}>
          {children}
        </StoredContext.Provider>
      </RecoveryPointContext.Provider>
      <DocumentActionConfirmations
        confirmations={documentActions.confirmations}
        entry={input.entry}
        isSubmitting={input.isSubmitting}
      />
    </DocumentActionsContext.Provider>
  );
}

/** The document's recovery point, or none outside a host that records one. */
export function useHostedRecoveryPoint(): RecoveryPointState {
  return useContext(RecoveryPointContext);
}

/** How the hosted document stands in storage, or null outside a host. */
export function useHostedStored(): StoredDocument | null {
  return useContext(StoredContext);
}

/**
 * Hands the host's Save that never publishes to the editor rendering the
 * host, which sits above it: a refused publish's way out stores the form
 * with it, as the Save control would, rather than with a write of its own.
 *
 * Rendered inside `DocumentActionsHost`, which is where the Save lives.
 */
export function SaveWithoutPublishingBridge({
  into,
}: {
  into: RefObject<DocumentActionBindings["saveWithoutPublishing"] | undefined>;
}): null {
  const { saveWithoutPublishing } = useHostedDocumentActions();
  // After every commit, so the editor runs the Save of the render on screen.
  useLayoutEffect(() => {
    into.current = saveWithoutPublishing;
  });
  return null;
}

/**
 * The editor's keyboard shortcuts, with Mod+S running the document's Save.
 *
 * The Save action, not a save of its own: the shortcut used to pick its submit
 * intent by a rule written beside the header's, and two rules for one question
 * agree only until one of them changes. Running the action also means the
 * shortcut is refused for exactly the reasons the control is.
 *
 * Rendered inside `DocumentActionsHost`, which is where the action lives.
 */
export function DocumentSaveShortcuts({
  onCancel,
  hasUnsavedWork,
  isSubmitting,
}: {
  /** Escape, where the surface does not own it. */
  onCancel?: () => void;
  /**
   * Includes work a field holds. Without it the save shortcut DECLINES inside
   * the page builder — correctly, on a flag that cannot be true there — which
   * reads to an author as the shortcut being broken.
   */
  hasUnsavedWork: boolean;
  isSubmitting: boolean;
}): null {
  const { run } = useHostedDocumentActions();
  useEntryFormShortcuts({
    onSave: () => {
      void run("save");
    },
    onCancel,
    isDirty: hasUnsavedWork,
    isSubmitting,
  });
  return null;
}

/**
 * The entry form element, whose native submit runs the document's Save.
 *
 * A native submit is Enter in a field, or the submit-typed Save of a
 * collection without a status. Both used to call the form's submit handler
 * directly, so they skipped what Save waits for — an editor's open edit, a
 * tracked write — and Enter saved with no intent where the shortcut and the
 * button name one. Through the action they store exactly what Mod+S does:
 * the save the document's state calls for, never Publish, even where Publish
 * leads. Whether Enter submits at all is the browser's and the fields' call,
 * and unchanged.
 */
export function SaveActionFormProvider({
  form,
  formId,
  className,
  recovering,
  children,
}: Omit<EntryFormProviderProps, "onSubmit">): JSX.Element {
  const { run } = useHostedDocumentActions();
  return (
    <EntryFormProvider
      form={form}
      {...(formId === undefined ? {} : { formId })}
      {...(className === undefined ? {} : { className })}
      {...(recovering === undefined ? {} : { recovering })}
      onSubmit={async event => {
        // Prevented before anything else: returning without it lets the
        // browser submit natively, reloading the page.
        event?.preventDefault();
        await run("save");
      }}
    >
      {children}
    </EntryFormProvider>
  );
}

/**
 * The document's actions, or null outside a document editor: a surface that
 * can also be drawn elsewhere has to say what it offers there itself.
 */
export function useDocumentActionsContext(): DocumentActionBindings | null {
  return useContext(DocumentActionsContext);
}

/**
 * The document's actions, for a surface that only exists inside a document
 * editor. Drawn anywhere else it has no actions to offer and no document to
 * run them on, which is a mistake in the caller rather than a state to draw.
 */
export function useHostedDocumentActions(): DocumentActionBindings {
  const documentActions = useContext(DocumentActionsContext);
  if (documentActions === null) {
    throw new Error(
      "useHostedDocumentActions must be used inside DocumentActionsHost, which the entry and Single editors render around their body."
    );
  }
  return documentActions;
}

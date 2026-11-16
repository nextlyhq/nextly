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
  useState,
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
  type PendingRecovery,
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
 * How a document view hands its recovery offer up to the actions, and how its
 * save chip says it is drawn. Save keeps the offer (see `pendingRecovery`)
 * only while both hold: the offer is made below the host, in the view's body,
 * and the actions are decided here, above it. A view with no save chip leaves
 * the offer to its banner, and its Save waits for an edit.
 */
interface PendingRecoverySlot {
  offer: (recovery: PendingRecovery | null) => void;
  /** Marks a save chip as drawn; returns the release for when it goes. */
  chipDrawn: () => () => void;
}

const PendingRecoveryContext = createContext<PendingRecoverySlot | null>(null);

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
  // Handed up by a document view's body, and kept by Save only while the
  // view draws a save chip; see `PendingRecoverySlot`.
  const [offered, setOffered] = useState<PendingRecovery | null>(null);
  const [chips, setChips] = useState(0);
  const slot = useMemo<PendingRecoverySlot>(
    () => ({
      offer: setOffered,
      chipDrawn: () => {
        setChips(count => count + 1);
        return () => setChips(count => count - 1);
      },
    }),
    []
  );
  const documentActions = useDocumentActionBindings({
    ...input,
    pendingRecovery: chips > 0 ? offered : null,
  });
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
          <PendingRecoveryContext.Provider value={slot}>
            {children}
          </PendingRecoveryContext.Provider>
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

/**
 * Offers the actions a recovery point their Save can keep, for as long as the
 * caller is mounted and passes one; see `PendingRecoverySlot`. For a document
 * view's body. Nothing outside a host.
 */
export function useOfferPendingRecovery(
  recovery: PendingRecovery | null
): void {
  const slot = useContext(PendingRecoveryContext);
  // A layout effect, so Save is offered in the same paint as the chip.
  useLayoutEffect(() => {
    if (slot === null) return;
    slot.offer(recovery);
    return () => slot.offer(null);
  }, [slot, recovery]);
}

/**
 * Marks the document's save chip as drawn, for as long as the caller is
 * mounted: the chip makes the recovery offer, so Save may keep it; see
 * `PendingRecoverySlot`. Nothing outside a host.
 */
export function useSaveChipDrawn(): void {
  const slot = useContext(PendingRecoveryContext);
  useLayoutEffect(() => slot?.chipDrawn(), [slot]);
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
  const { run, keepsOffer } = useHostedDocumentActions();
  useEntryFormShortcuts({
    onSave: () => {
      void run("save");
    },
    onCancel,
    // Changes on offer that Save keeps are work to save, as the control says.
    isDirty: hasUnsavedWork || keepsOffer,
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

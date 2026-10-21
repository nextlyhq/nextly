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
import { createContext, useContext, type ReactNode } from "react";

import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";

import { DocumentActionConfirmations } from "./DocumentActionConfirmations";
import {
  EntryFormProvider,
  type EntryFormProviderProps,
} from "./EntryFormProvider";
import {
  useDocumentActionBindings,
  type DocumentActionBindings,
  type DocumentActionBindingsInput,
} from "./useDocumentActionBindings";

const DocumentActionsContext = createContext<DocumentActionBindings | null>(
  null
);

export function DocumentActionsHost({
  input,
  children,
}: {
  input: DocumentActionBindingsInput;
  children: ReactNode;
}) {
  const documentActions = useDocumentActionBindings(input);
  return (
    <DocumentActionsContext.Provider value={documentActions}>
      {children}
      <DocumentActionConfirmations
        confirmations={documentActions.confirmations}
        entry={input.entry}
        isSubmitting={input.isSubmitting}
      />
    </DocumentActionsContext.Provider>
  );
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
  children,
}: Omit<EntryFormProviderProps, "onSubmit">) {
  const { run } = useHostedDocumentActions();
  return (
    <EntryFormProvider
      form={form}
      {...(formId === undefined ? {} : { formId })}
      {...(className === undefined ? {} : { className })}
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

"use client";

/**
 * The release page's "add documents" dialog, with its code fetched when it
 * first opens: it is a picker most visits to a release never open.
 *
 * @module components/features/releases/LazyAddDocumentsDialog
 */

import type { JSX } from "react";

import {
  ModalAwaitingCode,
  useHasOpened,
} from "@admin/components/shared/modal-awaiting-code";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { AddDocumentsDialogProps } from "./AddDocumentsDialog";
import { useReturnFocusOnClose } from "./dialog-opener";

const addDocumentsModule = retryableModule(() =>
  import("./AddDocumentsDialog").then(m => m.AddDocumentsDialog)
);

function LoadedAddDocumentsDialog(props: AddDocumentsDialogProps): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    addDocumentsModule,
    "The add documents dialog's code"
  );
  if (state.status === "ok") {
    const AddDocumentsDialog = state.value;
    return <AddDocumentsDialog {...props} />;
  }
  return (
    <ModalAwaitingCode
      open={props.open}
      onOpenChange={props.onOpenChange}
      className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      {...(props.returnFocus ? { onCloseAutoFocus: props.returnFocus } : {})}
      failure={
        state.status === "error"
          ? { exhausted: attempt > 0, onRetry: retry }
          : null
      }
    />
  );
}

export function LazyAddDocumentsDialog(
  props: AddDocumentsDialogProps
): JSX.Element | null {
  // The opener is read here, in the render the click causes: this component
  // is on the page before the dialog opens, while the dialog that stands in
  // for the code takes focus as it opens, so the real dialog, rendered after
  // the code arrives, would find that stand-in focused instead.
  const returnFocus = useReturnFocusOnClose(props.open);
  return useHasOpened(props.open) ? (
    <LoadedAddDocumentsDialog {...props} returnFocus={returnFocus} />
  ) : null;
}

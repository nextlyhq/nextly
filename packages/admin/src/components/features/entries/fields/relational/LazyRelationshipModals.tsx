"use client";

/**
 * The relationship field's create and edit modals, with their code fetched
 * when one first opens.
 *
 * Both embed the whole entry form. Imported statically they put the form in
 * every bundle that draws a relationship field, the version pages' read-only
 * one included, and a person who never opens a modal paid for it. Until the
 * code arrives the modal is already on screen with the loading state its own
 * content draws, so a click is answered at once; a failed fetch is said there
 * too, with a way to try again, and leaves the document underneath alone.
 *
 * @module components/features/entries/fields/relational/LazyRelationshipModals
 */

import type { JSX } from "react";

import {
  ModalAwaitingCode,
  useHasOpened,
} from "@admin/components/shared/modal-awaiting-code";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";

import type { RelationshipCreateModalProps } from "./RelationshipCreateModal";
import type { RelationshipQuickEditProps } from "./RelationshipQuickEdit";

const createModalModule = retryableModule(() =>
  import("./RelationshipCreateModal").then(m => m.RelationshipCreateModal)
);
const quickEditModule = retryableModule(() =>
  import("./RelationshipQuickEdit").then(m => m.RelationshipQuickEdit)
);

/** The create modal once it has first been opened, its code fetched then. */
function LoadedCreateModal(props: RelationshipCreateModalProps): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    createModalModule,
    "The relationship create form's code"
  );
  if (state.status === "ok") {
    const RelationshipCreateModal = state.value;
    return <RelationshipCreateModal {...props} />;
  }
  return (
    <ModalAwaitingCode
      size="xl"
      open={props.open}
      onOpenChange={props.onOpenChange}
      failure={
        state.status === "error"
          ? { exhausted: attempt > 0, onRetry: retry }
          : null
      }
    />
  );
}

/**
 * Draws nothing until first opened, so a field whose modal is never used never
 * fetches it, and stays mounted afterwards so closing still animates.
 */
export function LazyRelationshipCreateModal(
  props: RelationshipCreateModalProps
): JSX.Element | null {
  return useHasOpened(props.open) ? <LoadedCreateModal {...props} /> : null;
}

/** The quick edit modal, mounted by its field only while an item is chosen. */
export function LazyRelationshipQuickEdit(
  props: RelationshipQuickEditProps
): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    quickEditModule,
    "The relationship edit form's code"
  );
  if (state.status === "ok") {
    const RelationshipQuickEdit = state.value;
    return <RelationshipQuickEdit {...props} />;
  }
  return (
    <ModalAwaitingCode
      size="xl"
      open={props.open}
      onOpenChange={props.onOpenChange}
      failure={
        state.status === "error"
          ? { exhausted: attempt > 0, onRetry: retry }
          : null
      }
    />
  );
}

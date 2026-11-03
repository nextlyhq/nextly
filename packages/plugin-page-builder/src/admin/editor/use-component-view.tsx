"use client";

/**
 * The editor's part in "Edit component": the way into a placed component's
 * own view, and, in that view, the banner that names it, says how far a
 * change reaches and leads back.
 *
 * Gathered here so the editor asks one hook, and both halves read the same
 * answers: the author's grant, the component library and the component's
 * facts, which the mount reads once and hands in.
 *
 * @module admin/editor/use-component-view
 */
import {
  isComponentDocument,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  ComponentBanner,
  type ComponentFieldsHost,
  type EditorState,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useState, type JSX } from "react";

import type { ComponentLibraryRead } from "../component-library-client";
import { useComponentEditing } from "../pattern-capability-client";

import {
  isStoreRow,
  openDocument,
  returnFromSearch,
  useEditComponent,
} from "./edit-component";

/** What the editor draws and hands on for "Edit component". */
export interface ComponentView {
  /**
   * Opens a component in its own view, from a placement when `nodeId` names
   * one; absent where not offered.
   */
  readonly onEditComponent:
    | ((componentId: string, nodeId?: string) => void)
    | undefined;
  /** The banner over a component's own view; nothing over a page. */
  readonly banner: JSX.Element | null;
}

export function useComponentView({
  initialDocument,
  editor,
  componentLibrary,
  fieldName,
  componentFacts,
}: {
  initialDocument: BlockDocument;
  editor: EditorState;
  componentLibrary: ComponentLibraryRead;
  /** The blocks field the editor is bound to. */
  fieldName: string | undefined;
  /**
   * What the component's live definition holds and how many documents place
   * it, read by the mount for a component with a row; nothing for a page.
   */
  componentFacts: ComponentFieldsHost | undefined;
}): ComponentView {
  const isSection = useCallback(
    (nodeId: string) => editor.document.nodes.some(node => node.id === nodeId),
    [editor.document]
  );
  const onEditComponent = useEditComponent(isSection);

  const identity = useDocumentIdentity();
  // The component's row, when the document is a component that has one.
  const componentId = isComponentDocument(initialDocument)
    ? identity?.documentId
    : undefined;
  // The banner speaks for a row of the component STORE only. Another
  // collection may declare a field of component documents, and its entry ids
  // name nothing in the store.
  const editing = useComponentEditing();
  const inStore = isStoreRow(identity, editing, fieldName);
  // Read once, as the view opens: the address it came from, checked to be an
  // admin path. A later change to the address is the author's own moving.
  const [returnTo] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : returnFromSearch(window.location.search)
  );
  const banner =
    componentId === undefined || !inStore ? null : (
      <ComponentBanner
        name={
          componentLibrary.components.find(row => row.id === componentId)?.title
        }
        reach={componentFacts?.reach}
        onBack={
          returnTo === undefined ? undefined : () => openDocument(returnTo)
        }
      />
    );
  return { onEditComponent, banner };
}

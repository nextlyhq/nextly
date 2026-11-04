"use client";

/**
 * The editor's part in "Edit component": the way into a placed component's
 * own view, and, in that view, the banner that names it, says how many pages
 * a change reaches and leads back to the document it names.
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
  useVariantPreview,
  type ComponentFieldsHost,
  type EditorState,
  type VariantPreviewState,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import type * as React from "react";
import { useCallback, useState, type JSX } from "react";

import type { ComponentLibraryRead } from "../component-library-client";
import { useComponentEditing } from "../pattern-capability-client";

import {
  isStoreRow,
  openDocument,
  returnFromSearch,
  returnLabelFromSearch,
  useEditComponent,
} from "./edit-component";

/** What Back says it returns to when the address names no document. */
const UNNAMED_RETURN = "the page";

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
  /**
   * Whether the banner offers the way back. While it does, the editor's own
   * exit arrow is withheld, so the view has ONE Back.
   */
  readonly offersBack: boolean;
  /** The variant open in the view, which the canvas previews. */
  readonly preview: PreviewedEditing;
}

/** The editor's inline typing, as the mount hands it out. */
interface InlineTyping {
  readonly begin: (nodeId: string) => boolean;
  readonly onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

/** The open variant's preview, with the canvas typing it allows. */
export interface PreviewedEditing extends VariantPreviewState {
  /** Typing into a block from the keyboard; withheld while previewing. */
  readonly onEditText: ((nodeId: string) => boolean) | undefined;
  /** Typing into a block from a double click; withheld while previewing. */
  readonly onDoubleClick:
    | ((event: React.MouseEvent<HTMLDivElement>) => void)
    | undefined;
}

/**
 * The variant open in a component's view, and typing into the canvas
 * withheld while it is previewed: the canvas then shows the variant's values,
 * and typing there would write the component's own value under them, where
 * the author cannot see it land.
 */
function usePreviewedEditing(
  document: BlockDocument,
  inline: InlineTyping
): PreviewedEditing {
  const preview = useVariantPreview(document);
  const typing = preview.previewing === undefined;
  return {
    ...preview,
    onEditText: typing ? inline.begin : undefined,
    onDoubleClick: typing ? inline.onDoubleClick : undefined,
  };
}

/** Where Back goes and what it says, from the view's own address. */
type Back = { readonly to: string; readonly onBack: () => void } | undefined;

/**
 * The way back the view's address names: a checked admin path, and the
 * name it is said by as plain words, never a target.
 */
function readBack(): Back {
  if (typeof window === "undefined") return undefined;
  const returnTo = returnFromSearch(window.location.search);
  if (returnTo === undefined) return undefined;
  return {
    to: returnLabelFromSearch(window.location.search) ?? UNNAMED_RETURN,
    onBack: () => openDocument(returnTo),
  };
}

/** The banner over the view: the component, the pages it reaches, Back. */
function bannerFor(
  name: string | undefined,
  facts: ComponentFieldsHost | undefined,
  back: Back
): JSX.Element {
  return <ComponentBanner name={name} pages={facts?.pages} back={back} />;
}

export function useComponentView({
  initialDocument,
  editor,
  componentLibrary,
  fieldName,
  componentFacts,
  here,
  inline,
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
  /** The open document's name, which Back from a component opened here says. */
  here: string | undefined;
  /** The editor's inline typing, withheld while a variant is previewed. */
  inline: InlineTyping;
}): ComponentView {
  const isSection = useCallback(
    (nodeId: string) => editor.document.nodes.some(node => node.id === nodeId),
    [editor.document]
  );
  const onEditComponent = useEditComponent(isSection, here);

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
  // admin path, and the name it is said by. A later change to the address is
  // the author's own moving.
  const [back] = useState(readBack);
  const showsBanner = componentId !== undefined && inStore;
  return {
    onEditComponent,
    banner: showsBanner
      ? bannerFor(
          componentLibrary.components.find(row => row.id === componentId)
            ?.title,
          componentFacts,
          back
        )
      : null,
    offersBack: showsBanner && back !== undefined,
    preview: usePreviewedEditing(editor.document, inline),
  };
}

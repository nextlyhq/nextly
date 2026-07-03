"use client";

/**
 * The full-screen page editor, mounted as the `pages` collection Edit-view override.
 * Renders inside the admin content area. Loads the stored block tree (or an empty one),
 * wires the store + canvas + save shell.
 */
import { makeNode } from "../core/tree";
import type { BlockDocument } from "../core/types";
import "../render/blocks"; // register block renderers so the canvas + store defaults work

import { EditorSurface } from "./EditorSurface";
import { SaveShell } from "./SaveShell";
import { EditorProvider, draftKeyFor } from "./store/EditorProvider";
import type { CustomEditViewProps } from "./types";

function emptyDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

export function PageBuilderEditView(props: CustomEditViewProps) {
  const data = props.initialData ?? {};
  const doc = (data.content as BlockDocument | undefined) ?? emptyDoc();

  return (
    <EditorProvider
      document={doc}
      draftKey={draftKeyFor(props.collectionSlug, props.entryId)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SaveShell props={props} />
        <EditorSurface />
      </div>
    </EditorProvider>
  );
}

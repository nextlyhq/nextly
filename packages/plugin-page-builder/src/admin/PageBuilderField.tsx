"use client";

/**
 * The page-builder editor mounted as a custom collection/single field (spec §9/§11).
 * Nextly's FieldRenderer renders this via `admin.component` (D24) inside a PluginSlot,
 * passing react-hook-form `{ control, name }`. We bridge RHF ↔ the editor: `useController`
 * reads the stored BlockDocument, and `EditorProvider.onDocumentChange` pushes edits back
 * into the form so the HOST form's save persists them (no SaveShell here).
 */
import { useController, type Control } from "react-hook-form";

import { makeNode } from "../core/tree";
import type { BlockDocument } from "../core/types";

import { EditorSurface } from "./EditorSurface";
import { draftKeyFor, EditorProvider } from "./store/EditorProvider";

export interface PageBuilderFieldProps {
  /** Form path (react-hook-form) for this field. */
  name: string;
  /** react-hook-form control, injected by the host FieldRenderer. */
  control: Control;
  field?: { label?: string };
}

function emptyDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

function isDocument(v: unknown): v is BlockDocument {
  return (
    typeof v === "object" &&
    v !== null &&
    "root" in v &&
    typeof (v as { root?: unknown }).root === "object"
  );
}

export function PageBuilderField({ name, control }: PageBuilderFieldProps) {
  const { field } = useController({ control, name });
  const doc = isDocument(field.value) ? field.value : emptyDoc();

  return (
    <EditorProvider
      document={doc}
      draftKey={draftKeyFor("field", name)}
      onDocumentChange={next => field.onChange(next)}
    >
      <EditorSurface />
    </EditorProvider>
  );
}

"use client";

/**
 * The page-builder editor mounted as a custom collection/single field (spec §9/§11).
 * Nextly's FieldRenderer renders this via `admin.component` (D24) inside a PluginSlot,
 * passing react-hook-form `{ control, name }`. We bridge RHF ↔ the editor: `useController`
 * reads the stored BlockDocument, and `EditorProvider.onDocumentChange` pushes edits back
 * into the form so the HOST form's save persists them (no SaveShell here).
 *
 * If the host entity also has a `customCss` field (the plugin's own `pages` collection
 * does), the builder's Page settings panel edits it through the same bridge; without one
 * the panel stays hidden — there is nowhere to persist page CSS.
 */
import { useController, useWatch, type Control } from "react-hook-form";

import { PAGE_BUILDER_CUSTOM_CSS_FIELD } from "../collections/pageBuilderEntry";
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

/** Field mount with the page-CSS bridge — only rendered when the host form actually
 *  has a `customCss` value, so `useController` never registers a phantom field. */
function FieldEditorWithCss({ name, control }: PageBuilderFieldProps) {
  const { field } = useController({ control, name });
  const { field: cssField } = useController({
    control,
    name: PAGE_BUILDER_CUSTOM_CSS_FIELD,
  });
  const doc = isDocument(field.value) ? field.value : emptyDoc();

  return (
    <EditorProvider
      document={doc}
      draftKey={draftKeyFor("field", name)}
      customCss={typeof cssField.value === "string" ? cssField.value : ""}
      onDocumentChange={next => field.onChange(next)}
      onCustomCssChange={css => cssField.onChange(css)}
    >
      <EditorSurface />
    </EditorProvider>
  );
}

function FieldEditor({ name, control }: PageBuilderFieldProps) {
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

export function PageBuilderField({ name, control }: PageBuilderFieldProps) {
  // Detect a sibling customCss field without registering it: useWatch is read-only.
  // A string (even "") means the host entity defines the field; undefined means not.
  const cssValue = useWatch({ control, name: PAGE_BUILDER_CUSTOM_CSS_FIELD });
  const Editor =
    typeof cssValue === "string" ? FieldEditorWithCss : FieldEditor;
  return <Editor name={name} control={control} />;
}

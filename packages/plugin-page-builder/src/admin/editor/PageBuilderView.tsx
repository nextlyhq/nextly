"use client";

/**
 * The Page Builder as a document view: the screen the admin draws at
 * `/admin/collections/<slug>/<id>/builder` (or a Single's own address) for one
 * blocks field of the document.
 *
 * The admin holds everything around it — the document, its form, its lock, the
 * recovery offer, the leave guard and saving — so this binds the editor to the
 * field through the form's own `control` and draws nothing else. Leaving goes
 * through the view's `exit`, back to the document's edit form, which keeps the
 * same form mounted.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/PageBuilderView
 */
import type { DocumentViewProps } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";
import { useController } from "react-hook-form";

import { acceptedKinds } from "../../fields/blocks-options";
import { PageBuilderCard } from "../PageBuilderCard";
import { useRestingPageRender } from "../use-resting-page-render";

import { BlocksEditor } from "./BlocksEditor";
import { documentFrom, PLUGIN_SOURCE } from "./stored-document";

type BoundProps = Pick<DocumentViewProps, "control" | "exit"> & {
  field: NonNullable<DocumentViewProps["field"]>;
  /** The field's name in the document form, which is what binds to it. */
  name: string;
};

/** The editor, bound to the field the view opened for. */
function BoundEditor({ control, exit, field: declaration, name }: BoundProps) {
  const { field } = useController({ name, control });
  return (
    <BlocksEditor
      // No key from the value: the editor seeds its own history from the value
      // it opened with, and keying it by whether that value exists remounted it
      // on its own first commit into an empty field, losing its history. A
      // value replaced from outside — a restore — arrives with a fresh mount
      // of the whole view, which the admin gives it.
      initialValue={field.value}
      // What an empty document has to be for this field, read from its own
      // declaration: a component store seeded as a page is refused on save.
      kinds={acceptedKinds(declaration)}
      onCommit={field.onChange}
      onClose={exit}
      name={name}
      control={control}
    />
  );
}

/**
 * The page, drawn and not editable, while a colleague holds the document. The
 * admin says who above it and offers to ask for access; the editor would only
 * offer edits nobody may make.
 */
function ReadOnlyPage({ control, field: declaration, name }: BoundProps) {
  const { field } = useController({ name, control });
  const kinds = acceptedKinds(declaration);
  const document = useMemo(
    () => documentFrom(field.value, kinds),
    [field.value, kinds]
  );
  const page = useRestingPageRender(PLUGIN_SOURCE, document);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageBuilderCard
        document={document}
        siteStyles={page.siteStyles}
        styleState={page.styleState}
        components={page.components}
        render={page.render}
        canEdit={false}
        href={undefined}
        onNavigate={() => {}}
      />
    </div>
  );
}

export function PageBuilderView({
  control,
  exit,
  field,
  readOnly,
}: DocumentViewProps): React.JSX.Element | null {
  // The admin names the field for a view offered on a field type, and asks the
  // author first where the document has several; without one there is nothing
  // to bind to. The field it names is always a named one — an unnamed group
  // only arranges the form, and the admin reads through it to the fields
  // inside — but the declaration type allows a nameless field, so the name is
  // settled here once rather than assumed below.
  const name = field?.name;
  if (field === undefined || name === undefined) return null;
  return readOnly ? (
    <ReadOnlyPage control={control} exit={exit} field={field} name={name} />
  ) : (
    <BoundEditor control={control} exit={exit} field={field} name={name} />
  );
}

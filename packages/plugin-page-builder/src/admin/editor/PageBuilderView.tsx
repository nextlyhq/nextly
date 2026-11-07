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
import {
  useDocumentIdentity,
  type DocumentViewProps,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useController } from "react-hook-form";

import { acceptedKinds } from "../../fields/blocks-options";
import { PageLayoutPicker } from "../page-layout";
import { PageBuilderCard } from "../PageBuilderCard";
import { useRestingPageRender } from "../use-resting-page-render";

import { BlocksEditor } from "./BlocksEditor";
import { openAtFromSearch } from "./builder-address";
import { rememberBuilderReturn } from "./builder-return";
import { rowGuardedWrite } from "./row-commit";
import { documentFrom, PLUGIN_SOURCE } from "./stored-document";

type BoundProps = Pick<
  DocumentViewProps,
  "control" | "exit" | "fieldLocation" | "fieldPathIn"
> & {
  field: NonNullable<DocumentViewProps["field"]>;
  /** The field's path in the document form, which is what binds to it. */
  name: string;
  /** The field's address, which names a repeater's row by its saved id. */
  address: string;
};

/** The editor, bound to the field the view opened for. */
function BoundEditor({
  control,
  exit,
  field: declaration,
  name,
  address,
  fieldLocation,
  fieldPathIn,
}: BoundProps) {
  const { field } = useController({ name, control });
  // Inside a repeater's row, every hand-over to the form first asks where the
  // row is at that moment, by its id, and writes only if it is still where
  // the editor is bound: a row that moved or went in between would otherwise
  // take another row's layout. Outside a row the write is the field's own.
  const { onChange } = field;
  const commit = useMemo(
    () =>
      rowGuardedWrite(
        onChange,
        name,
        fieldPathIn === undefined ? undefined : () => fieldPathIn()
      ),
    [onChange, name, fieldPathIn]
  );
  // The section the address names, read once as the editor opens: the editor
  // acts on it once, and a later change to the address is the author's own
  // navigation rather than a request to jump again.
  const [openAt] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : openAtFromSearch(window.location.search)
  );
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
      onCommit={commit}
      onClose={exit}
      name={name}
      control={control}
      openAt={openAt}
      address={address}
      location={fieldLocation}
      pathIn={fieldPathIn}
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
        after={<PageLayoutPicker control={control} disabled />}
      />
    </div>
  );
}

/**
 * Which surface to draw for `readOnly`, or `null` for the one commit between
 * them.
 *
 * Leaving the editor hands its unsaved work to the form as it unmounts, and
 * that lands AFTER anything drawn in the same commit has read the field. The
 * read-only page drawn beside it would show the page from before the author's
 * edits, under a banner saying they are still here, and its subscription to
 * the field starts too late to hear otherwise. So the editor goes first, its
 * work lands, and the page that replaces it reads the field afterwards.
 */
function useSettledSurface(readOnly: boolean): boolean | null {
  const [settled, setSettled] = useState(readOnly);
  useEffect(() => {
    setSettled(readOnly);
  }, [readOnly]);
  return settled === readOnly ? readOnly : null;
}

export function PageBuilderView({
  control,
  exit,
  field,
  fieldPath,
  fieldAddress,
  fieldLocation,
  fieldPathIn,
  readOnly,
}: DocumentViewProps): React.JSX.Element | null {
  // The admin names the field for a view offered on a field type, and asks the
  // author first where the document has several; without one there is nothing
  // to bind to. The field it names is always a named one — an unnamed group
  // only arranges the form, and the admin reads through it to the fields
  // inside — but the declaration type allows a nameless field, so the name is
  // settled here once rather than assumed below.
  //
  // Bound by the field's path in the form (`hero.body` inside a named group),
  // which the declaration's own name does not carry: bound by `body`, the
  // editor would read and write a top-level field of that name, or none. An
  // admin that passes no path names a top-level field, whose path is its name.
  const name = field === undefined ? undefined : (fieldPath ?? field.name);
  // The field's address, which the view's own address carries: inside a
  // repeater's row it names the row by its saved id, so it stays the same
  // when the rows are reordered and the form path does not.
  const address = fieldAddress ?? name;
  const leave = useLeaveToField(exit, address);
  const surface = useSettledSurface(readOnly);
  if (
    field === undefined ||
    name === undefined ||
    address === undefined ||
    surface === null
  ) {
    return null;
  }
  // Keyed by the field's address, because the editor reads its document
  // once, when it mounts. Moving to another field's address keeps this view
  // mounted, and an editor that stayed would go on showing the first field's
  // page — and its history — while writing into the second. A new key
  // unmounts it first, so its unsaved work lands in the field it came from,
  // and the next editor starts from the field now named. The address rather
  // than the form path: a row that moves keeps its address, and its editor.
  return surface ? (
    <ReadOnlyPage
      key={address}
      control={control}
      exit={leave}
      field={field}
      name={name}
      address={address}
    />
  ) : (
    <BoundEditor
      key={address}
      control={control}
      exit={leave}
      field={field}
      name={name}
      address={address}
      fieldLocation={fieldLocation}
      fieldPathIn={fieldPathIn}
    />
  );
}

/**
 * Leaving for the entry form, remembering the field the editor was on by its
 * address, so the form returns the author to it — in a repeater, to the same
 * row wherever it now stands — with its way back in focused.
 */
function useLeaveToField(
  exit: () => void,
  address: string | undefined
): () => void {
  const identity = useDocumentIdentity();
  return useCallback(() => {
    if (address !== undefined) rememberBuilderReturn(identity, address);
    exit();
  }, [identity, address, exit]);
}

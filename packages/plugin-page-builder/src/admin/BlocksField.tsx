"use client";

/**
 * The blocks field's control: a summary of what the field holds, and the way in
 * to the editor that changes it.
 *
 * At rest it draws `PageBuilderCard`: the page itself, small and inert, and one
 * way in. A list of block TYPE NAMES was what stood here, and it read as an
 * inert summary rather than as the door to the editor — the confusion
 * Gutenberg's own design discussion of editor switching warns about.
 *
 * `BlocksSummary` is NOT deleted. It remains exported and registered at the
 * component path `@nextlyhq/plugin-page-builder/admin#BlocksSummary`, which a
 * host may address by string, so removing it would break a published surface.
 * It stays a pure read-only account of the document; both it and the card ask
 * `page-summary` what the document holds, so they cannot disagree.
 *
 * ## Why the editor is a screen of its own
 *
 * A block canvas needs the window. Rendered inline it would compete with the
 * form's own measure, and every published page it previews is wider than the
 * column a field occupies — so an inline canvas previews a layout at a width
 * the site never uses. The editor is the document's own view at its own
 * address instead, which this card links to: the admin keeps the document's
 * form, lock, recovery and leave guard around it, and nothing the editor draws
 * sits inside this form, so nothing it draws can submit it.
 *
 * @module @nextlyhq/plugin-page-builder/admin/BlocksField
 */

import { navigateTo, useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { acceptedKinds } from "../fields/blocks-options";

import { builderAddress } from "./editor/builder-address";
import { documentFrom, PLUGIN_SOURCE } from "./editor/stored-document";
import { PageBuilderCard } from "./PageBuilderCard";
import { useRestingPageRender } from "./use-resting-page-render";

/*
 * Re-exported from where they now live, because this module is where their
 * tests and the package's own imports have always found them.
 */
export { documentFrom } from "./editor/stored-document";
export {
  withoutSelf,
  withoutSelfPatterns,
  type ComponentGraph,
} from "./editor/offered-library";

export interface BlocksFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads and writes. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
  /**
   * The field's own declaration, as the admin passes it to every plugin field
   * editor.
   *
   * Read for the kinds it accepts, and for nothing else. Without it the editor
   * has to guess what an empty document should be, and its only available
   * guess is a page — which is the one answer a pattern or component store
   * refuses.
   *
   * Named `field` because that is the name the admin passes it under
   * (`FieldRenderer` spreads `{ ...commonProps, field }` into every plugin
   * field editor). A prop named for what this file wants to call it would type
   * fine, arrive never, and leave the defect in place looking fixed.
   */
  field?: { blocks?: unknown };
  /**
   * The document is being READ, not edited, so no way in is offered.
   *
   * The admin passes this to every field through one `commonProps`, and a field
   * that ignores it does not merely look wrong: this one opened a full-screen
   * editor bound to whichever form was nearest, which in a version-history view
   * is the SNAPSHOT'S. Committing there writes into a past version of the
   * document — `ReadOnlyDocumentForm` states that as impossible in its own
   * docblock, and nothing was enforcing it.
   */
  readOnly?: boolean;
  /**
   * The field is unavailable — no permission, or a form mid-submit.
   *
   * Accepted alongside `readOnly` because the admin sets the two independently,
   * and a field honouring one of them is a field that is wrong half the time.
   * Both mean the same thing here: there is no way in.
   */
  disabled?: boolean;
}

/**
 * Whether this field may be edited at all.
 *
 * Exported and tested apart from the render for the same reason `documentFrom`
 * is: this package has no DOM harness, and the rule is worth pinning on its own
 * because getting it wrong is not cosmetic. A blocks field that ignored
 * `readOnly` offered a full-screen editor from inside a version-history view,
 * bound to the SNAPSHOT'S form — so committing wrote into a past version of the
 * document.
 *
 * Both flags mean the same thing here. The admin sets them independently —
 * `readOnly` for a document being read, `disabled` for no permission or a form
 * mid-submit — and a field honouring one of them is a field that is wrong half
 * the time.
 */
export function canEditBlocks(options: {
  readOnly?: boolean;
  disabled?: boolean;
}): boolean {
  return options.readOnly !== true && options.disabled !== true;
}

export function BlocksField<TFieldValues extends FieldValues = FieldValues>({
  name,
  control,
  readOnly = false,
  disabled = false,
  // Renamed locally because `field` is also what `useController` calls the
  // bound value below, and the two are different things: this is the schema's
  // declaration, that is the form's state.
  field: declaration,
}: BlocksFieldProps<TFieldValues>) {
  const { field } = useController({ name, control });
  /*
   * Where the builder opens for this field: the document view at the
   * document's own address. The editor is that screen rather than an overlay
   * inside this form, so nothing it draws can submit the form, and it can move
   * between pages without being tied to the one that mounted it.
   */
  const address = builderAddress(useDocumentIdentity(), name);

  // What an empty document has to be for THIS field, asked of its declaration
  // as the editor's view asks it, so the card and the editor read one answer.
  const kinds = acceptedKinds(declaration);

  const editable = canEditBlocks({ readOnly, disabled });

  /*
   * The site's own style, read at REST as well as inside the editor.
   *
   * The miniature below is the published renderer, so it needs the sheet that
   * renderer needs. Omitting it is not a neutral choice: `PageRenderer` still
   * emits the DEFAULT token set, so the page draws plausibly while missing this
   * site's named classes and block-type defaults — which is the failure
   * `canvas.tsx` makes the prop required to prevent.
   *
   * The same query the editor makes, so the two share one cache entry rather
   * than fetching twice; `pending` is forwarded so the card can decline to draw
   * a page it cannot draw faithfully yet.
   */
  /*
   * What the resting card draws with, asked as ONE question.
   *
   * The site's style, whether it has arrived, its config and a container name
   * for this field's own box — four reads, each of which produces a
   * faithful-looking wrong page when got subtly wrong. They belong together and
   * not in a control whose job is choosing between two surfaces.
   */
  const restingDocument = useMemo(
    () => documentFrom(field.value, kinds),
    [field.value, kinds]
  );
  const resting = useRestingPageRender(PLUGIN_SOURCE, restingDocument);

  return (
    <PageBuilderCard
      document={restingDocument}
      siteStyles={resting.siteStyles}
      styleState={resting.styleState}
      components={resting.components}
      render={resting.render}
      // The gate is passed through rather than restated: `canEditBlocks`
      // answers it, and two readings of "may this author edit" is one more
      // than the question has.
      canEdit={editable}
      href={"href" in address ? address.href : undefined}
      onNavigate={navigateTo}
      {...("unavailable" in address
        ? { unavailableReason: address.unavailable }
        : {})}
    />
  );
}

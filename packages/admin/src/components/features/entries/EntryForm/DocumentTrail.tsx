"use client";

/**
 * The trail an open document puts in the admin's top bar: Content, then its
 * collection's list or Singles, then the document.
 *
 * Built here, by the editor, rather than by the top bar from the route: the
 * editor is what knows the collection's labels and the title as it is typed,
 * and the top bar stays a slot that draws whatever the page on screen says.
 *
 * @module components/features/entries/EntryForm/DocumentTrail
 */

import { readableTitleText } from "nextly/config";
import { useWatch, type Control } from "react-hook-form";

import {
  useHeaderTrail,
  type HeaderTrailValue,
} from "@admin/components/layout/header/HeaderTrail";
import { buildRoute, ROUTES } from "@admin/constants/routes";

/** What a document's trail is built from. */
type DocumentTrailInput =
  | {
      kind: "entry";
      collectionSlug: string;
      pluralLabel: string;
      singularLabel: string;
      mode: "create" | "edit";
      /** The title field's value, whatever its type. */
      title: unknown;
    }
  | {
      kind: "single";
      /** The Single's own label, said where its title is empty. */
      label: string;
      title: unknown;
    };

/**
 * The trail for a document.
 *
 * "Content" leads to the section of the document's own kind, which is where
 * the admin's content navigation lands for that kind. A document being created
 * is called "New <singular>" whatever has been typed, since it is not that
 * document yet; one with no readable title is "Untitled", as its title field
 * says.
 */
function documentTrail(input: DocumentTrailInput): HeaderTrailValue {
  const title = readableTitleText(input.title);
  if (input.kind === "single") {
    return {
      steps: [
        { label: "Content", href: ROUTES.SINGLES },
        { label: "Singles", href: ROUTES.SINGLES },
      ],
      current: title ?? (input.label || "Untitled"),
    };
  }
  return {
    steps: [
      { label: "Content", href: ROUTES.COLLECTIONS },
      {
        label: input.pluralLabel,
        href: buildRoute(ROUTES.COLLECTION_ENTRIES, {
          slug: input.collectionSlug,
        }),
      },
    ],
    current:
      input.mode === "create"
        ? `New ${input.singularLabel}`
        : (title ?? "Untitled"),
  };
}

type WithoutTitle<T> = T extends unknown ? Omit<T, "title"> : never;

export type DocumentTrailProps = WithoutTitle<DocumentTrailInput> & {
  /** The form holding the title, which the trail follows as it is typed. */
  control: Control<Record<string, unknown>>;
  titleName: string;
};

/**
 * Registers the open document's trail with the top bar. Renders nothing: the
 * trail is drawn by the bar, and is withdrawn when the editor unmounts.
 */
export function DocumentTrail({
  control,
  titleName,
  ...input
}: DocumentTrailProps): null {
  const title: unknown = useWatch({ control, name: titleName });
  useHeaderTrail(documentTrail({ ...input, title }));
  return null;
}

"use client";

/**
 * The New page dialog's "Start from": Blank, then each starter page the
 * site offers, each with a picture. Left out while the site offers none, so
 * a page starts blank without the author being asked a question with one
 * answer.
 *
 * A starter's picture is drawn from its own blocks with the site's own
 * style, by the part the header & footer menu's pictures use, so it shows
 * the site's colours and fonts rather than a picture made for another site.
 * Its short description is the choice's description, read by a screen
 * reader with its name and shown on hover.
 *
 * @module admin/new-page/new-page-starters
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { Fragment, useId, type JSX, type ReactNode } from "react";

import type { NewPageStarter } from "../../pages-write-contract";
import { useDocumentPictures } from "../header-footer-pictures";

import { NEW_PAGE_WORDS } from "./new-page-words";

export interface NewPageStartersProps {
  readonly starters: readonly NewPageStarter[];
  /** The chosen starter's id, or undefined for Blank. */
  readonly chosen: string | undefined;
  readonly onChoose: (starter: string | undefined) => void;
}

/** A starter's blocks draw no component, so its pictures wait on none. */
const NO_DEFINITIONS: Readonly<Record<string, BlockDocument>> = {};

/** One choice's picture: the starter's own, or an empty page for Blank. */
function Picture({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted"
    >
      {children}
    </span>
  );
}

export function NewPageStarters(
  props: NewPageStartersProps
): JSX.Element | null {
  // Nothing is read for the pictures while there is nothing to draw.
  return props.starters.length === 0 ? null : <StarterChoices {...props} />;
}

/** Blank and each starter, with their pictures. */
function StarterChoices({
  starters,
  chosen,
  onChoose,
}: NewPageStartersProps): JSX.Element {
  const id = useId();
  const draw = useDocumentPictures(NO_DEFINITIONS, true);
  const options = [
    {
      id: undefined,
      label: NEW_PAGE_WORDS.blank,
      description: undefined,
      document: undefined,
    },
    ...starters.map(starter => ({
      id: starter.id as string | undefined,
      label: starter.label,
      description: starter.description as string | undefined,
      document: starter.document as BlockDocument | undefined,
    })),
  ];
  return (
    <fieldset className="grid min-w-0 gap-1.5" data-slot="new-page-starters">
      <legend className="mb-1.5 text-sm font-medium leading-none">
        {NEW_PAGE_WORDS.startFrom}
      </legend>
      <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
        {options.map(option => {
          // Blank and the starters in namespaces of their own, so a
          // starter whose id is `blank` is never taken for Blank.
          const optionId =
            option.id === undefined
              ? `${id}-blank`
              : `${id}-starter-${option.id}`;
          const describedBy = `${optionId}-description`;
          const on = option.id === chosen;
          return (
            <Fragment key={optionId}>
              <label
                htmlFor={optionId}
                title={option.description}
                {...(option.id === undefined
                  ? { "data-blank": "" }
                  : { "data-starter": option.id })}
                // Hover darkens the edge to the control border, the token
                // that clears 3:1 in both modes; a faded foreground fell
                // below it, and an un-faded one would read as selected.
                className={`grid cursor-pointer gap-1 rounded-lg border p-1.5 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                  on
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-control-border"
                }`}
              >
                <input
                  id={optionId}
                  type="radio"
                  name={id}
                  className="sr-only"
                  checked={on}
                  aria-describedby={
                    option.description === undefined ? undefined : describedBy
                  }
                  onChange={() => onChoose(option.id)}
                />
                <Picture>
                  {option.document === undefined
                    ? null
                    : draw([option.document])}
                </Picture>
                <span className="truncate text-center">{option.label}</span>
              </label>
              {/* Beside the label, not in it, so it describes the choice
                without becoming part of its name. */}
              {option.description === undefined ? null : (
                <span id={describedBy} className="sr-only">
                  {option.description}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </fieldset>
  );
}

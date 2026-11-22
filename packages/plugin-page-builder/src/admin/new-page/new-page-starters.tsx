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
 * A starter the site can't use is listed too, dimmed and not choosable,
 * saying "Not available on this site" and the server's reason, which is then
 * its description: an author sees it and why rather than wondering where it
 * went.
 *
 * @module admin/new-page/new-page-starters
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { Fragment, useEffect, useId, type JSX, type ReactNode } from "react";

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

/**
 * One choice's picture: the starter's own, or an empty page for Blank;
 * dimmed for a starter the site can't use.
 */
function Picture({
  dimmed,
  children,
}: {
  dimmed: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted${
        dimmed ? " opacity-50" : ""
      }`}
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
  // A starter the site can't use is never the choice. One the form still
  // names (a re-read found it unavailable after it was chosen) shows Blank
  // chosen instead, and the form is told, so no page is asked for from it.
  const chosenUnavailable =
    chosen !== undefined &&
    starters.some(
      starter => starter.id === chosen && starter.unavailable !== undefined
    );
  useEffect(() => {
    if (chosenUnavailable) onChoose(undefined);
  }, [chosenUnavailable, onChoose]);
  const current = chosenUnavailable ? undefined : chosen;
  const options = [
    {
      id: undefined,
      label: NEW_PAGE_WORDS.blank,
      description: undefined,
      document: undefined,
      unavailable: undefined,
    },
    ...starters.map(starter => ({
      id: starter.id as string | undefined,
      label: starter.label,
      description: starter.description as string | undefined,
      document: starter.document as BlockDocument | undefined,
      unavailable: starter.unavailable?.reason,
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
          const labelId = `${optionId}-label`;
          const noteId = `${optionId}-note`;
          const reasonId = `${optionId}-reason`;
          const on = option.id === current;
          const { unavailable } = option;
          // An unavailable starter is described by why, not by what it holds.
          const description =
            unavailable !== undefined
              ? `${noteId} ${reasonId}`
              : option.description === undefined
                ? undefined
                : describedBy;
          return (
            <Fragment key={optionId}>
              <label
                htmlFor={optionId}
                title={option.description}
                {...(option.id === undefined
                  ? { "data-blank": "" }
                  : { "data-starter": option.id })}
                {...(unavailable === undefined
                  ? {}
                  : { "data-unavailable": "" })}
                className={`grid content-start gap-1 rounded-lg border p-1.5 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                  unavailable !== undefined
                    ? "cursor-not-allowed border-dashed border-border"
                    : on
                      ? "cursor-pointer border-primary ring-1 ring-primary"
                      : "cursor-pointer border-border hover:border-foreground/30"
                }`}
              >
                {/* Disabled, so neither a click nor the arrow keys choose
                  it; named by its label alone, so the note and reason in
                  its tile describe it rather than lengthen its name. */}
                <input
                  id={optionId}
                  type="radio"
                  name={id}
                  className="sr-only"
                  checked={on}
                  disabled={unavailable !== undefined}
                  aria-labelledby={labelId}
                  aria-describedby={description}
                  onChange={() => onChoose(option.id)}
                />
                <Picture dimmed={unavailable !== undefined}>
                  {option.document === undefined
                    ? null
                    : draw([option.document])}
                </Picture>
                <span
                  id={labelId}
                  className={`truncate text-center${
                    unavailable === undefined ? "" : " text-muted-foreground"
                  }`}
                >
                  {option.label}
                </span>
                {/* The note and the server's reason, at full strength in
                  the muted text so they keep their contrast in both themes. */}
                {unavailable === undefined ? null : (
                  <>
                    <span
                      id={noteId}
                      className="text-center text-[11px] font-medium leading-snug text-muted-foreground"
                    >
                      {NEW_PAGE_WORDS.notAvailable}
                    </span>
                    <span
                      id={reasonId}
                      className="text-center text-[11px] leading-snug text-muted-foreground"
                    >
                      {unavailable}
                    </span>
                  </>
                )}
              </label>
              {/* Beside the label, not in it, so it describes the choice
                without becoming part of its name. */}
              {option.description === undefined ||
              unavailable !== undefined ? null : (
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

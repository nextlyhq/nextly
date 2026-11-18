"use client";

/**
 * The New page dialog's "Start from": Blank, then each starter page the
 * site offers, each with a picture. Left out while the site offers none, so
 * a page starts blank without the author being asked a question with one
 * answer.
 *
 * @module admin/new-page/new-page-starters
 */
import { useId, type JSX } from "react";

import type { NewPageStarter } from "../../pages-write-contract";

import { NEW_PAGE_WORDS } from "./new-page-words";

export interface NewPageStartersProps {
  readonly starters: readonly NewPageStarter[];
  /** The chosen starter's id, or undefined for Blank. */
  readonly chosen: string | undefined;
  readonly onChoose: (starter: string | undefined) => void;
}

/** One choice's picture: the starter's own, or an empty page for Blank. */
function Picture({ src }: { src: string | undefined }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted"
    >
      {src === undefined ? null : (
        <img src={src} alt="" className="size-full object-cover object-top" />
      )}
    </span>
  );
}

export function NewPageStarters({
  starters,
  chosen,
  onChoose,
}: NewPageStartersProps): JSX.Element | null {
  const id = useId();
  if (starters.length === 0) return null;
  const options = [
    { id: undefined, label: NEW_PAGE_WORDS.blank, picture: undefined },
    ...starters.map(starter => ({
      id: starter.id as string | undefined,
      label: starter.label,
      picture: starter.picture,
    })),
  ];
  return (
    <fieldset className="grid min-w-0 gap-1.5" data-slot="new-page-starters">
      <legend className="mb-1.5 text-sm font-medium leading-none">
        {NEW_PAGE_WORDS.startFrom}
      </legend>
      <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
        {options.map(option => {
          const optionId = `${id}-${option.id ?? "blank"}`;
          const on = option.id === chosen;
          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className={`grid cursor-pointer gap-1 rounded-lg border p-1.5 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                on
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              <input
                id={optionId}
                type="radio"
                name={id}
                className="sr-only"
                checked={on}
                onChange={() => onChoose(option.id)}
              />
              <Picture src={option.picture} />
              <span className="truncate text-center">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

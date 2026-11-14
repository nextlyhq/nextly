/**
 * What editors will make, asked first in the new-entity dialog where a plugin
 * such as the Page Builder offers a choice: "Entries with fields" or "Pages you
 * design visually". The answer decides the field the entity starts with.
 *
 * Radios rather than a select: each option says what it does in a sentence,
 * and both need to be read at once for the choice to be an informed one.
 *
 * @module components/features/schema-builder/new-entity/EntryKindQuestion
 */
import { type JSX, useId } from "react";

import type { StartingFieldChoice } from "@admin/lib/builder/starting-field";
import { cn } from "@admin/lib/utils";

type Props = {
  choices: readonly StartingFieldChoice[];
  /** The starting field type chosen, undefined for the standard fields. */
  value: string | undefined;
  onChange: (next: string | undefined) => void;
};

export function EntryKindQuestion({
  choices,
  value,
  onChange,
}: Props): JSX.Element {
  const ids = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${ids}-question`}
      className="space-y-2"
    >
      <p id={`${ids}-question`} className="text-sm font-medium text-foreground">
        What will editors make?
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map(choice => {
          const id = `${ids}-${choice.type ?? "standard"}`;
          const checked = (value ?? null) === choice.type;
          return (
            <label
              key={id}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                checked
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <input
                type="radio"
                id={id}
                name={`${ids}-kind`}
                className="mt-1 accent-[color:var(--nx-primary)]"
                checked={checked}
                // `undefined` for the standard fields: the create sends no
                // starting field for them.
                onChange={() => onChange(choice.type ?? undefined)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {choice.label}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {choice.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A few choices side by side, one of them chosen: a radio group with one tab
 * stop whose arrow keys choose, as every radio group in the inspector steps.
 * With none chosen (a value no choice writes), the first takes the tab stop.
 *
 * @module segment-choices
 */
import * as React from "react";

import { radioGroupStep } from "./roving-radios";

/**
 * The next choice an arrow key moves to, as every radio group here steps,
 * wrapping at either end and passing over the choices that are held.
 */
function steppedTo(
  key: string,
  from: number,
  allowed: readonly boolean[]
): number | undefined {
  const step = radioGroupStep(key);
  if (step === null) return undefined;
  for (let offset = 1; offset <= allowed.length; offset += 1) {
    const index =
      (from + step * offset + allowed.length * offset) % allowed.length;
    if (allowed[index] === true) return index;
  }
  return undefined;
}

/** Move to the stepped choice: choose it, and take focus to it. */
export function arrowTo(
  event: React.KeyboardEvent<HTMLElement>,
  from: number,
  allowed: readonly boolean[],
  choose: (index: number) => void
): void {
  const next = steppedTo(event.key, from, allowed);
  if (next === undefined) return;
  event.preventDefault();
  choose(next);
  const options =
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="radio"]'
    );
  options?.[next]?.focus();
}

export function SegmentChoices<T extends string>({
  options,
  on,
  labels,
  labelId,
  onChoose,
}: {
  options: readonly T[];
  /** The chosen one, or none while what is stored is no choice's value. */
  on: T | undefined;
  labels: Readonly<Record<T, string>>;
  labelId: string;
  onChoose: (on: T) => void;
}): React.JSX.Element {
  const allowed = options.map(() => true);
  const stop = on === undefined ? options[0] : on;
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="nx-segment">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={on === option}
          tabIndex={stop === option ? 0 : -1}
          className="nx-segment__option"
          onKeyDown={event =>
            arrowTo(event, index, allowed, next => {
              const target = options[next];
              if (target !== undefined) onChoose(target);
            })
          }
          onClick={() => onChoose(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * "Space between blocks": the site's spacing model, chosen in the Variables
 * view beside the spacing variables it decides between.
 *
 * Two answers, each with one line saying what it does. Classic keeps the space
 * every heading and paragraph carries of its own, as pages built before
 * container gaps were; the other takes the space between two blocks from the
 * container holding them. A site that existed before container gaps starts on
 * Classic, a new site on the container's gap.
 *
 * Native radio inputs, so the keyboard and a screen reader get a radio group
 * with nothing rebuilt. Read-only shows the answer and offers no change.
 *
 * @module spacing-mode-choice
 */
import { SPACING_MODES, type SpacingMode } from "@nextlyhq/blocks-engine";
import * as React from "react";

/** What each answer is called and the one line that explains it. */
const WORDS: Readonly<Record<SpacingMode, { label: string; hint: string }>> = {
  classic: {
    label: "From each block’s margins (classic)",
    hint: "Headings, paragraphs, quotes and dividers keep their own space above and below.",
  },
  gaps: {
    label: "From the container’s gap",
    hint: "Blocks carry no outer margin; each container spaces what it holds by its gap.",
  },
};

export interface SpacingModeChoiceProps {
  /** The site's spacing model as it is now. */
  readonly mode: SpacingMode;
  /** A choice. The host saves it. */
  readonly onChange: (mode: SpacingMode) => void;
  /** Shown, never changed. */
  readonly readOnly?: boolean;
}

/** The site's spacing model, as a labelled radio group. */
export function SpacingModeChoice({
  mode,
  onChange,
  readOnly = false,
}: SpacingModeChoiceProps): React.JSX.Element {
  const id = React.useId();
  return (
    <section className="nx-vars__group nx-vars-spacing" aria-labelledby={id}>
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id={id}>
          Space between blocks
        </h3>
      </div>
      <div
        className="nx-vars-spacing__options"
        role="radiogroup"
        aria-labelledby={id}
      >
        {SPACING_MODES.map(option => (
          <label
            key={option}
            className="nx-vars-spacing__option"
            data-chosen={option === mode ? "" : undefined}
          >
            <input
              type="radio"
              name={id}
              value={option}
              checked={option === mode}
              disabled={readOnly && option !== mode}
              aria-describedby={`${id}-${option}`}
              onChange={() => {
                if (!readOnly && option !== mode) onChange(option);
              }}
            />
            <span className="nx-vars-spacing__words">
              <span className="nx-vars-spacing__label">
                {WORDS[option].label}
              </span>
              <span className="nx-vars-spacing__hint" id={`${id}-${option}`}>
                {WORDS[option].hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

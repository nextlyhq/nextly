/**
 * The Background section's placement fields: where the image sits (the nine
 * points every position picker here uses) and how it is sized.
 *
 * @module background-fields
 */
import type { StyleValue } from "@nextlyhq/blocks-engine";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { radioGroupStep } from "../../roving-radios";
import { declarationsText } from "../code-hints";
import { CssHint, OptionWrites, useFieldDescription } from "../css-hint";

import {
  BACKGROUND_SIZE_CHOICES,
  backgroundSizeChoiceOf,
  type BackgroundSizeChoice,
} from "./background-placement";
import { FieldPathWrites } from "./field-path-writes";
import { FocalFrame } from "./focal-frame";
import { FocalCss, FocalPointField, refusedBy } from "./focal-point-field";
import { InheritedValue } from "./inherited-value";

type CommitOutcome = "applied" | "refused" | "unchanged";

/** What every own field is given, as `OWN_FIELDS` hands it. */
interface OwnFieldProps {
  id: string;
  labelledBy: string;
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}

/**
 * No picture to preview in the position picker: the frame an Image block
 * provides describes its own picture, not a background, so a background's
 * picker reads none rather than placing points over the wrong image.
 */
const NO_PICTURE = {};

/**
 * Where the background image sits: the nine points, or Custom. CSS places a
 * background at its top left when nothing is set, so that is the default
 * the picker reads and focuses.
 */
export function BackgroundPositionField(
  props: OwnFieldProps
): React.JSX.Element {
  return (
    <FocalFrame.Provider value={NO_PICTURE}>
      <FocalPointField {...props} fallback="left top" />
    </FocalFrame.Provider>
  );
}

/** Where the size field writes: its own path, and the repeat beside it. */
interface SizePaths {
  readonly size: readonly string[];
  readonly repeat: readonly string[];
}

/**
 * How the background image is sized: Cover, Fit or Tile, each writing the
 * size AND the repeat in one edit, or any other size written as CSS, which
 * reads as Custom. Without the repeat, Fit's `contain` would tile, since CSS
 * repeats a background image by default.
 *
 * A radio group: one choice is in force, pressing it again changes nothing,
 * and the row's own clear removes the size.
 */
export function BackgroundSizeField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: OwnFieldProps & {
  /** The size control, whose path places the repeat beside it. */
  control: { readonly path: readonly string[] };
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  const optionWrites = React.useContext(OptionWrites);
  const commitPaths = React.useContext(FieldPathWrites);
  const inherited = React.useContext(InheritedValue);
  const [writing, setWriting] = React.useState(false);
  const group = React.useRef<HTMLDivElement>(null);
  const text = typeof stored === "string" ? stored : undefined;
  const chosen = backgroundSizeChoiceOf(stored);
  const inheritedChoice =
    stored === undefined ? backgroundSizeChoiceOf(inherited) : undefined;
  const paths = sizePaths(control.path);
  const invalid = refusedBy(describedBy);
  // One tab stop: the choice in force, else the one inherited, else the first.
  const focusable =
    choiceOrNone(chosen) ?? choiceOrNone(inheritedChoice) ?? FIRST_CHOICE;

  const choose = (choice: BackgroundSizeChoice): void => {
    if (choice === chosen) return;
    // Outside a field there is no path write to make both in one edit, so
    // the size alone is written there.
    if (commitPaths === undefined) {
      onCommit(choice.size);
      return;
    }
    commitPaths([
      { path: paths.size, value: choice.size },
      { path: paths.repeat, value: choice.repeat },
    ]);
  };
  const move = (event: React.KeyboardEvent, from: BackgroundSizeChoice) => {
    const step = radioGroupStep(event.key);
    if (step === null) return;
    event.preventDefault();
    const at = BACKGROUND_SIZE_CHOICES.indexOf(from);
    const count = BACKGROUND_SIZE_CHOICES.length;
    const next = BACKGROUND_SIZE_CHOICES[(at + step + count) % count];
    if (next === undefined) return;
    // A radio group's arrows choose as they move, as every radio group does.
    choose(next);
    group.current
      ?.querySelector<HTMLElement>(`[data-size="${next.size}"]`)
      ?.focus();
  };

  return (
    <div className="nx-background-size">
      <div
        ref={group}
        id={id}
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={described}
        className="nx-style-inspector__toggle nx-background-size__choices"
      >
        {BACKGROUND_SIZE_CHOICES.map(choice => {
          const isInherited = choice === inheritedChoice;
          return (
            <CssHint
              key={choice.label}
              summary={choice.summary}
              writes={choiceWrites(choice, optionWrites)}
            >
              <button
                type="button"
                role="radio"
                data-size={choice.size}
                aria-checked={choice === chosen}
                aria-label={
                  isInherited ? `${choice.label}, inherited` : choice.label
                }
                aria-invalid={invalid}
                {...(isInherited ? { "data-inherited": "" } : {})}
                tabIndex={choice === focusable ? 0 : -1}
                onClick={() => choose(choice)}
                onKeyDown={event => move(event, choice)}
                // The choice's own tooltip says what it writes; kept from the
                // field's, which would open over it with the stored value.
                onPointerMove={event => event.stopPropagation()}
              >
                {choice.label}
              </button>
            </CssHint>
          );
        })}
      </div>
      <button
        type="button"
        className="nx-focal__more nx-background-size__more"
        aria-label={`${actionName} as CSS`}
        aria-expanded={writing}
        title="Write as CSS…"
        onClick={() => setWriting(open => !open)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      <div className="nx-focal__readout nx-background-size__readout">
        <b>{sizeReadout(chosen, text, inheritedChoice, inherited)}</b>
        <span>{summaryOf(chosen) ?? summaryOf(inheritedChoice) ?? ""}</span>
      </div>
      {writing ? (
        <FocalCss
          stored={text}
          actionName={actionName}
          describedBy={describedBy}
          onCommit={onCommit}
          placeholder="50% auto"
        />
      ) : null}
    </div>
  );
}

/** The first choice, the group's tab stop while none is in force. */
const FIRST_CHOICE = BACKGROUND_SIZE_CHOICES[0];

/** A choice read back, or `undefined` for Custom or nothing. */
function choiceOrNone(
  read: BackgroundSizeChoice | "custom" | undefined
): BackgroundSizeChoice | undefined {
  return read === "custom" ? undefined : read;
}

/** What a choice does, in words, or `undefined` for Custom or nothing. */
function summaryOf(
  read: BackgroundSizeChoice | "custom" | undefined
): string | undefined {
  return choiceOrNone(read)?.summary;
}

/** The size's path, and the repeat's beside it in the same property. */
function sizePaths(path: readonly string[]): SizePaths {
  return { size: path, repeat: [...path.slice(0, -1), "repeat"] };
}

/**
 * What a choice writes, for its tooltip: the size as the engine compiles it,
 * from the field it is drawn in, and the repeat written with it.
 */
function choiceWrites(
  choice: BackgroundSizeChoice,
  optionWrites: ((option: string) => string) | undefined
): string {
  const size =
    optionWrites?.(choice.size) ??
    declarationsText([{ property: "background-size", value: choice.size }]);
  const repeat = declarationsText([
    { property: "background-repeat", value: choice.repeat },
  ]);
  return `${size}; ${repeat}`;
}

/**
 * What the readout says: the choice set here, any other size as Custom with
 * the value written, what reaches it from elsewhere, or that nothing is set.
 */
function sizeReadout(
  chosen: BackgroundSizeChoice | "custom" | undefined,
  text: string | undefined,
  inheritedChoice: BackgroundSizeChoice | "custom" | undefined,
  inherited: string | undefined
): string {
  if (chosen !== undefined && chosen !== "custom") return chosen.label;
  if (text !== undefined) return `Custom: ${text}`;
  if (inheritedChoice !== undefined && inheritedChoice !== "custom") {
    return `${inheritedChoice.label}, inherited`;
  }
  return inherited === undefined ? "Not set" : `Inherited: ${inherited}`;
}

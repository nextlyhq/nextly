"use client";

/**
 * A choice drawn as a segmented control: a radio group, one radio per option, the chosen one
 * raised on the muted track or filled. Used where every option fits on one line and the one not
 * chosen should be one press away and in view: a card header's quick setting, the dashboard
 * settings drawer's short choices (Width, Number of entries, Row spacing), and through
 * `@nextlyhq/plugin-sdk/admin` a plugin page's view switch or a short setting.
 *
 * Only the chosen radio is in the tab order (the first, while none is chosen), and the arrows,
 * Home and End move to another choice and choose it, as a radio group does. While the choice
 * cannot change, every radio is disabled.
 *
 * @module components/ui/segmented-choice
 */

import { useRef, type JSX, type KeyboardEvent } from "react";

import { cn } from "@admin/lib/utils";

/** One option of a segmented choice: its value, and what it reads. */
export interface SegmentedOption {
  value: string;
  label: string;
  /** What a screen reader says for it, where the label alone is too short ("50% width"). */
  spoken?: string;
  /** Whether it cannot be chosen while the others can: drawn struck through, and skipped. */
  disabled?: boolean;
}

/**
 * Where a key moves the choice in a group of `count`, from `index`, as a radio group moves:
 * the arrows to the next or previous choice, wrapping, and Home and End to the first and last,
 * each passing over a choice that cannot be chosen (`skip`). `undefined` for any other key, or
 * where no other choice can be chosen.
 */
function segmentFor(
  key: string,
  index: number,
  count: number,
  skip: (index: number) => boolean = () => false
): number | undefined {
  const step = (from: number, by: 1 | -1): number | undefined => {
    for (let moved = 1; moved <= count; moved += 1) {
      const at = (from + by * moved + count * count) % count;
      if (!skip(at)) return at;
    }
    return undefined;
  };
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return step(index, 1);
    case "ArrowLeft":
    case "ArrowUp":
      return step(index, -1);
    case "Home":
      return step(count - 1, 1);
    case "End":
      return step(0, -1);
    default:
      return undefined;
  }
}

/** The track and radio classes for each place the control is drawn. */
const SIZES = {
  // As tall as a card header's menu trigger, so a header keeps its own height: the chosen
  // option raised on a muted track.
  compact: {
    track: "h-7 gap-0.5 rounded-md p-0.5",
    radio: "h-full rounded-sm px-2 text-xs",
  },
  // The settings drawer's, and a form's: one bordered row of 30px options, parted by rules, the chosen one filled in
  // the primary colour, as the drawer's other controls are bordered; wrapping onto another line
  // where its options do not fit. Its 12.5px text keeps four short options, such as Count's
  // "Under the number", on one line.
  bordered: {
    track:
      "max-w-full flex-wrap self-start overflow-hidden rounded-lg border border-control-border bg-card",
    radio:
      "h-[30px] border-l border-border px-2.5 text-[12.5px] tabular-nums first:border-l-0 focus-visible:ring-inset",
  },
} as const;

/**
 * How the chosen option and the others are drawn in each size: raised on the muted track when
 * compact, filled in the primary colour when bordered, so the choice holds 3:1 against the
 * options beside it.
 */
const STATES = {
  compact: {
    checked: "bg-background font-semibold text-foreground shadow-sm",
    unchecked: "font-medium text-muted-foreground hover:text-foreground",
  },
  bordered: {
    // Focus is drawn inside the option, in the colour of its text, so it shows on the fill.
    checked:
      "bg-primary font-medium text-primary-foreground focus-visible:ring-primary-foreground",
    unchecked: "font-medium text-foreground hover:bg-accent",
  },
} as const;

/** How large the control is drawn, and how its chosen option is marked. */
export type SegmentedChoiceSize = keyof typeof SIZES;

/** How the group is named: by its own label, or by the element that labels it. */
type GroupName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never };

export type SegmentedChoiceProps = GroupName & {
  options: readonly SegmentedOption[];
  value: string | undefined;
  onSelect: (next: string) => void;
  disabled?: boolean;
  /**
   * `compact` (the default): small options on a muted track, the chosen one raised, for a
   * header or a toolbar. `bordered`: a bordered row of options, the chosen one filled, for a
   * setting in a form.
   */
  size?: SegmentedChoiceSize;
  /** Why the choice cannot change now, shown on hover. */
  title?: string | undefined;
  "aria-describedby"?: string | undefined;
  "data-testid"?: string;
};

export function SegmentedChoice({
  options,
  value,
  onSelect,
  disabled = false,
  size = "compact",
  title,
  ...rest
}: SegmentedChoiceProps): JSX.Element {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex(option => option.value === value);
  const firstOpen = Math.max(
    0,
    options.findIndex(option => option.disabled !== true)
  );
  const tabbable = chosen === -1 ? firstOpen : chosen;
  const classes = SIZES[size];

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    radios.current[index]?.focus();
    if (option.value !== value) onSelect(option.value);
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const next = segmentFor(
      event.key,
      index,
      options.length,
      at => options[at]?.disabled === true
    );
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      role="radiogroup"
      {...rest}
      aria-disabled={disabled || undefined}
      title={title}
      className={cn(
        "inline-flex items-center",
        size === "compact" && "bg-muted",
        classes.track
      )}
    >
      {options.map((option, index) => {
        const checked = index === chosen;
        return (
          <button
            key={option.value}
            ref={element => {
              radios.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.spoken}
            tabIndex={index === tabbable ? 0 : -1}
            disabled={disabled || option.disabled === true}
            data-value={option.value}
            onClick={() => choose(index)}
            onKeyDown={event => onKeyDown(event, index)}
            className={cn(
              "whitespace-nowrap transition-colors motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              option.disabled === true && "line-through",
              classes.radio,
              checked ? STATES[size].checked : STATES[size].unchecked
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

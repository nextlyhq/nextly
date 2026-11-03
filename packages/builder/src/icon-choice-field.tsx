/**
 * A style value chosen from icons: alignment and direction, drawn as the way
 * content flows rather than as CSS words.
 *
 * A radio group, one tab stop on the chosen value (or the first), with the
 * arrow keys moving and choosing, wrapping at the ends, as a radio group
 * does. Each icon is named in words for assistive technology and shows that
 * name in a tooltip on hover and on keyboard focus. Pressing the chosen icon
 * again clears the value, as the panel's other toggles do.
 *
 * The values the icons do not draw sit in a small list beside the group, so
 * every value the catalogue accepts stays reachable, and a stored one shows.
 *
 * @module icon-choice-field
 */
import type { StyleValue } from "@nextlyhq/blocks-engine";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  Baseline,
  Circle,
  MoreHorizontal,
  StretchHorizontal,
  StretchVertical,
  WrapText,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { InheritedValue } from "./inherited-value";
import type { AlignmentGroup } from "./style-alignment-icons";

/** The icons the mapping names, by their lucide export name. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  Baseline,
  StretchHorizontal,
  StretchVertical,
  WrapText,
};

/** How far each key moves the choice. */
const STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

type CommitOutcome = "applied" | "refused" | "unchanged";

export function IconChoiceField({
  id,
  labelledBy,
  group,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  group: AlignmentGroup;
  stored: StyleValue | undefined;
  /** The property's name, for naming the list of other values. */
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const current = typeof stored === "string" ? stored : undefined;
  // The value reaching this block from another tier. Its icon is marked, not
  // checked, while nothing is set here: the group shows what the canvas draws
  // without claiming this block chose it.
  const inherited = React.useContext(InheritedValue);
  const shownInherited = stored === undefined ? inherited : undefined;
  const { options } = group;
  const chosen = options.findIndex(option => option.value === current);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Moves and chooses together, as a radio group's arrow keys do.
  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onCommit(option.value);
    buttons.current[index]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const step = STEPS[event.key];
    const target =
      step !== undefined
        ? (index + step + options.length) % options.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : undefined;
    if (target === undefined) return;
    event.preventDefault();
    choose(target);
  };

  // A refused value marks every control, so whichever is focused says so.
  const invalid = describedBy === undefined ? undefined : true;
  // A stored spelling neither the icons nor the list carry (the engine
  // accepts "inherit" and other spellings): listed first in More, as stored,
  // so an active declaration never reads as unset.
  const unknown =
    current !== undefined && chosen === -1 && !group.rest.includes(current)
      ? current
      : undefined;
  const more = unknown === undefined ? group.rest : [unknown, ...group.rest];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="nx-icon-choice">
        {/* One strip: the icons, then More as its last segment. */}
        <div className="nx-icon-choice__strip">
          <div
            role="radiogroup"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className="nx-icon-choice__group"
          >
            {options.map((option, index) => {
              const checked = index === chosen;
              // The group's one tab stop: the chosen icon, else the first.
              const stop = index === Math.max(chosen, 0);
              const Icon = ICONS[option.icon] ?? Circle;
              return (
                <Tooltip key={option.value}>
                  <TooltipTrigger asChild>
                    <button
                      ref={button => {
                        buttons.current[index] = button;
                      }}
                      type="button"
                      // The field label's `for` lands here: a label reaches
                      // only a labelable element, and this is the group's
                      // way in.
                      {...(stop ? { id } : {})}
                      role="radio"
                      aria-checked={checked}
                      data-inherited={
                        option.value === shownInherited ? "" : undefined
                      }
                      aria-label={option.label}
                      aria-invalid={invalid}
                      tabIndex={stop ? 0 : -1}
                      data-icon={option.icon}
                      className="nx-icon-choice__option"
                      onClick={() => onCommit(checked ? null : option.value)}
                      onKeyDown={event => onKeyDown(event, index)}
                    >
                      <Icon
                        size={16}
                        aria-hidden="true"
                        style={iconStyle(option)}
                        {...(iconClass(option) === undefined
                          ? {}
                          : { className: iconClass(option) })}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{option.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          {more.length === 0 ? null : (
            <OtherValues
              values={more}
              current={current}
              actionName={actionName}
              describedBy={describedBy}
              onCommit={onCommit}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** The class an icon is drawn with: turned a quarter, for text down the page. */
function iconClass(
  option: AlignmentGroup["options"][number]
): string | undefined {
  return option.rotated === true ? "nx-icon-choice__rotated" : undefined;
}

/** The transform that maps an icon's own directions onto the container's. */
function iconStyle(
  option: AlignmentGroup["options"][number]
): React.CSSProperties | undefined {
  return option.matrix === undefined
    ? undefined
    : { transform: `matrix(${option.matrix.join(", ")}, 0, 0)` };
}

/**
 * The values the icons do not draw, as the strip's last segment: "⋯" until one
 * of them is the value, then that value's own spelling.
 */
function OtherValues({
  values,
  current,
  actionName,
  describedBy,
  onCommit,
}: {
  values: readonly string[];
  current: string | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const value =
    current !== undefined && values.includes(current) ? current : "";
  // An inherited value with no icon of its own lives here: More is ringed
  // as an inherited icon is, and says which value applies.
  const inherited = React.useContext(InheritedValue);
  const shows =
    current === undefined &&
    inherited !== undefined &&
    values.includes(inherited)
      ? inherited
      : undefined;
  return (
    <Select value={value} onValueChange={next => onCommit(next)}>
      <SelectTrigger
        className="nx-icon-choice__more"
        data-inherited={shows === undefined ? undefined : ""}
        title={shows}
        aria-label={
          shows === undefined
            ? `More ${actionName} values`
            : `More ${actionName} values, showing ${shows}`
        }
        aria-describedby={describedBy}
        aria-invalid={describedBy === undefined ? undefined : true}
      >
        <SelectValue
          placeholder={<MoreHorizontal size={16} aria-hidden="true" />}
        />
      </SelectTrigger>
      <SelectContent>
        {values.map(other => (
          <SelectItem key={other} value={other}>
            {other}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

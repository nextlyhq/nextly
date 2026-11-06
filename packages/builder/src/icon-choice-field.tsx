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
  TooltipProvider,
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
  Ban,
  Baseline,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  ChevronDown,
  Circle,
  Crop,
  Columns3,
  EyeOff,
  Grid2x2,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  RectangleHorizontal,
  Shrink,
  StretchHorizontal,
  StretchVertical,
  Strikethrough,
  Underline,
  WrapText,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { InheritedValue } from "./inherited-value";
import type { AlignmentGroup, AlignmentOption } from "./style-alignment-icons";
import {
  foldKeyword,
  keywordLabel,
  menuKeywords,
} from "./style-keyword-labels";

/**
 * A line over an O, as Underline is a U over one: lucide has no overline, and
 * a mark drawn in its own grid sits in the set as one of its own.
 */
const Overline = createLucideIcon("overline", [
  ["path", { d: "M5 3h14", key: "line" }],
  ["circle", { cx: "12", cy: "14", r: "6", key: "letter" }],
]);

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
  Ban,
  Baseline,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  ChevronDown,
  Columns3,
  Crop,
  EyeOff,
  Grid2x2,
  Minus,
  Play,
  Plus,
  RectangleHorizontal,
  Shrink,
  StretchHorizontal,
  StretchVertical,
  Strikethrough,
  Underline,
  Overline,
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

/**
 * An option's name, and its mark when it is the value inherited from another
 * tier: drawn as a dashed ring and said in its name, since a screen reader
 * otherwise hears every option unchecked and cannot tell which applies.
 */
function inheritedMark(
  option: AlignmentOption,
  inherited: string | undefined
): { "aria-label": string; "data-inherited"?: "" } {
  return inherited !== undefined && option.value === foldKeyword(inherited)
    ? { "aria-label": `${option.label}, inherited`, "data-inherited": "" }
    : { "aria-label": option.label };
}

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
  // Matched as CSS reads a keyword, so an imported `FLEX` chooses Flex.
  const iconFor = (value: string | undefined) =>
    value === undefined
      ? -1
      : options.findIndex(option => option.value === foldKeyword(value));
  const chosen = iconFor(current);
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
  // A stored spelling the icons do not draw (the engine accepts "inherit"
  // and other spellings): in More, as stored, in the place of a value it
  // reads the same as or else first, so an active declaration never reads as
  // unset and is never listed twice.
  const more = moreValues(group, {
    current,
    chosen,
    inherited: shownInherited,
    iconFor,
  });
  const { help, helpId, describedByAll } = useAppliedHelp(
    group,
    current ?? shownInherited,
    describedBy
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="nx-icon-choice">
        {/* One strip: the icons, then More as its last segment. */}
        <div className="nx-icon-choice__strip">
          <div
            role="radiogroup"
            aria-labelledby={labelledBy}
            aria-describedby={describedByAll}
            className="nx-icon-choice__group"
          >
            {options.map((option, index) => {
              const checked = index === chosen;
              // The group's one tab stop: the chosen icon, else the first.
              const stop = index === Math.max(chosen, 0);
              const Icon = ICONS[option.icon] ?? Circle;
              return (
                // Below the icons, over the next row: above, it covered the
                // value of the row before.
                <ChromeTooltip key={option.value} content={option.label}>
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
                    {...inheritedMark(option, shownInherited)}
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
                </ChromeTooltip>
              );
            })}
          </div>
          {more.length === 0 ? null : (
            <OtherValues
              cssProperty={group.cssProperty}
              values={more}
              current={current}
              actionName={actionName}
              describedBy={describedBy}
              onCommit={onCommit}
            />
          )}
        </div>
        {help === undefined ? null : (
          <p className="nx-inspector__note nx-icon-choice__help" id={helpId}>
            {help}
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * The values beside the icons: the group's list, with a stored value no icon
 * draws in the place of the one it reads the same as, or else first. So is
 * an inherited value no icon draws, so the field shows what the canvas uses
 * rather than nothing at all.
 */
function moreValues(
  group: AlignmentGroup,
  {
    current,
    chosen,
    inherited,
    iconFor,
  }: {
    current: string | undefined;
    chosen: number;
    inherited: string | undefined;
    iconFor: (value: string | undefined) => number;
  }
): readonly string[] {
  const unlisted =
    current !== undefined
      ? chosen === -1
        ? current
        : ""
      : inherited !== undefined && iconFor(inherited) === -1
        ? inherited
        : "";
  return menuKeywords(group.cssProperty, group.rest, unlisted);
}

/**
 * What the value that applies does, set here or inherited, where the group
 * says it in words (an image's fit), and the ids the group is described by
 * with that line among them.
 */
function useAppliedHelp(
  group: AlignmentGroup,
  applies: string | undefined,
  describedBy: string | undefined
): {
  help: string | undefined;
  helpId: string;
  describedByAll: string | undefined;
} {
  const helpId = React.useId();
  const help =
    applies === undefined ? undefined : group.help?.[foldKeyword(applies)];
  const ids = [describedBy, help === undefined ? undefined : helpId].filter(
    (id): id is string => id !== undefined
  );
  return {
    help,
    helpId,
    describedByAll: ids.length === 0 ? undefined : ids.join(" "),
  };
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
  cssProperty,
  values,
  current,
  actionName,
  describedBy,
  onCommit,
}: {
  /** The property the values are named for. */
  cssProperty: string;
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
            : `More ${actionName} values, showing ${keywordLabel(cssProperty, shows)}`
        }
        aria-describedby={describedBy}
        aria-invalid={describedBy === undefined ? undefined : true}
      >
        <SelectValue
          placeholder={<MoreHorizontal size={16} aria-hidden="true" />}
        />
      </SelectTrigger>
      <SelectContent>
        {/* In words, the CSS spelling in the tooltip; see style-keyword-labels. */}
        {values.map(other => (
          <SelectItem key={other} value={other} title={other}>
            {keywordLabel(cssProperty, other)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

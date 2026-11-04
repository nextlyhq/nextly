"use client";

/**
 * An aspect ratio, chosen from the ratios an author reaches for, or given as a
 * width and a height.
 *
 * The catalog stores `aspect-ratio` as free CSS, so typing "16 / 9" was the
 * only way to set one, and a slip was a value the browser drops. The menu
 * offers the common ratios by name, and Custom asks for the two numbers. What
 * it writes is the CSS ratio (`16 / 9`). A stored value it cannot draw, such
 * as `auto 4 / 3`, is left to the text field, so nothing the CSS can say
 * becomes unreachable.
 *
 * @module aspect-ratio-field
 */

import { trimCssWhitespace, type StyleValue } from "@nextlyhq/blocks-engine";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

// Enter commits without submitting the entry form the builder sits in.
import { commitOnEnter } from "./commit-on-enter";
import { InheritedValue } from "./inherited-value";
import { CSS_NUMBER } from "./style-numeric";

type CommitOutcome = "applied" | "refused" | "unchanged";

/** The ratios offered by name, common first, each as the CSS it writes. */
const PRESETS: readonly { value: string; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1 / 1", label: "Square 1:1" },
  { value: "4 / 3", label: "4:3" },
  { value: "3 / 2", label: "3:2" },
  { value: "16 / 9", label: "16:9" },
  { value: "21 / 9", label: "21:9" },
  { value: "3 / 4", label: "Portrait 3:4" },
  { value: "9 / 16", label: "Portrait 9:16" },
];

/** The menu's value for a custom ratio, apart from every CSS ratio. */
const CUSTOM = "custom";

/** The menu's value for a ratio written as CSS, for one it has no words for. */
const AS_CSS = "css";

/** A positive number as CSS reads one, or `undefined`: never `0x10` or `Infinity`. */
function cssNumber(text: string): number | undefined {
  const trimmed = trimCssWhitespace(text);
  if (!CSS_NUMBER.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return number > 0 && Number.isFinite(number) ? number : undefined;
}

/** What a ratio is called in the menu: its preset's name, or `5:4`. */
function choiceLabel(choice: AspectRatioChoice): string {
  if (choice.kind === "custom") return `${choice.width}:${choice.height}`;
  return PRESETS.find(preset => preset.value === choice.value)?.label ?? "";
}

/** A positive number as CSS writes one, and no more of the text. */
const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const RATIO = new RegExp(
  String.raw`^[ \t\n\r\f]*${NUMBER}(?:[ \t\n\r\f]*/[ \t\n\r\f]*${NUMBER})?[ \t\n\r\f]*$`
);

/** What a stored ratio is, as the field can draw it. */
export type AspectRatioChoice =
  | { readonly kind: "preset"; readonly value: string }
  | {
      readonly kind: "custom";
      readonly width: number;
      readonly height: number;
    };

/**
 * A stored aspect ratio as the field draws it: the preset it is, however it
 * is spaced; another simple ratio as a custom width and height; or
 * `undefined` for a value this field cannot draw, which the text field keeps.
 */
export function aspectRatioChoice(
  stored: string
): AspectRatioChoice | undefined {
  if (/^[ \t\n\r\f]*auto[ \t\n\r\f]*$/i.test(stored)) {
    return { kind: "preset", value: "auto" };
  }
  const match = RATIO.exec(stored);
  if (match === null) return undefined;
  const width = Number(match[1]);
  // A ratio given as one number is that number over 1.
  const height = match[2] === undefined ? 1 : Number(match[2]);
  if (!(width > 0 && height > 0)) return undefined;
  const preset = PRESETS.find(candidate => {
    const [w, h] = candidate.value.split(" / ").map(Number);
    return w !== undefined && h !== undefined && width * h === height * w;
  });
  return preset === undefined
    ? { kind: "custom", width, height }
    : { kind: "preset", value: preset.value };
}

/** Whether the field can draw a stored value; else the text field keeps it. */
export function drawsAspectRatio(stored: StyleValue | undefined): boolean {
  return (
    stored === undefined ||
    (typeof stored === "string" && aspectRatioChoice(stored) !== undefined)
  );
}

/** Which part of the field is open: the menu alone, a custom ratio, or CSS. */
type RatioMode = "menu" | "custom" | "css";

/**
 * What the menu shows: the stored ratio as the field draws it, whether the
 * custom numbers are open, and the menu's value.
 */
function ratioMenu(
  stored: StyleValue | undefined,
  mode: RatioMode
): {
  choice: AspectRatioChoice | undefined;
  custom: boolean;
  value: string;
} {
  const choice =
    typeof stored === "string" ? aspectRatioChoice(stored) : undefined;
  const custom = choice?.kind === "custom" || mode === "custom";
  const preset = choice?.kind === "preset" ? choice.value : "";
  const value = mode === "css" ? AS_CSS : custom ? CUSTOM : preset;
  return { choice, custom, value };
}

/**
 * The ratio reaching this block from another tier, shown where Not set would
 * while nothing is stored here: by its name, or as written where the menu
 * has no words for it (`auto 4 / 3`).
 */
function inheritedLabel(
  stored: StyleValue | undefined,
  inherited: string | undefined
): string | undefined {
  if (stored !== undefined || inherited === undefined) return undefined;
  const choice = aspectRatioChoice(inherited);
  return choice === undefined ? inherited : choiceLabel(choice);
}

export function AspectRatioField({
  id,
  labelledBy,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const inherited = inheritedLabel(stored, React.useContext(InheritedValue));
  // Custom and CSS are chosen before anything is typed, so each is the
  // field's own state until a ratio is stored; a stored change (one written
  // here, an undo, a shared style's update) closes it, so a stale draft is
  // never left open over the value that replaced it.
  const [mode, setMode] = React.useState<RatioMode>("menu");
  React.useEffect(() => {
    setMode("menu");
  }, [stored]);
  const { choice, custom, value } = ratioMenu(stored, mode);
  const invalid = describedBy === undefined ? undefined : true;
  return (
    <div className="nx-style-inspector__ratio">
      <Select
        value={value}
        onValueChange={next => {
          if (next === CUSTOM || next === AS_CSS) {
            setMode(next === CUSTOM ? "custom" : "css");
            return;
          }
          setMode("menu");
          onCommit(next);
        }}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          {...(value === "" && inherited !== undefined
            ? { "data-inherited": "" }
            : {})}
        >
          <SelectValue placeholder={inherited ?? "Not set"} />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map(preset => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom…</SelectItem>
          <SelectItem value={AS_CSS}>Write as CSS…</SelectItem>
        </SelectContent>
      </Select>
      {mode === "css" ? (
        <CssRatio
          actionName={actionName}
          describedBy={describedBy}
          onCommit={onCommit}
        />
      ) : custom ? (
        <CustomRatio
          actionName={actionName}
          stored={choice?.kind === "custom" ? choice : undefined}
          describedBy={describedBy}
          onCommit={onCommit}
        />
      ) : null}
    </div>
  );
}

/**
 * A ratio written as CSS, for one the menu has no words for (`auto 4 / 3`),
 * written once the author leaves the field; the engine judges it.
 */
function CssRatio({
  actionName,
  describedBy,
  onCommit,
}: {
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [text, setText] = React.useState("");
  const commit = () => {
    if (trimCssWhitespace(text) !== "") onCommit(text);
  };
  return (
    <Input
      aria-label={`${actionName} as CSS`}
      aria-describedby={describedBy}
      aria-invalid={describedBy === undefined ? undefined : true}
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => commitOnEnter(event, commit)}
    />
  );
}

/**
 * A custom ratio's width and height, written as one ratio once both are
 * positive numbers and the author leaves either field.
 */
function CustomRatio({
  actionName,
  stored,
  describedBy,
  onCommit,
}: {
  actionName: string;
  stored: { width: number; height: number } | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [width, setWidth] = React.useState(
    stored === undefined ? "" : String(stored.width)
  );
  const [height, setHeight] = React.useState(
    stored === undefined ? "" : String(stored.height)
  );
  // A stored change (an undo, a shared style's update) moves the numbers
  // with it, so blurring the field never writes back the ratio it replaced.
  const storedWidth = stored?.width;
  const storedHeight = stored?.height;
  React.useEffect(() => {
    if (storedWidth === undefined || storedHeight === undefined) return;
    setWidth(String(storedWidth));
    setHeight(String(storedHeight));
  }, [storedWidth, storedHeight]);
  const commit = () => {
    const w = cssNumber(width);
    const h = cssNumber(height);
    if (w === undefined || h === undefined) return;
    if (stored !== undefined && stored.width === w && stored.height === h) {
      return;
    }
    onCommit(`${w} / ${h}`);
  };
  // A refusal said for the field is said for both numbers, either of which
  // may hold the focus when it arrives.
  const refusal = {
    "aria-describedby": describedBy,
    "aria-invalid": describedBy === undefined ? undefined : true,
  } as const;
  return (
    <div className="nx-style-inspector__ratio-custom">
      <Input
        aria-label={`${actionName} width`}
        inputMode="decimal"
        {...refusal}
        value={width}
        onChange={event => setWidth(event.target.value)}
        onBlur={commit}
        onKeyDown={event => commitOnEnter(event, commit)}
      />
      <span aria-hidden="true">:</span>
      <Input
        aria-label={`${actionName} height`}
        inputMode="decimal"
        {...refusal}
        value={height}
        onChange={event => setHeight(event.target.value)}
        onBlur={commit}
        onKeyDown={event => commitOnEnter(event, commit)}
      />
    </div>
  );
}

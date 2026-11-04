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

import type { StyleValue } from "@nextlyhq/blocks-engine";
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
  const choice =
    typeof stored === "string" ? aspectRatioChoice(stored) : undefined;
  // Custom is chosen before its numbers are typed, so it is the field's own
  // state until a ratio is stored.
  const [customOpen, setCustomOpen] = React.useState(false);
  const custom = choice?.kind === "custom" || customOpen;
  const value = custom ? CUSTOM : choice?.kind === "preset" ? choice.value : "";
  return (
    <div className="nx-style-inspector__ratio">
      <Select
        value={value}
        onValueChange={next => {
          if (next === CUSTOM) {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onCommit(next);
        }}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map(preset => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {custom ? (
        <CustomRatio
          actionName={actionName}
          stored={choice?.kind === "custom" ? choice : undefined}
          onCommit={onCommit}
        />
      ) : null}
    </div>
  );
}

/**
 * A custom ratio's width and height, written as one ratio once both are
 * positive numbers and the author leaves either field.
 */
function CustomRatio({
  actionName,
  stored,
  onCommit,
}: {
  actionName: string;
  stored: { width: number; height: number } | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [width, setWidth] = React.useState(
    stored === undefined ? "" : String(stored.width)
  );
  const [height, setHeight] = React.useState(
    stored === undefined ? "" : String(stored.height)
  );
  const commit = () => {
    const w = Number(width);
    const h = Number(height);
    if (width.trim() === "" || height.trim() === "") return;
    if (!(w > 0 && h > 0)) return;
    const next = `${w} / ${h}`;
    if (stored !== undefined && stored.width === w && stored.height === h) {
      return;
    }
    onCommit(next);
  };
  return (
    <div className="nx-style-inspector__ratio-custom">
      <Input
        aria-label={`${actionName} width`}
        inputMode="decimal"
        value={width}
        onChange={event => setWidth(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") commit();
        }}
      />
      <span aria-hidden="true">:</span>
      <Input
        aria-label={`${actionName} height`}
        inputMode="decimal"
        value={height}
        onChange={event => setHeight(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") commit();
        }}
      />
    </div>
  );
}

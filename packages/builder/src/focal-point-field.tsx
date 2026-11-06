"use client";

/**
 * An image's focal point: nine points over its own picture, written as
 * `object-position` keywords, and any other point written as CSS.
 *
 * On Cover the point is the part of the picture kept in view as it is
 * cropped; on Contain or None it is where the picture sits in its box. The
 * points are drawn over the block's own picture, fitted the way the block
 * fits it, so an author aims at what the page shows.
 *
 * @module focal-point-field
 */

import { trimCssWhitespace, type StyleValue } from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { commitOnEnter } from "./commit-on-enter";
import { FocalFrame } from "./focal-frame";
import { InheritedValue } from "./inherited-value";
import { commitRawCss } from "./raw-css";
import { radioGroupStep } from "./roving-radios";

type CommitOutcome = "applied" | "refused" | "unchanged";

const ACROSS = ["left", "center", "right"] as const;
const DOWN = ["top", "center", "bottom"] as const;

/** The nine points, row by row, each with its name and what it writes. */
const POINTS: readonly {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly value: string;
}[] = DOWN.flatMap((vertical, y) =>
  ACROSS.map((horizontal, x) => ({
    x,
    y,
    label: pointLabel(horizontal, vertical),
    // Across, then down, as CSS reads two keywords; the middle as one word.
    value:
      horizontal === "center" && vertical === "center"
        ? "center"
        : `${horizontal} ${vertical}`,
  }))
);

function pointLabel(horizontal: string, vertical: string): string {
  const words = [
    vertical === "center" ? "" : vertical,
    horizontal === "center" ? "" : horizontal,
  ].filter(word => word !== "");
  const name = words.length === 0 ? "center" : words.join(" ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Which axis a position keyword places on, and where along it. */
const KEYWORDS: Readonly<
  Record<string, { axis: "x" | "y" | "both"; at: number }>
> = {
  left: { axis: "x", at: 0 },
  right: { axis: "x", at: 2 },
  top: { axis: "y", at: 0 },
  bottom: { axis: "y", at: 2 },
  center: { axis: "both", at: 1 },
};

/**
 * The point a stored position names, in any order CSS allows (`top left`,
 * `left top`, `top`), or `undefined` for one that is not a point of the nine
 * (`30% 70%`, a variable).
 */
function pointOf(stored: string): (typeof POINTS)[number] | undefined {
  const words = trimCssWhitespace(stored).toLowerCase().split(/\s+/);
  if (words.length > 2) return undefined;
  const placed: { x?: number; y?: number } = {};
  for (const word of words) {
    const keyword = KEYWORDS[word];
    if (keyword === undefined) return undefined;
    // `center` fills whichever axis the other word leaves.
    if (keyword.axis === "both") continue;
    if (placed[keyword.axis] !== undefined) return undefined;
    placed[keyword.axis] = keyword.at;
  }
  const x = placed.x ?? 1;
  const y = placed.y ?? 1;
  return POINTS.find(point => point.x === x && point.y === y);
}

/** What the point does for a fit: kept in view as it crops, or where it sits. */
function hintFor(fit: string | undefined): string {
  return fit === "cover" ? "Kept in view" : "Where it sits";
}

/**
 * The point an arrow moves to: along its axis, by the step every radio group
 * here takes for that key, wrapping at an edge to the opposite one rather
 * than holding the key.
 */
function pointAfter(
  key: string,
  from: (typeof POINTS)[number]
): (typeof POINTS)[number] | undefined {
  const step = radioGroupStep(key);
  if (step === null) return undefined;
  const across = key === "ArrowLeft" || key === "ArrowRight";
  const x = across ? (from.x + step + 3) % 3 : from.x;
  const y = across ? from.y : (from.y + step + 3) % 3;
  return POINTS.find(point => point.x === x && point.y === y);
}

export function FocalPointField({
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
  const { picture, fit, position } = React.useContext(FocalFrame);
  const inherited = React.useContext(InheritedValue);
  const text = typeof stored === "string" ? stored : undefined;
  const chosen = text === undefined ? undefined : pointOf(text);
  const inheritedPoint =
    text === undefined && inherited !== undefined
      ? pointOf(inherited)
      : undefined;
  // Where the canvas places it, which resolves a point the inspector cannot;
  // else the point as stored or inherited.
  const shownPosition = position ?? text ?? inherited;
  const [writing, setWriting] = React.useState(false);
  const grid = React.useRef<HTMLDivElement>(null);
  // One tab stop: the chosen point, else the one shown, else the middle.
  const focusable = chosen ?? inheritedPoint ?? POINTS[4];
  const invalid = describedBy === undefined ? undefined : true;

  const choose = (point: (typeof POINTS)[number]) =>
    onCommit(point === chosen ? null : point.value);
  const move = (event: React.KeyboardEvent, from: (typeof POINTS)[number]) => {
    const next = pointAfter(event.key, from);
    if (next === undefined) return;
    event.preventDefault();
    // A radio group's arrows choose as they move, as every radio group does.
    onCommit(next.value);
    grid.current
      ?.querySelector<HTMLElement>(`[data-point="${next.value}"]`)
      ?.focus();
  };

  // The readout: the point set here by name, an exact one as written, what
  // reaches it from elsewhere, or the default when nothing does.
  const readout =
    chosen?.label ??
    text ??
    inheritedPoint?.label ??
    inherited ??
    "Center by default";

  return (
    <div className="nx-focal">
      <div className="nx-focal__frame">
        {picture === undefined ? (
          <span className="nx-focal__swatch" aria-hidden="true" />
        ) : (
          <img
            className="nx-focal__picture"
            src={picture}
            alt=""
            aria-hidden="true"
            style={{
              objectFit: (fit ?? "cover") as React.CSSProperties["objectFit"],
              // The point in force, so the preview crops as the page does.
              ...(shownPosition === undefined
                ? {}
                : { objectPosition: shownPosition }),
            }}
          />
        )}
        <div
          ref={grid}
          id={id}
          role="radiogroup"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          className="nx-focal__points"
        >
          {POINTS.map(point => {
            const isChosen = point === chosen;
            const isInherited = point === inheritedPoint;
            return (
              <button
                key={point.value}
                type="button"
                role="radio"
                data-point={point.value}
                aria-checked={isChosen}
                aria-label={
                  isInherited ? `${point.label}, inherited` : point.label
                }
                aria-invalid={invalid}
                {...(isInherited ? { "data-inherited": "" } : {})}
                tabIndex={point === focusable ? 0 : -1}
                className="nx-focal__point"
                onClick={() => choose(point)}
                onKeyDown={event => move(event, point)}
              />
            );
          })}
        </div>
      </div>
      <div className="nx-focal__readout">
        <b>{readout}</b>
        <span>{hintFor(fit)}</span>
      </div>
      <button
        type="button"
        className="nx-focal__more"
        aria-label={`${actionName} as CSS`}
        aria-expanded={writing}
        title="Write as CSS…"
        onClick={() => setWriting(open => !open)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {writing ? (
        <FocalCss
          stored={text}
          actionName={actionName}
          describedBy={describedBy}
          onCommit={onCommit}
        />
      ) : null}
    </div>
  );
}

/** A point written as CSS, such as `30% 70%`, once the field is left. */
function FocalCss({
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  stored: string | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [text, setText] = React.useState(stored ?? "");
  // A stored change moves the draft with it, so leaving the field never
  // writes back the value that change replaced.
  React.useEffect(() => {
    setText(stored ?? "");
  }, [stored]);
  const commit = () => {
    commitRawCss(text, stored, onCommit);
  };
  return (
    <Input
      className="nx-focal__css"
      aria-label={`${actionName} as CSS`}
      aria-describedby={describedBy}
      aria-invalid={describedBy === undefined ? undefined : true}
      placeholder="30% 70%"
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => commitOnEnter(event, commit)}
    />
  );
}

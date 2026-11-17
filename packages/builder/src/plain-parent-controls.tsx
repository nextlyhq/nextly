"use client";

/**
 * "Inside its parent": how a block takes its place in its parent, in plain
 * words. Width: Fill, Fit or Fixed, and Height the same under a Row or a
 * Grid, each with the line that says what it does and the CSS it writes on
 * hover.
 *
 * Read and written through `plain-layout` by the parent's arrangement at the
 * device being edited: a Row stacked here is a column, and offers no Height.
 *
 * @module plain-parent-controls
 */
import * as React from "react";

import { layoutWritesText } from "./code-hints";
import {
  planChildHeight,
  planChildWidth,
  readChildHeight,
  readChildWidth,
  type ChildFit,
  type ChildSize,
  type LayoutTiers,
  type LayoutWrite,
  type ParentArrangement,
} from "./plain-layout";
import { DraftInput, useApply, useLayoutTiers } from "./plain-layout-controls";
import { SegmentChoices } from "./segment-choices";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";

/** How the selected block's parent arranges it, lent by the Style panel. */
export const ParentArrangementContext: React.Context<
  ParentArrangement | undefined
> = React.createContext<ParentArrangement | undefined>(undefined);

const CHOICES = ["fill", "fit", "fixed"] as const;
const CHOICE_LABELS = { fill: "Fill", fit: "Fit", fixed: "Fixed" } as const;

/** What each Width choice does, in a line under the row. */
const WIDTH_LINES: Readonly<Record<ChildFit | "custom", string>> = {
  fill: "Takes the space it's given.",
  fit: "As wide as its content.",
  fixed: "A width you set.",
  custom: "Custom: set another way, in the rows below.",
};

/** What each Height choice does. */
const HEIGHT_LINES: Readonly<Record<ChildFit | "custom", string>> = {
  fill: "Takes the height it's given.",
  fit: "As tall as its content.",
  fixed: "A height you set.",
  custom: "Custom: set another way, in Size.",
};

/** The size a Fixed choice starts from where none is set yet. */
const STARTING_SIZE = { width: "320px", height: "200px" } as const;

/** What one axis offers: its choices' writes, and how a choice is planned. */
interface Axis {
  readonly name: "Width" | "Height";
  readonly lines: Readonly<Record<ChildFit | "custom", string>>;
  readonly size: ChildSize;
  readonly start: string;
  readonly plan: (choice: ChildFit, size?: string) => LayoutWrite[];
}

/**
 * Width, and Height under a Row or a Grid, at the top of "Inside its
 * parent". Nothing where the parent isn't known (a shared style is worn
 * wherever its blocks sit): the section's rows say what is set.
 */
export function InsideParentFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const parent = React.useContext(ParentArrangementContext);
  const target = React.useContext(StyleTargetContext);
  const tiers = useLayoutTiers(surroundings);
  const apply = useApply(surroundings, target);
  if (parent === undefined || target.kind === "shared") return null;
  const editing = surroundings.breakpoint;
  const width = widthAxis(tiers, editing, parent);
  // A Row or a Grid sizes its blocks across too; a column's height is its
  // blocks' own, set in Size.
  const height =
    parent === "row" || parent === "grid"
      ? heightAxis(tiers, editing)
      : undefined;
  return (
    <div className="nx-inside-parent" data-control="inside-parent">
      <AxisRow axis={width} apply={apply} />
      {height === undefined ? null : <AxisRow axis={height} apply={apply} />}
    </div>
  );
}

/** The Width axis, by the parent's arrangement here. */
function widthAxis(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement
): Axis {
  return {
    name: "Width",
    lines: WIDTH_LINES,
    size: readChildWidth(tiers, editing, parent),
    start: STARTING_SIZE.width,
    plan: (choice, size) =>
      planChildWidth(tiers, editing, parent, choice, size),
  };
}

/** The Height axis, under a Row or a Grid. */
function heightAxis(tiers: LayoutTiers, editing: string): Axis {
  return {
    name: "Height",
    lines: HEIGHT_LINES,
    size: readChildHeight(tiers, editing),
    start: STARTING_SIZE.height,
    plan: (choice, size) => planChildHeight(tiers, editing, choice, size),
  };
}

/** One axis: its three choices, the line under them, and Fixed's size. */
function AxisRow({
  axis,
  apply,
}: {
  axis: Axis;
  apply: (writes: readonly LayoutWrite[]) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const sizeId = React.useId();
  const { size } = axis;
  const fixed = size.choice === "fixed" ? size.size : undefined;
  const writes = {
    fill: layoutWritesText(axis.plan("fill")),
    fit: layoutWritesText(axis.plan("fit")),
    fixed: layoutWritesText(axis.plan("fixed", fixed ?? axis.start)),
  };
  return (
    <div className="nx-inside-parent__axis">
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          {axis.name}
        </span>
        <SegmentChoices
          options={CHOICES}
          on={size.choice === "custom" ? undefined : size.choice}
          labels={CHOICE_LABELS}
          labelId={labelId}
          writes={writes}
          onChoose={choice =>
            apply(
              axis.plan(
                choice,
                choice === "fixed" ? (fixed ?? axis.start) : undefined
              )
            )
          }
        />
      </div>
      <p className="nx-inspector__note">{axis.lines[size.choice]}</p>
      {fixed === undefined ? null : (
        <div className="nx-inspector__field">
          <label className="nx-inspector__field-name" htmlFor={sizeId}>
            {`${axis.name} set`}
          </label>
          <DraftInput
            id={sizeId}
            value={fixed}
            placeholder={axis.start}
            onCommit={text => {
              const typed = text.trim();
              if (typed !== "") apply(axis.plan("fixed", typed));
            }}
          />
        </div>
      )}
    </div>
  );
}

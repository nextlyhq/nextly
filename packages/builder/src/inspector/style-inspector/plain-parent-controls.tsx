"use client";

/**
 * "Inside its parent": how a block takes its place in its parent, in plain
 * words. Width: Fill, Fit or Fixed, and Height the same under a Row or a
 * Grid, each with the line that says what it does and the CSS it writes on
 * hover. A Fit or Fixed block also gets Align: where the parent puts its
 * blocks, or this block's own Left, Center or Right.
 *
 * Read and written through `plain-layout` by the parent's arrangement at the
 * device being edited: a Row stacked here is a column, and offers no Height.
 *
 * @module plain-parent-controls
 */
import { locateNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { blockLabel } from "../../panels/add/inserter";
import {
  childAxisRows,
  childPlaceHint,
  offersChildAxis,
  offersChildPlace,
  planChildPlace,
  planChildSize,
  readChildPlace,
  readChildSize,
  type ChildAxis,
  type ChildFit,
  type ChildPlace,
  type ChildSize,
  type LayoutTiers,
  type LayoutWrite,
  type ParentArrangement,
  type ParentItems,
} from "../../styles/plain-layout";
import { layoutWritesText } from "../code-hints";
import { SegmentChoices } from "../segment-choices";
import { SettingSlot } from "../settings-filter";

import { DraftInput, useApply, useLayoutTiers } from "./plain-layout-controls";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";
import type { ParentLayout } from "./style-inspector";

/** How the selected block's parent lays it out, lent by the Style panel. */
export const ParentArrangementContext: React.Context<ParentLayout | undefined> =
  React.createContext<ParentLayout | undefined>(undefined);

/** What sizing a block in its parent reads by, where it is offered. */
interface ParentSizing {
  readonly parent: ParentArrangement;
  readonly tiers: LayoutTiers;
  readonly items: ParentItems;
  /** The parent block's name, as the Layers panel and Add panel give it. */
  readonly parentName: string;
}

/**
 * The parent's arrangement, the block's values, and the alignment the parent
 * gives its items. The flow is the canvas's measured one: a writing mode
 * isn't a style a block stores, so a block's runs as its parent's does.
 * None where the parent isn't known or a shared style is edited.
 */
function useParentSizing(
  surroundings: StyleFieldSurroundings
): ParentSizing | undefined {
  const layout = React.useContext(ParentArrangementContext);
  const target = React.useContext(StyleTargetContext);
  const tiers = useLayoutTiers(surroundings);
  if (layout === undefined || target.kind === "shared") return undefined;
  const holder = locateNode(
    surroundings.editor.document.nodes,
    surroundings.nodeId
  )?.parent;
  return {
    parent: layout.arrangement,
    tiers,
    items: { alignItems: layout.alignItems, justifyItems: layout.justifyItems },
    // A block at the top of the page sits in the page itself.
    parentName: holder === undefined ? "Page" : blockLabel(holder.type),
  };
}

/** The ids the settings search knows Width and Height by. */
export const CHILD_SIZE_IDS = {
  width: "child:width",
  height: "child:height",
} as const;

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
  const sizing = useParentSizing(surroundings);
  const target = React.useContext(StyleTargetContext);
  const apply = useApply(surroundings, target);
  if (sizing === undefined) return null;
  const { parent, tiers, items, parentName } = sizing;
  const editing = surroundings.breakpoint;
  const width = axisOf(tiers, editing, parent, "width", items);
  // Where a Fit or Fixed block sits: none while it fills, or under a Row,
  // whose Spread places its blocks.
  const place = offersChildPlace(parent, tiers.flow)
    ? readChildPlace(tiers, editing, parent, items)
    : undefined;
  // A Row or a Grid sizes its blocks across too; a column's height is its
  // blocks' own, set in Size.
  const height = offersChildAxis(parent, "height", tiers.flow)
    ? axisOf(tiers, editing, parent, "height", items)
    : undefined;
  return (
    <div className="nx-inside-parent" data-control="inside-parent">
      <SettingSlot tab="style" ids={[CHILD_SIZE_IDS.width]}>
        <AxisRow axis={width} apply={apply} />
        {place === undefined ? null : (
          <PlaceRow
            place={place}
            parentName={parentName}
            hint={choice => childPlaceHint(parent, choice, tiers.flow)}
            onChoose={choice =>
              apply(planChildPlace(tiers, editing, parent, choice))
            }
          />
        )}
      </SettingSlot>
      {height === undefined ? null : (
        <SettingSlot tab="style" ids={[CHILD_SIZE_IDS.height]}>
          <AxisRow axis={height} apply={apply} />
        </SettingSlot>
      )}
    </div>
  );
}

/** One size's axis, by the role it plays in the parent here. */
function axisOf(
  tiers: LayoutTiers,
  editing: string,
  parent: ParentArrangement,
  axis: ChildAxis,
  items: ParentItems
): Axis {
  const width = axis === "width";
  return {
    name: width ? "Width" : "Height",
    lines: width ? WIDTH_LINES : HEIGHT_LINES,
    size: readChildSize(tiers, editing, parent, axis, items),
    start: width ? STARTING_SIZE.width : STARTING_SIZE.height,
    plan: (choice, size) =>
      planChildSize(tiers, editing, parent, axis, choice, size),
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

const PLACES = ["parent", "left", "center", "right"] as const;

/**
 * Align, under a Fit or Fixed Width: the parent's place first, named after
 * the parent ("Section's"), then this block's own Left, Center and Right,
 * each with the CSS it writes on hover.
 */
function PlaceRow({
  place,
  parentName,
  hint,
  onChoose,
}: {
  place: ChildPlace;
  parentName: string;
  hint: (choice: ChildPlace) => LayoutWrite[];
  onChoose: (choice: ChildPlace) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const labels = {
    parent: `${parentName}'s`,
    left: "Left",
    center: "Center",
    right: "Right",
  };
  const writes = {
    parent: layoutWritesText(hint("parent")),
    left: layoutWritesText(hint("left")),
    center: layoutWritesText(hint("center")),
    right: layoutWritesText(hint("right")),
  };
  // Its name above its four choices, which take the panel's whole width: the
  // parent's name ("Section's") beside the label column squeezed the label.
  return (
    <div className="nx-inspector__field nx-inspector__field--stacked">
      <span className="nx-inspector__field-name" id={labelId}>
        Align
      </span>
      <SegmentChoices
        options={PLACES}
        on={place}
        labels={labels}
        labelId={labelId}
        writes={writes}
        onChoose={onChoose}
      />
    </div>
  );
}

/**
 * The rows of "Inside its parent" that Width and Height draw in plain words
 * while each reads as a choice: they leave the raw rows, as Arrange's do,
 * and come back while that axis reads Custom. None where neither is drawn.
 */
export function useDrawnChildRows(
  surroundings: StyleFieldSurroundings
): ReadonlySet<string> {
  const sizing = useParentSizing(surroundings);
  if (sizing === undefined) return NONE;
  const { parent, tiers, items } = sizing;
  const editing = surroundings.breakpoint;
  const drawn = new Set<string>();
  for (const axis of ["width", "height"] as const) {
    if (!offersChildAxis(parent, axis, tiers.flow)) continue;
    if (
      readChildSize(tiers, editing, parent, axis, items).choice === "custom"
    ) {
      continue;
    }
    for (const row of childAxisRows(parent, axis, tiers.flow)) drawn.add(row);
  }
  return drawn;
}

const NONE: ReadonlySet<string> = new Set();

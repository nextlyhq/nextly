"use client";

/**
 * A container's Arrange in Style › Layout: Stack, Row or Grid in plain words,
 * the CSS each writes shown small under it, and the rows each offers.
 *
 * Read back and written through `plain-layout`, by the arrangement in force
 * at the device being edited, at the edited target and state, through the
 * same write path as every Style control: one undoable step per change.
 *
 * @module plain-layout-controls
 */
import {
  BASE_BREAKPOINT,
  findNode,
  type BreakpointSet,
  type NodeStyles,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { Input, Switch } from "@nextlyhq/ui";
import * as React from "react";

import { offeredTiers } from "./canvas/canvas-width";
import { chainedStyleOp, COLUMNS_ROW, type AppliedAt } from "./columns-layout";
import { CssHint } from "./css-hint";
import {
  ARRANGE_WRITES,
  LAYOUT_PROPERTIES,
  planAlign,
  planArrange,
  planColumns,
  planReverse,
  planRows,
  planSpread,
  planStackOn,
  planWrap,
  readArrange,
  SPREAD_KEYWORDS,
  unusedSettings,
  type AlignPoint,
  type LayoutProperty,
  type LayoutTiers,
  type LayoutValues,
  type LayoutWrite,
  type PlainArrange,
  type Spread,
} from "./plain-layout";
import { SegmentChoices } from "./segment-choices";
import {
  sharedStyleChange,
  type SharedStyleChange,
} from "./shared-style-target";
import {
  AppliedAtTier,
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";
import type { StyleTarget } from "./style-target";
import { readStyleValue } from "./style-values";

/**
 * The devices the switcher offers, widest (the base) first: of two at one
 * width the one the browser lets win, so a write lands where it applies.
 */
function deviceOrder(breakpoints: BreakpointSet | undefined): string[] {
  return [BASE_BREAKPOINT, ...offeredTiers(breakpoints).map(tier => tier.id)];
}

/** The edited target's styles: the block's, or the shared style's. */
function stylesOf(
  target: StyleTarget,
  surroundings: StyleFieldSurroundings
): NodeStyles | undefined {
  if (target.kind === "shared") return target.style.styles as NodeStyles;
  return findNode(surroundings.editor.document.nodes, surroundings.nodeId)
    ?.styles;
}

/** What the target stores at one device, as text. */
function ownAt(
  styles: NodeStyles | undefined,
  state: StyleState,
  device: string
): LayoutValues {
  const values: Partial<Record<LayoutProperty, string>> = {};
  for (const property of LAYOUT_PROPERTIES) {
    const value = readStyleValue(styles, {
      state,
      breakpoint: device,
      property,
      path: [],
    });
    if (typeof value === "string") values[property] = value;
  }
  return values;
}

/** What the target's own values put in force at a device, widest first. */
function ownInForce(
  order: readonly string[],
  own: (device: string) => LayoutValues
): (device: string) => LayoutValues {
  return device => {
    const merged: Partial<Record<LayoutProperty, string>> = {};
    for (const each of order) {
      Object.assign(merged, own(each));
      if (each === device) break;
    }
    return merged;
  };
}

/** What the cascade applies to the block at a device, property by property. */
function appliedInForce(applied: AppliedAt): (device: string) => LayoutValues {
  return device => {
    const values: Partial<Record<LayoutProperty, string>> = {};
    for (const property of LAYOUT_PROPERTIES) {
      const answer = applied(device, CSS_NAMES[property]);
      if (answer !== undefined) values[property] = answer.value;
    }
    return values;
  };
}

/**
 * What is in force and stored at each device. A block reads what the cascade
 * applies to it there (its own values over a shared style it wears and its
 * block's defaults); a shared style reads its own values, which are what its
 * Arrange writes.
 */
export function layoutTiers(
  surroundings: StyleFieldSurroundings,
  target: StyleTarget,
  applied: AppliedAt | undefined
): LayoutTiers {
  const order = deviceOrder(surroundings.breakpoints);
  const styles = stylesOf(target, surroundings);
  const own = (device: string) => ownAt(styles, surroundings.state, device);
  const inForce =
    target.kind === "block" && applied !== undefined
      ? appliedInForce(applied)
      : ownInForce(order, own);
  return { order, own, inForce };
}

/** Each layout property's CSS name, for the cascade's answer. */
const CSS_NAMES: Readonly<Record<LayoutProperty, string>> = {
  display: "display",
  flexDirection: "flex-direction",
  flexWrap: "flex-wrap",
  justifyContent: "justify-content",
  alignItems: "align-items",
  justifyItems: "justify-items",
  gap: "gap",
  rowGap: "row-gap",
  columnGap: "column-gap",
  gridTemplateColumns: "grid-template-columns",
  gridTemplateRows: "grid-template-rows",
};

/** The properties Arrange draws in plain words, out of the raw rows. */
export const ARRANGED_PROPERTIES: ReadonlySet<string> = new Set([
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "justifyItems",
  "gridTemplateColumns",
  "gridTemplateRows",
]);

/** Whether a block's Layout is drawn by Arrange: a container, not Columns. */
export function arrangesLayout(blockType: string | undefined): boolean {
  return blockType !== COLUMNS_ROW;
}

/**
 * The writes made, as one step: an op through the block's write path, or
 * one change to the shared style being edited.
 */
function useApply(
  surroundings: StyleFieldSurroundings,
  target: StyleTarget
): (writes: readonly LayoutWrite[]) => void {
  const { editor, nodeId, state, policy } = surroundings;
  return writes => {
    if (writes.length === 0) return;
    const steps = writes.map(write => ({
      address: {
        state,
        breakpoint: write.device,
        property: write.property,
        path: [] as string[],
      },
      value: write.value,
    }));
    if (target.kind === "shared") {
      if (target.readOnly !== undefined) return;
      void target.write(
        combined(
          steps.map(step => sharedStyleChange(step.address, step.value, policy))
        )
      );
      return;
    }
    const node = findNode(editor.document.nodes, nodeId);
    if (node === undefined) return;
    const op = chainedStyleOp(node, steps);
    if (op !== null) editor.apply(op);
  };
}

/** Several changes to a shared style as one, undone as one. */
function combined(changes: readonly SharedStyleChange[]): SharedStyleChange {
  return Object.assign(
    (styles: NodeStyles) => {
      let current = styles;
      let wrote = false;
      for (const change of changes) {
        const write = change(current);
        if (write.kind === "refused") return write;
        if (write.kind === "write") {
          current = write.styles;
          wrote = true;
        }
      }
      return wrote
        ? { kind: "write" as const, styles: current }
        : { kind: "unchanged" as const };
    },
    {
      invert: (before: NodeStyles) => {
        // Each change undone in reverse, each from the styles it was applied to.
        const states: NodeStyles[] = [];
        let current = before;
        for (const change of changes) {
          states.push(current);
          const write = change(current);
          if (write.kind === "write") current = write.styles;
        }
        return combined(
          changes
            .map((change, index) => change.invert(states[index] ?? before))
            .reverse()
        );
      },
    }
  );
}

const MODES = ["stack", "row", "grid"] as const;
const MODE_LABELS = { stack: "Stack", row: "Row", grid: "Grid" } as const;

/** What a mode writes, small, as a developer reads it. */
function modeLine(arrange: PlainArrange): string {
  switch (arrange.mode) {
    case "stack":
      return arrange.flex
        ? `display: flex · flex-direction: ${arrange.reverse ? "column-reverse" : "column"}`
        : "display: block";
    case "row":
      return `display: flex · flex-direction: ${arrange.stacked ? (arrange.reverse ? "column-reverse" : "column") : arrange.reverse ? "row-reverse" : "row"}`;
    case "grid":
      return "display: grid";
    case "custom":
      return "Set in CSS: the rows below hold it.";
  }
}

/**
 * Arrange and its rows, at the top of a container's Layout section. Drawn for
 * any container but Columns, whose tiles are its own.
 */
export function ArrangeFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const applied = React.useContext(AppliedAtTier);
  const labelId = React.useId();
  const apply = useApply(surroundings, target);
  if (!arrangesLayout(surroundings.editing.blockType)) return null;
  const tiers = layoutTiers(surroundings, target, applied);
  const editing = surroundings.breakpoint;
  const arrange = readArrange(tiers, editing);
  const unused = unusedSettings(tiers, editing);
  return (
    <div className="nx-arrange" data-control="arrange">
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          Arrange
        </span>
        <SegmentChoices
          options={MODES}
          on={arrange.mode === "custom" ? undefined : arrange.mode}
          labels={MODE_LABELS}
          labelId={labelId}
          writes={ARRANGE_WRITES}
          onChoose={mode => apply(planArrange(tiers, editing, mode))}
        />
      </div>
      <p className="nx-arrange__css">{modeLine(arrange)}</p>
      {arrange.mode === "custom" ? (
        <p className="nx-inspector__note">Arrange: Custom</p>
      ) : null}
      <ModeRows
        arrange={arrange}
        tiers={tiers}
        editing={editing}
        breakpoints={surroundings.breakpoints}
        apply={apply}
      />
      {unused.length === 0 ? null : (
        <UnusedLine
          unused={unused}
          onClear={() =>
            apply(
              unused.map(property => ({
                device: editing,
                property,
                value: null,
              }))
            )
          }
        />
      )}
    </div>
  );
}

/** The rows the arrangement in force offers. */
function ModeRows({
  arrange,
  tiers,
  editing,
  breakpoints,
  apply,
}: {
  arrange: PlainArrange;
  tiers: LayoutTiers;
  editing: string;
  breakpoints: BreakpointSet | undefined;
  apply: (writes: readonly LayoutWrite[]) => void;
}): React.JSX.Element | null {
  if (arrange.mode === "custom") return null;
  const align = (
    <AlignGrid
      point={arrange.align}
      onChoose={point => apply(planAlign(tiers, editing, point))}
      held={
        arrange.mode === "row" && arrange.spread !== "packed"
          ? arrange.stacked
            ? "y"
            : "x"
          : undefined
      }
    />
  );
  if (arrange.mode === "stack") {
    return (
      <>
        {align}
        <SwitchRow
          label="Reverse order"
          on={arrange.reverse}
          onChange={on => apply(planReverse(tiers, editing, on))}
        />
      </>
    );
  }
  if (arrange.mode === "grid") {
    return (
      <GridRows
        arrange={arrange}
        tiers={tiers}
        editing={editing}
        apply={apply}
        align={align}
      />
    );
  }
  return (
    <>
      <StackOnRow
        tiers={tiers}
        stackOn={arrange.stackOn}
        breakpoints={breakpoints}
        onChoose={device => apply(planStackOn(tiers, device))}
      />
      {align}
      <SpreadRow
        spread={arrange.spread}
        onChoose={spread => apply(planSpread(tiers, editing, spread))}
      />
      {arrange.stacked ? null : (
        <SwitchRow
          label="Wrap onto new lines"
          on={arrange.wrap}
          writes="flex-wrap: wrap"
          onChange={on => apply(planWrap(tiers, editing, on))}
        />
      )}
      <SwitchRow
        label="Reverse order"
        on={arrange.reverse}
        onChange={on => apply(planReverse(tiers, editing, on))}
      />
    </>
  );
}

const X_POINTS = ["left", "center", "right"] as const;
const Y_POINTS = ["top", "middle", "bottom"] as const;
const POINT_WORDS = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
  left: "left",
  center: "centre",
  right: "right",
} as const;

/** A point's name: "Top left", "Middle centre". */
function pointName(point: AlignPoint): string {
  return `${POINT_WORDS[point.y]} ${POINT_WORDS[point.x]}`;
}

/**
 * The 3×3 Align: a radio group moved with the arrows in two dimensions, each
 * point named. No point chosen is the default stretch, said under it. While
 * Spread is on, the axis it takes is held.
 */
function AlignGrid({
  point,
  onChoose,
  held,
}: {
  point: AlignPoint | undefined;
  onChoose: (point: AlignPoint | null) => void;
  /** The axis Spread holds, while it is on. */
  held: "x" | "y" | undefined;
}): React.JSX.Element {
  const labelId = React.useId();
  const points = Y_POINTS.flatMap(y => X_POINTS.map(x => ({ x, y })));
  const index =
    point === undefined
      ? -1
      : points.findIndex(each => each.x === point.x && each.y === point.y);
  const stop = index === -1 ? 0 : index;
  const choose = (next: number) => {
    const to = points[next];
    if (to !== undefined) onChoose(to);
  };
  const onKey = (event: React.KeyboardEvent<HTMLButtonElement>, at: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    };
    const step = moves[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(8, Math.max(0, at + step));
    choose(next);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
  };
  return (
    <div className="nx-inspector__field">
      <span className="nx-inspector__field-name" id={labelId}>
        Align
      </span>
      <div className="nx-align-grid__wrap">
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="nx-align-grid"
        >
          {points.map((each, at) => (
            <button
              key={`${each.y}-${each.x}`}
              type="button"
              role="radio"
              aria-checked={at === index}
              aria-label={pointName(each)}
              tabIndex={at === stop ? 0 : -1}
              className="nx-align-grid__point"
              onKeyDown={event => onKey(event, at)}
              onClick={() => onChoose(at === index ? null : each)}
            />
          ))}
        </div>
        <p className="nx-inspector__note">
          {held !== undefined
            ? "Spread is on: it places blocks along the row."
            : point === undefined
              ? "Fills the width."
              : pointName(point)}
        </p>
      </div>
    </div>
  );
}

const SPREADS = ["packed", "between", "around", "even"] as const;
const SPREAD_LABELS = {
  packed: "Packed",
  between: "Space between",
  around: "Space around",
  even: "Even",
} as const;

/** A Row's Spread along its main axis. */
function SpreadRow({
  spread,
  onChoose,
}: {
  spread: Spread;
  onChoose: (spread: Spread) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const writes = Object.fromEntries(
    SPREADS.map(each => [
      each,
      SPREAD_KEYWORDS[each] === null
        ? "justify-content (from Align)"
        : `justify-content: ${SPREAD_KEYWORDS[each] ?? ""}`,
    ])
  ) as Record<Spread, string>;
  return (
    <div className="nx-inspector__field">
      <span className="nx-inspector__field-name" id={labelId}>
        Spread
      </span>
      <SegmentChoices
        options={SPREADS}
        on={spread}
        labels={SPREAD_LABELS}
        labelId={labelId}
        writes={writes}
        onChoose={onChoose}
      />
    </div>
  );
}

/** A plain on and off row, with what it writes on hover. */
function SwitchRow({
  label,
  on,
  writes,
  onChange,
}: {
  label: string;
  on: boolean;
  writes?: string;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-display="switch">
      <span className="nx-inspector__field-name">{label}</span>
      <CssHint writes={writes}>
        <Switch aria-label={label} checked={on} onCheckedChange={onChange} />
      </CssHint>
    </div>
  );
}

/** Whether a device's name reads well as "and smaller". */
function deviceLabel(
  breakpoints: BreakpointSet | undefined,
  device: string
): string {
  return (
    breakpoints?.viewport.find(each => each.id === device)?.label ?? device
  );
}

/** A Row's Stack on: Never, or a device and the smaller ones. */
function StackOnRow({
  tiers,
  stackOn,
  breakpoints,
  onChoose,
}: {
  tiers: LayoutTiers;
  stackOn: string | undefined;
  breakpoints: BreakpointSet | undefined;
  onChoose: (device: string | null) => void;
}): React.JSX.Element {
  const id = React.useId();
  const devices = tiers.order.slice(1);
  return (
    <div className="nx-inspector__field">
      <label className="nx-inspector__field-name" htmlFor={id}>
        Stack on
      </label>
      <CssHint writes="flex-direction: column">
        <select
          id={id}
          className="nx-arrange__select"
          value={stackOn ?? ""}
          onChange={event =>
            onChoose(event.target.value === "" ? null : event.target.value)
          }
        >
          <option value="">Never</option>
          {devices.map((device, index) => (
            <option key={device} value={device}>
              {index === devices.length - 1
                ? deviceLabel(breakpoints, device)
                : `${deviceLabel(breakpoints, device)} and smaller`}
            </option>
          ))}
        </select>
      </CssHint>
    </div>
  );
}

/** A Grid's columns, rows and Align. */
function GridRows({
  arrange,
  tiers,
  editing,
  apply,
  align,
}: {
  arrange: Extract<PlainArrange, { mode: "grid" }>;
  tiers: LayoutTiers;
  editing: string;
  apply: (writes: readonly LayoutWrite[]) => void;
  align: React.JSX.Element;
}): React.JSX.Element {
  const columnsId = React.useId();
  const fit = arrange.columns?.kind === "fit";
  const labelId = React.useId();
  return (
    <>
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          Columns
        </span>
        <SegmentChoices
          options={["count", "fit"] as const}
          on={fit ? "fit" : "count"}
          labels={{ count: "Number", fit: "As many as fit" }}
          labelId={labelId}
          writes={{
            count: "grid-template-columns: repeat(N, minmax(0, 1fr))",
            fit: "grid-template-columns: repeat(auto-fill, minmax(W, 1fr))",
          }}
          onChoose={kind =>
            apply(
              planColumns(
                editing,
                kind === "fit"
                  ? { kind: "fit", min: "12rem" }
                  : { kind: "count", count: 2 }
              )
            )
          }
        />
      </div>
      <div className="nx-inspector__field">
        <label className="nx-inspector__field-name" htmlFor={columnsId}>
          {fit ? "Minimum width" : "How many"}
        </label>
        <DraftInput
          id={columnsId}
          value={
            arrange.columns === undefined
              ? ""
              : arrange.columns.kind === "fit"
                ? arrange.columns.min
                : String(arrange.columns.count)
          }
          placeholder={fit ? "12rem" : "Auto"}
          onCommit={text => {
            if (fit) {
              if (text.trim() !== "")
                apply(planColumns(editing, { kind: "fit", min: text.trim() }));
              return;
            }
            const count = Number.parseInt(text, 10);
            if (Number.isInteger(count) && count > 0) {
              apply(planColumns(editing, { kind: "count", count }));
            }
          }}
        />
      </div>
      <GridRowsCount
        rows={arrange.rows}
        onCommit={rows => apply(planRows(tiers, editing, rows))}
      />
      {align}
    </>
  );
}

/** A Grid's rows: a number, or empty for Auto. */
function GridRowsCount({
  rows,
  onCommit,
}: {
  rows: number | undefined;
  onCommit: (rows: number | undefined) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-inspector__field">
      <label className="nx-inspector__field-name" htmlFor={id}>
        Rows
      </label>
      <DraftInput
        id={id}
        value={rows === undefined ? "" : String(rows)}
        placeholder="Auto"
        onCommit={text => {
          if (text.trim() === "") return onCommit(undefined);
          const count = Number.parseInt(text, 10);
          if (Number.isInteger(count) && count > 0) onCommit(count);
        }}
      />
    </div>
  );
}

/** A text field committed on blur and on Enter, as every field here is. */
function DraftInput({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string;
  placeholder: string;
  onCommit: (text: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholder}
      autoComplete="off"
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** Which choice a set of unused values came from, for the line. */
function unusedFrom(unused: readonly LayoutProperty[]): string {
  const grid = unused.some(property => property.startsWith("grid"));
  const flex = unused.some(property => property.startsWith("flex"));
  if (grid && !flex) return "Grid";
  if (flex && !grid) return "Row";
  return "another arrangement";
}

/** "2 settings from Row aren't used · Clear". */
function UnusedLine({
  unused,
  onClear,
}: {
  unused: readonly LayoutProperty[];
  onClear: () => void;
}): React.JSX.Element {
  const count = unused.length;
  return (
    <p className="nx-arrange__unused" role="status">
      {count === 1
        ? `1 setting from ${unusedFrom(unused)} isn't used`
        : `${String(count)} settings from ${unusedFrom(unused)} aren't used`}
      {" · "}
      <button type="button" className="nx-arrange__clear" onClick={onClear}>
        Clear
      </button>
    </p>
  );
}

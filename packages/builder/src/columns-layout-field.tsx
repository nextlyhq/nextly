"use client";

/**
 * A Columns row's layout, in its Content tab: tiles that set how many
 * columns it holds and how wide, where it stacks, and whether it stacks
 * reversed.
 *
 * Every choice is one step of the history, its Style values and any empty
 * columns it adds or removes together. What each writes is in
 * `columns-layout.ts`.
 *
 * @module columns-layout-field
 */
import {
  findNode,
  type BreakpointId,
  type BreakpointSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { Switch } from "@nextlyhq/ui";
import * as React from "react";

import {
  COLUMNS_LAYOUTS,
  defaultTemplate,
  layoutOf,
  planLayout,
  planStack,
  reachedStacks,
  stackOf,
  type AppliedAt,
  stackTiers,
  type ColumnsLayout,
  type StackOn,
} from "./columns-layout";
import type { EditorState } from "./editor-state";
import { arrowTo, SegmentChoices } from "./segment-choices";
import { readStyleValue } from "./style-values";

/** Where a row stacks, each choice saying every device it applies on. */
const STACK_LABELS: Readonly<Record<StackOn, string>> = {
  never: "Never",
  tablet: "Tablet and mobile",
  mobile: "Mobile",
};

/** A tile's picture: its columns as bars, at their widths. */
function Glyph({ layout }: { layout: ColumnsLayout }): React.JSX.Element {
  return (
    <span className="nx-columns-layout__glyph" aria-hidden="true">
      {layout.tracks.map((width, index) => (
        <i key={index} style={{ flexGrow: width }} />
      ))}
    </span>
  );
}

/** What the row's widths are, said under the tiles. */
function hintFor(current: string, set: boolean): string {
  if (current === "custom") return "A layout of its own, set in Style.";
  if (current === "none") return "Pick how many columns, and how wide.";
  return set
    ? "Columns at these widths."
    : "Equal columns that wrap when narrow.";
}

/** How many columns the row holds now. */
function countOf(row: Row): number {
  return row.slots?.children?.length ?? 0;
}

/** Why the pointed tile is held, if one is. */
function heldReason(
  row: Parameters<typeof planLayout>[0],
  pointed: string | undefined,
  at: Parameters<typeof planLayout>[2]
): string | undefined {
  if (pointed === undefined) return undefined;
  const plan = planLayout(row, pointed, at);
  return plan.ok ? undefined : plan.reason;
}

type Row = NonNullable<ReturnType<typeof findNode>>;

/** The width tiles: one tab stop, arrows choosing, a held tile saying why. */
function WidthTiles({
  row,
  at,
  inherited,
  labelId,
  hintId,
  onPoint,
  editor,
}: {
  row: Row;
  at: { state: StyleState; breakpoint: BreakpointId };
  inherited: string | undefined;
  labelId: string;
  hintId: string;
  onPoint: (key: string | undefined) => void;
  editor: EditorState;
}): React.JSX.Element {
  const stored = readStyleValue(row.styles, {
    ...at,
    property: "gridTemplateColumns",
    path: [],
  });
  // What the canvas draws here: set here, or reaching it from a wider device.
  const current = layoutOf(
    stored ?? inherited,
    defaultTemplate(row),
    countOf(row)
  );
  const plans = COLUMNS_LAYOUTS.map(layout => planLayout(row, layout.key, at));
  const allowed = plans.map(plan => plan.ok);
  const stop = Math.max(
    0,
    COLUMNS_LAYOUTS.findIndex(layout => layout.key === current)
  );
  const choose = (index: number) => {
    // The chosen tile again changes nothing.
    if (COLUMNS_LAYOUTS[index]?.key === current) return;
    const plan = plans[index];
    if (plan?.ok === true && plan.ops.length > 0)
      editor.applyAll([...plan.ops]);
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="nx-columns-layout__tiles"
    >
      {COLUMNS_LAYOUTS.map((layout, index) => {
        const plan = plans[index];
        const held = plan !== undefined && !plan.ok;
        return (
          <button
            key={layout.key}
            type="button"
            role="radio"
            aria-checked={layout.key === current}
            aria-label={layout.label}
            tabIndex={index === stop ? 0 : -1}
            {...(layout.key === current &&
            stored === undefined &&
            inherited !== undefined
              ? { "data-inherited": "" }
              : {})}
            // Held, not disabled: still reachable, so its reason can be read;
            // the hint under the tiles says it, as its description.
            {...(held
              ? { "aria-disabled": true, "aria-describedby": hintId }
              : {})}
            className="nx-columns-layout__tile"
            onMouseEnter={() => onPoint(held ? layout.key : undefined)}
            onMouseLeave={() => onPoint(undefined)}
            onFocus={() => onPoint(held ? layout.key : undefined)}
            onBlur={() => onPoint(undefined)}
            onKeyDown={event => arrowTo(event, index, allowed, choose)}
            onClick={() => choose(index)}
          >
            <Glyph layout={layout} />
            <span>{layout.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ColumnsLayoutControl({
  editor,
  nodeId,
  state,
  breakpoint,
  breakpoints,
  inherited: reaching,
  applied,
}: {
  editor: EditorState;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  breakpoints: BreakpointSet | undefined;
  /** The template reaching the row from elsewhere, as the cascade answers it. */
  inherited?: string | undefined;
  /** What the cascade applies to the row at a tier, for a stack from elsewhere. */
  applied?: AppliedAt | undefined;
}): React.JSX.Element | null {
  const labelId = React.useId();
  const stackId = React.useId();
  const hintId = React.useId();
  // The held tile being hovered or focused, whose reason the hint then says.
  const [pointed, setPointed] = React.useState<string | undefined>(undefined);
  const row = findNode(editor.document.nodes, nodeId);
  if (row === undefined) return null;
  const at = { state, breakpoint };
  const stored = readStyleValue(row.styles, {
    ...at,
    property: "gridTemplateColumns",
    path: [],
  });
  // Only while nothing is set here: a value set here is the one in force.
  const inherited = stored === undefined ? reaching : undefined;
  const current = layoutOf(
    stored ?? inherited,
    defaultTemplate(row),
    countOf(row)
  );
  const tiers = stackTiers(breakpoints);
  const reached = reachedStacks(tiers, applied);
  const stack = stackOf(row, tiers, state, reached);
  const options = (["never", "tablet", "mobile"] as const).filter(
    on => on === "never" || tiers[on] !== undefined
  );
  const restack = (on: StackOn, reversed: boolean) => {
    const op = planStack(row, on, reversed, { tiers, state, reached });
    if (op !== null) editor.apply(op);
  };
  return (
    <div className="nx-columns-layout" data-control="columns-layout">
      <div className="nx-inspector__field nx-columns-layout__layout">
        <span className="nx-inspector__field-name" id={labelId}>
          Layout
        </span>
        <WidthTiles
          row={row}
          at={at}
          inherited={inherited}
          labelId={labelId}
          hintId={hintId}
          onPoint={setPointed}
          editor={editor}
        />
      </div>
      <p id={hintId} className="nx-inspector__note" aria-live="polite">
        {heldReason(row, pointed, at) ??
          hintFor(current, stored !== undefined || inherited !== undefined)}
      </p>
      {options.length > 1 ? (
        <>
          <div className="nx-inspector__field">
            <span className="nx-inspector__field-name" id={stackId}>
              Stack on
            </span>
            <SegmentChoices
              options={options}
              on={stack.on}
              labels={STACK_LABELS}
              labelId={stackId}
              onChoose={on => restack(on, stack.reversed)}
            />
          </div>
          <div className="nx-inspector__field">
            <span className="nx-inspector__field-name">
              Reverse when stacked
            </span>
            <Switch
              aria-label="Reverse when stacked"
              checked={stack.reversed}
              disabled={stack.on === "never"}
              onCheckedChange={reversed => restack(stack.on, reversed)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

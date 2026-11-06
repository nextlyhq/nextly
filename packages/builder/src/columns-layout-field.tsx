"use client";

/**
 * A Columns row's layout: tiles that set its columns at the edited device,
 * where it stacks, and whether it stacks reversed.
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

const STACK_LABELS: Readonly<Record<StackOn, string>> = {
  tablet: "Tablet",
  mobile: "Mobile",
  never: "Never",
};

/** A tile's glyph: its tracks as bars, Auto's with a dashed track that wraps. */
function Glyph({ layout }: { layout: ColumnsLayout }): React.JSX.Element {
  return (
    <span className="nx-columns-layout__glyph" aria-hidden="true">
      {layout.tracks.map((width, index) => (
        <i key={index} style={{ flexGrow: width }} />
      ))}
      {layout.key === "auto" ? (
        <i className="nx-columns-layout__wraps" />
      ) : null}
    </span>
  );
}

/** What the row's widths are, said under the tiles. */
function hintFor(current: string): string {
  if (current === "custom") return "A layout of its own, written as CSS below.";
  if (current === "auto") return "Equal columns that wrap when narrow.";
  return "Columns at these widths on this device.";
}

/** Why the pointed tile is held, if one is. */
function heldReason(
  row: Parameters<typeof planLayout>[0],
  pointed: string | undefined,
  at: Parameters<typeof planLayout>[2],
  inherited: string | undefined
): string | undefined {
  if (pointed === undefined) return undefined;
  const plan = planLayout(row, pointed, at, inherited);
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
  const current = layoutOf(stored ?? inherited, defaultTemplate(row));
  const plans = COLUMNS_LAYOUTS.map(layout =>
    planLayout(
      row,
      layout.key,
      at,
      stored === undefined ? inherited : undefined
    )
  );
  const allowed = plans.map(plan => plan.ok);
  const stop = Math.max(
    0,
    COLUMNS_LAYOUTS.findIndex(layout => layout.key === current)
  );
  const choose = (index: number) => {
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
            title={
              layout.key === "auto"
                ? "Equal columns that wrap when narrow"
                : undefined
            }
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
  const current = layoutOf(stored ?? inherited, defaultTemplate(row));
  const tiers = stackTiers(breakpoints);
  const reached = reachedStacks(tiers, applied);
  const stack = stackOf(row, tiers, state, reached);
  const options = (["tablet", "mobile", "never"] as const).filter(
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
          Widths
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
        {heldReason(row, pointed, at, inherited) ?? hintFor(current)}
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

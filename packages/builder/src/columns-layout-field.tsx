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
  BASE_BREAKPOINT,
  findNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import { Switch } from "@nextlyhq/ui";
import * as React from "react";

import {
  COLUMNS_LAYOUTS,
  COLUMNS_ROW,
  defaultTemplate,
  layoutHoldsValue,
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
import type { PanelSection } from "./panel-section";
import { arrowTo, SegmentChoices } from "./segment-choices";
import { appliedAtReader, selectedSubject } from "./style-panel-reading";
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

/**
 * Where every choice here writes: the row's own base values, whatever device,
 * state or shared style the Style tab is editing, since how many columns a
 * row holds is its structure. Stacking still names the devices it applies on.
 */
const ROW_OWN = { state: "base", breakpoint: BASE_BREAKPOINT } as const;

/** The width tiles: one tab stop, arrows choosing, a held tile saying why. */
function WidthTiles({
  row,
  current,
  labelId,
  hintId,
  onPoint,
  editor,
}: {
  row: Row;
  current: string;
  labelId: string;
  hintId: string;
  onPoint: (key: string | undefined) => void;
  editor: EditorState;
}): React.JSX.Element {
  const plans = COLUMNS_LAYOUTS.map(layout =>
    planLayout(row, layout.key, ROW_OWN)
  );
  const allowed = plans.map(plan => plan.ok);
  const stop = Math.max(
    0,
    COLUMNS_LAYOUTS.findIndex(layout => layout.key === current)
  );
  const choose = (index: number) => {
    const plan = plans[index];
    if (plan?.ok !== true) return;
    // The chosen tile again writes no template, only the columns it still
    // needs: a row reading "3 equal" with a column deleted gets it back.
    const ops =
      COLUMNS_LAYOUTS[index]?.key === current ? plan.columnOps : plan.ops;
    if (ops.length > 0) editor.applyAll([...ops]);
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
  breakpoints,
  applied,
}: {
  editor: EditorState;
  nodeId: string;
  breakpoints: BreakpointSet | undefined;
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
  const stored = readStyleValue(row.styles, {
    ...ROW_OWN,
    property: "gridTemplateColumns",
    path: [],
  });
  const current = layoutOf(stored, defaultTemplate(row), countOf(row));
  const tiers = stackTiers(breakpoints);
  const reached = reachedStacks(tiers, applied);
  const stack = stackOf(row, tiers, ROW_OWN.state, reached);
  const options = (["never", "tablet", "mobile"] as const).filter(
    on => on === "never" || tiers[on] !== undefined
  );
  const restack = (on: StackOn, reversed: boolean) => {
    const op = planStack(row, on, reversed, {
      tiers,
      state: ROW_OWN.state,
      reached,
    });
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
          current={current}
          labelId={labelId}
          hintId={hintId}
          onPoint={setPointed}
          editor={editor}
        />
      </div>
      <p id={hintId} className="nx-inspector__note" aria-live="polite">
        {heldReason(row, pointed, ROW_OWN) ??
          hintFor(current, stored !== undefined)}
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

/** What the Content tab knows of the page around a Columns row. */
export interface ColumnsSectionContext {
  readonly editor: EditorState;
  readonly nodeId: string;
  /** The block's type, which decides whether it has the section at all. */
  readonly blockName: string;
  /** The section's name, as the inspection names it. */
  readonly label: string;
  readonly breakpoints: BreakpointSet | undefined;
  /** The canvas's cascade, for a stack reaching the row from a shared style. */
  readonly cascade: PageStyleCascade | undefined;
  /** The tag the canvas draws the row as, which the cascade's subject names. */
  readonly renderedTag: string | undefined;
}

/**
 * A Columns row's Content section, Layout and Stack on, or `undefined` for
 * any other block. Its dot shows while the row stores a template or a stack.
 * A stack reaching the row is read from the cascade's base state, the state
 * every choice here writes.
 */
export function columnsContentSection(
  context: ColumnsSectionContext
): PanelSection | undefined {
  const { editor, nodeId, blockName, breakpoints } = context;
  if (blockName !== COLUMNS_ROW) return undefined;
  const row = findNode(editor.document.nodes, nodeId);
  if (row === undefined) return undefined;
  const applied = appliedAtReader({
    cascade: context.cascade,
    subject: selectedSubject(editor, context.cascade, context.renderedTag),
    state: ROW_OWN.state,
    breakpoints,
    nodeId,
  });
  return {
    key: context.label,
    label: context.label,
    holdsValue: layoutHoldsValue(row, stackTiers(breakpoints)),
    body: (
      <ColumnsLayoutControl
        editor={editor}
        nodeId={nodeId}
        breakpoints={breakpoints}
        applied={applied}
      />
    ),
  };
}

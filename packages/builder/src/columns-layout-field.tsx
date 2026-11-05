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
  layoutOf,
  planLayout,
  planStack,
  stackOf,
  stackTiers,
  type ColumnsLayout,
  type StackOn,
} from "./columns-layout";
import type { EditorState } from "./editor-state";
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

export function ColumnsLayoutControl({
  editor,
  nodeId,
  state,
  breakpoint,
  breakpoints,
}: {
  editor: EditorState;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  breakpoints: BreakpointSet | undefined;
}): React.JSX.Element | null {
  const labelId = React.useId();
  const stackId = React.useId();
  const reasonId = React.useId();
  const row = findNode(editor.document.nodes, nodeId);
  if (row === undefined) return null;
  const current = layoutOf(
    readStyleValue(row.styles, {
      state,
      breakpoint,
      property: "gridTemplateColumns",
      path: [],
    })
  );
  const tiers = stackTiers(breakpoints);
  const stack = stackOf(row, tiers, state);
  const options = (["tablet", "mobile", "never"] as const).filter(
    on => on === "never" || tiers[on] !== undefined
  );
  const restack = (on: StackOn, reversed: boolean) => {
    const op = planStack(row, on, reversed, { tiers, state });
    if (op !== null) editor.apply(op);
  };
  return (
    <div className="nx-columns-layout" data-control="columns-layout">
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          Layout
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="nx-columns-layout__tiles"
        >
          {COLUMNS_LAYOUTS.map(layout => {
            const plan = planLayout(row, layout.key, { state, breakpoint });
            const refused = plan.ok ? undefined : plan.reason;
            return (
              <button
                key={layout.key}
                type="button"
                role="radio"
                aria-checked={layout.key === current}
                aria-label={layout.label}
                title={
                  refused ??
                  (layout.key === "auto"
                    ? "Equal columns that wrap when narrow"
                    : undefined)
                }
                {...(refused === undefined
                  ? {}
                  : { "aria-describedby": `${reasonId}-${layout.key}` })}
                disabled={refused !== undefined}
                className="nx-columns-layout__tile"
                onClick={() => {
                  if (plan.ok && plan.ops.length > 0)
                    editor.applyAll([...plan.ops]);
                }}
              >
                <Glyph layout={layout} />
                <span>{layout.label}</span>
                {refused === undefined ? null : (
                  <span id={`${reasonId}-${layout.key}`} hidden>
                    {refused}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="nx-inspector__note">
        {current === "custom"
          ? "A layout of its own, written as CSS below."
          : current === "auto"
            ? "Equal columns that wrap when narrow."
            : "Columns at these widths on this device."}
      </p>
      {options.length > 1 ? (
        <>
          <div className="nx-inspector__field">
            <span className="nx-inspector__field-name" id={stackId}>
              Stack on
            </span>
            <div
              role="radiogroup"
              aria-labelledby={stackId}
              className="nx-columns-layout__stack"
            >
              {options.map(on => (
                <button
                  key={on}
                  type="button"
                  role="radio"
                  aria-checked={stack.on === on}
                  className="nx-columns-layout__stack-option"
                  onClick={() => restack(on, stack.reversed)}
                >
                  {STACK_LABELS[on]}
                </button>
              ))}
            </div>
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

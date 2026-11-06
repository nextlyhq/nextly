"use client";

/**
 * The block fixture's browser half: its editor entry and its custom inspector,
 * both imported by the generated component map.
 *
 * The entry re-exports the very definitions the server registers, so the
 * editor and the server agree on what each block is.
 */
import type { BlockInspectorProps } from "@nextlyhq/plugin-sdk/blocks";
import { useState, type JSX } from "react";

import { blockFixtureContribution } from "./blocks";

/** The editor entry the fixture's declaration names. */
export const blockFixtureEditor = blockFixtureContribution;

/**
 * The custom block's own inspector: one field, committed on blur or Enter, and
 * disabled while the block is read-only.
 */
export function FixtureInspector({
  props,
  commit,
  readOnly,
}: BlockInspectorProps): JSX.Element {
  const stored = typeof props.headline === "string" ? props.headline : "";
  const [draft, setDraft] = useState(stored);
  const send = () => {
    if (draft !== stored) commit("headline", draft);
  };
  return (
    <div className="nx-inspector__field" data-fixture-inspector="">
      <label htmlFor="fixture-headline">Fixture headline</label>
      <input
        id="fixture-headline"
        value={draft}
        disabled={readOnly}
        onChange={event => setDraft(event.target.value)}
        onBlur={send}
        onKeyDown={event => {
          if (event.key === "Enter") send();
        }}
      />
    </div>
  );
}

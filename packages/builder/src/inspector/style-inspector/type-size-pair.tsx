"use client";

/**
 * A type size picked in a block's font size field carries its line height.
 *
 * A type size is a pair of variables joined by name (`font-size.h2` and
 * `line-height.h2`). Picked for a block that has no line height of its own,
 * the same edit writes the line height's variable too, so the block reads
 * "From H2 type size" there, with "Detach" to give it a value of its own.
 * Where the block already has its own line height, the pick keeps it and
 * the field offers "Use H2's line height". The pairing is read through the
 * Type tab's own list of type sizes (`typeSizeChoices`), so the two never
 * disagree about which line height goes with a size.
 *
 * @module type-size-pair
 */
import {
  isTokenRef,
  tokenRef,
  type NodeStyles,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { useCanvasTokenMode } from "../../canvas/prefers-dark";
import { pickedTypeSize } from "../../site-text-rows";
import { variableFor } from "../../style-colour";
import { readStyleValue, type StyleAddress } from "../../style-values";
import { unlinkedValue } from "../../variable-choice";

/** The line height's address beside a font size's. */
function lineHeightAt(address: StyleAddress): StyleAddress {
  return { ...address, property: "lineHeight", path: [] };
}

/**
 * What a field at `address` writes with a font size pick: the paired line
 * height, for the field's write to make in the same edit.
 */
export function lineHeightPairFor(
  address: StyleAddress,
  tokens: SiteTokenSet | undefined
): (
  value: StyleValue,
  styles: NodeStyles | undefined
) => { address: StyleAddress; value: StyleValue } | undefined {
  return (value, styles) => pairedLineHeight(address, value, styles, tokens);
}

/**
 * The line height a font size pick writes with it, or `undefined` for none:
 * only a type size with a line height of its own, picked for a block that has
 * no line height at the same state and breakpoint.
 */
function pairedLineHeight(
  address: StyleAddress,
  value: StyleValue,
  styles: NodeStyles | undefined,
  tokens: SiteTokenSet | undefined
): { address: StyleAddress; value: StyleValue } | undefined {
  if (address.property !== "fontSize" || address.path.length > 0) {
    return undefined;
  }
  const choice = pickedTypeSize(tokens, value);
  if (choice?.lineHeight === undefined) return undefined;
  const at = lineHeightAt(address);
  if (readStyleValue(styles, at) !== undefined) return undefined;
  return { address: at, value: tokenRef(choice.lineHeight) };
}

/**
 * Under a block's line height field: "From H2 type size" with "Detach"
 * while the line height follows the type size the block's font size points
 * at, or "Use H2's line height" while the block has its own.
 */
export function TypeSizeLineHint({
  address,
  styles,
  tokens,
  onBlock,
  readOnly,
  onCommit,
}: {
  /** The line height field's address. */
  address: StyleAddress;
  styles: NodeStyles | undefined;
  tokens: SiteTokenSet | undefined;
  /** Whether the field edits a block, not a shared style: only then shown. */
  onBlock: boolean;
  readOnly: boolean;
  onCommit: (value: StyleValue) => unknown;
}): React.JSX.Element | null {
  // The mode the canvas draws, so Detach keeps the value it shows.
  const mode = useCanvasTokenMode();
  const hint = lineHintOf(address, styles, onBlock ? tokens : undefined);
  if (hint === undefined) return null;
  if (hint.follows) {
    // Resolved as the field's own Unlink resolves a variable: the value the
    // canvas shows, as the number a line height stores.
    const variable = variableFor(hint.partner, tokens, mode);
    return (
      <FollowsLine
        name={hint.name}
        own={
          readOnly || variable === undefined ? null : unlinkedValue(variable)
        }
        onCommit={onCommit}
      />
    );
  }
  return hint.own && !readOnly ? (
    <UseTypeSizeLine
      name={hint.name}
      onUse={() => onCommit(tokenRef(hint.partner))}
    />
  ) : null;
}

/**
 * What the hint under a line height field says, or nothing: the type size
 * the block's font size points at, its line height, and whether the block's
 * line height follows it or is its own. Nothing without the site's
 * variables, or for any other field.
 */
function lineHintOf(
  address: StyleAddress,
  styles: NodeStyles | undefined,
  tokens: SiteTokenSet | undefined
):
  | { name: string; partner: string; follows: boolean; own: boolean }
  | undefined {
  if (address.property !== "lineHeight" || tokens === undefined) {
    return undefined;
  }
  const size = readStyleValue(styles, { ...address, property: "fontSize" });
  const choice = pickedTypeSize(tokens, size);
  const partner = choice?.lineHeight;
  if (choice === undefined || partner === undefined) return undefined;
  const line = readStyleValue(styles, address);
  return {
    name: choice.name,
    partner,
    follows: isTokenRef(line) && line.$token === partner,
    own: line !== undefined,
  };
}

/** "From H2 type size", with "Detach" where the block may take its own. */
function FollowsLine({
  name,
  own,
  onCommit,
}: {
  name: string;
  own: StyleValue | null;
  onCommit: (value: StyleValue) => unknown;
}): React.JSX.Element {
  return (
    <p className="nx-type-pair">
      <span>{`From ${name} type size`}</span>
      {own === null ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-type-pair__action"
          onClick={() => onCommit(own)}
        >
          Detach
        </Button>
      )}
    </p>
  );
}

/** "Use H2's line height", under a block's own line height. */
function UseTypeSizeLine({
  name,
  onUse,
}: {
  name: string;
  onUse: () => void;
}): React.JSX.Element {
  return (
    <p className="nx-type-pair">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nx-type-pair__action"
        onClick={onUse}
      >
        {`Use ${name}'s line height`}
      </Button>
    </p>
  );
}

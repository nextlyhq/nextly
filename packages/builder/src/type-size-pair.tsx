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
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { typeSizeChoices, type TypeSizeChoice } from "./site-text-rows";
import { lineHeightFromText } from "./style-folded";
import { readStyleValue, type StyleAddress } from "./style-values";

/** The type size a value points at, where it points at one. */
export function pickedTypeSize(
  tokens: SiteTokenSet | undefined,
  value: StyleValue | undefined,
  /** The mode its pair is read in: the one the canvas draws. */
  mode: TokenMode = "light"
): TypeSizeChoice | undefined {
  if (tokens === undefined || !isTokenRef(value)) return undefined;
  return typeSizeChoices(tokens, mode).find(
    choice => choice.size === value.$token
  );
}

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

/** The value of a variable, by identity, in light. */
function lightValue(
  tokens: SiteTokenSet,
  identity: string
): string | undefined {
  return tokens.tokens.find(token => (token.id ?? token.name) === identity)
    ?.values.light;
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
  const asked = onBlock && address.property === "lineHeight";
  if (!asked || tokens === undefined) return null;
  const size = readStyleValue(styles, { ...address, property: "fontSize" });
  const choice = pickedTypeSize(tokens, size);
  const partner = choice?.lineHeight;
  if (choice === undefined || partner === undefined) return null;
  const line = readStyleValue(styles, address);
  const follows = isTokenRef(line) && line.$token === partner;
  if (follows) {
    const own = lineHeightFromText(lightValue(tokens, partner) ?? "");
    return (
      <p className="nx-type-pair">
        <span>{`From ${choice.name} type size`}</span>
        {readOnly || own === null ? null : (
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
  if (line === undefined || readOnly) return null;
  return (
    <p className="nx-type-pair">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nx-type-pair__action"
        onClick={() => onCommit(tokenRef(partner))}
      >
        {`Use ${choice.name}'s line height`}
      </Button>
    </p>
  );
}

/**
 * The Style tab's "Look" row: one tile per look the selected block's type
 * has, each drawn as the block would be, and its own look first. Choosing a
 * tile swaps the look the block wears; its shared style, if any, stays.
 *
 * @module look-tiles-view
 */

import {
  findNode,
  getBlock,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Check } from "lucide-react";
import * as React from "react";

import { siteBaseOf } from "./block-look-rows";
import type { EditorState } from "./editor-state";
import { variationLabel } from "./inserter";
import {
  boundLooksOf,
  lookChoice,
  lookTiles,
  lookTileStyle,
  looksOfType,
  wornLook,
  type LookTile,
} from "./look-tiles";
import { radioGroupStep } from "./roving-radios";

export interface LookTilesProps {
  readonly editor: EditorState;
  readonly library: readonly NamedClass[] | undefined;
  /** Why the block's design is held, when it is: the tiles are held too. */
  readonly held: string | undefined;
  readonly tokens: SiteTokenSet | undefined;
  /** The mode the selected block is drawn in, which each tile draws in. */
  readonly mode: TokenMode;
  /** Says why a chosen look was not applied, through the shell's notices. */
  readonly onRefused: (reason: string) => void;
}

/** What a specimen is drawn as, by the kind of block it stands for. */
function specimenKind(blockType: string): "button" | "image" | "band" | "text" {
  if (blockType === "core/button") return "button";
  if (blockType === "core/image") return "image";
  if (blockType === "core/section") return "band";
  return "text";
}

/** The words a specimen carries, where it carries any. */
const SPECIMEN_WORDS = { button: "Button", band: "Section", text: "Aa" };

/**
 * One look drawn as a small block of its type: the look's styles laid over the
 * type's base as the site draws it, so a tile and a Design row show what the
 * canvas shows.
 */
export function LookSpecimen({
  blockType,
  base,
  styles,
  tokens,
  mode,
}: {
  readonly blockType: string;
  readonly base: NodeStyles | undefined;
  readonly styles: NodeStyles | undefined;
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
}): React.JSX.Element {
  const kind = specimenKind(blockType);
  return (
    <span className="nx-look-tile__stage" aria-hidden="true">
      <span
        className="nx-look-tile__specimen"
        data-kind={kind}
        style={lookTileStyle(base, styles, tokens, mode)}
      >
        {kind === "image" ? null : SPECIMEN_WORDS[kind]}
      </span>
    </span>
  );
}

/** The block's own look's name, as its definition names it. */
function ownLookName(blockType: string): string | undefined {
  const own = getBlock(blockType)?.editor?.variations?.find(
    each => each.isDefault === true
  );
  return own === undefined ? undefined : variationLabel(own);
}

/** The node's classes after choosing a tile, as the op that stores them. */
function lookOp(nodeId: string, next: readonly string[]) {
  return next.length > 0
    ? { kind: "update" as const, id: nodeId, patch: { classes: [...next] } }
    : {
        kind: "update" as const,
        id: nodeId,
        patch: {},
        unset: ["classes" as const],
      };
}

export function LookTiles({
  editor,
  library,
  held,
  tokens,
  mode,
  onRefused,
}: LookTilesProps): React.JSX.Element | null {
  const nodeId = editor.selectedId;
  const node =
    nodeId === null ? undefined : findNode(editor.document.nodes, nodeId);
  const labelId = React.useId();
  const tiles =
    node === undefined || library === undefined
      ? []
      : lookTiles(library, node.type, ownLookName(node.type));
  if (node === undefined || library === undefined || tiles.length === 0) {
    return null;
  }
  const looks = looksOfType(library, node.type);
  const worn = wornLook(node.classes, looks);
  // Every look of the type comes off when another is chosen, those the
  // library no longer offers included, so none is left to return later.
  const removable = boundLooksOf(library, node.type);
  // The base as the site draws it, its edits to the own look included.
  const base = siteBaseOf(library, node.type);
  const choose = (tile: LookTile): void => {
    if (held !== undefined) return;
    const choice = lookChoice(node.classes, removable, tile.id);
    if (choice.kind === "unchanged") return;
    // A refused choice leaves the radio where it was: said, so the click does
    // not read as ignored.
    if (choice.kind === "full") {
      onRefused(
        `${tile.name} could not be applied to this block: it already lists the most classes a block can.`
      );
      return;
    }
    if (editor.applyAll([lookOp(node.id, choice.classes)]) === null) {
      onRefused(
        `${tile.name} could not be applied to this block: the page could not take the change.`
      );
    }
  };
  return (
    <div
      className="nx-look-tiles"
      data-held={held === undefined ? undefined : ""}
    >
      <div className="nx-look-tiles__head">
        <span id={labelId} className="nx-look-tiles__label">
          Look
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={held === undefined ? undefined : true}
        className="nx-look-tiles__grid"
        data-count={tiles.length}
        onKeyDown={event => {
          const step = radioGroupStep(event.key);
          if (step === null) return;
          event.preventDefault();
          const at = tiles.findIndex(tile => tile.id === worn);
          const next = tiles[(at + step + tiles.length) % tiles.length];
          if (next === undefined) return;
          choose(next);
          // Focus follows the choice, as a radio group's does.
          const group = event.currentTarget;
          requestAnimationFrame(() => {
            group
              .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
              ?.focus();
          });
        }}
      >
        {tiles.map(tile => {
          const checked = tile.id === worn;
          return (
            <button
              key={tile.id ?? "own"}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="nx-look-tile"
              title={held}
              onClick={() => choose(tile)}
            >
              {/* The choice said without colour as well as with the ring:
                  aria-checked for a reader, a mark for the eye. */}
              {checked ? (
                <span className="nx-look-tile__check" aria-hidden="true">
                  <Check size={10} strokeWidth={3} />
                </span>
              ) : null}
              <LookSpecimen
                blockType={node.type}
                base={base}
                styles={tile.styles}
                tokens={tokens}
                mode={mode}
              />
              <span className="nx-look-tile__name">
                {tile.name}
                {tile.id === null && tile.name !== "Default" ? (
                  <span className="nx-look-tile__tag">Default</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {held === undefined ? null : (
        <p className="nx-look-tiles__held">{held}</p>
      )}
    </div>
  );
}

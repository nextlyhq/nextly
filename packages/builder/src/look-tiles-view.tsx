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
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Check } from "lucide-react";
import * as React from "react";

import type { EditorState } from "./editor-state";
import {
  boundLooksOf,
  lookTiles,
  lookTileStyle,
  looksOfType,
  withLook,
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

/** The block's own look's name, as its definition names it. */
function ownLookName(blockType: string): string | undefined {
  return getBlock(blockType)?.editor?.variations?.find(
    each => each.isDefault === true
  )?.label;
}

/** The node's classes after choosing a tile, as the op that stores them. */
function lookOp(
  nodeId: string,
  classes: readonly string[] | undefined,
  looks: readonly NamedClass[],
  id: string | null
) {
  const next = withLook(classes, looks, id);
  return next.length > 0
    ? { kind: "update" as const, id: nodeId, patch: { classes: next } }
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
  const base = getBlock(node.type)?.baseStyles;
  const choose = (tile: LookTile): void => {
    if (held !== undefined || tile.id === worn) return;
    // A page at its limits takes nothing, and the radio stays where it was:
    // said, so the click does not read as ignored.
    if (
      editor.applyAll([lookOp(node.id, node.classes, removable, tile.id)]) ===
      null
    ) {
      onRefused(
        `${tile.name} could not be applied to this block: the page could not take the change.`
      );
    }
  };
  const kind = specimenKind(node.type);
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
              <span className="nx-look-tile__stage" aria-hidden="true">
                <span
                  className="nx-look-tile__specimen"
                  data-kind={kind}
                  style={lookTileStyle(base, tile.styles, tokens, mode)}
                >
                  {kind === "image" ? null : SPECIMEN_WORDS[kind]}
                </span>
              </span>
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

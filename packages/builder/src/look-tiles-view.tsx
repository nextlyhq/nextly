/**
 * The Style tab's "Block style" section, first in the tab and above the
 * editing bar: one tile per block style the selected block's type has, each
 * drawn as the block would be, its own style first and marked the default.
 * Choosing a tile swaps the block style the block wears; its shared style, if
 * any, stays. Under the tiles, one line says what a block style is and, where
 * the host can open Design, offers "Edit block styles" at the block's type.
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
import { ArrowUpRight, Check } from "lucide-react";
import * as React from "react";

import { siteBaseOf } from "./block-look-rows";
import type { EditorState } from "./editor-state";
import {
  boundLooksOf,
  lookChoice,
  lookTiles,
  lookStageStyle,
  lookTileStyle,
  looksOfType,
  wornLook,
  type LookTile,
} from "./look-tiles";
import { PanelSections } from "./panel-section";
import { variationLabel } from "./panels/add/inserter";
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
  /**
   * Opens the Design panel's Block styles at a block type. Absent, the line
   * under the tiles says what a block style is and offers no way there.
   */
  readonly onEditBlockStyles?: ((blockType: string) => void) | undefined;
}

/** The section's name, which its fold is remembered by. */
const BLOCK_STYLE_SECTION = "Block style";

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
    <span
      className="nx-look-tile__stage"
      aria-hidden="true"
      style={lookStageStyle(tokens, mode)}
    >
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
  onEditBlockStyles,
}: LookTilesProps): React.JSX.Element | null {
  const nodeId = editor.selectedId;
  const node =
    nodeId === null ? undefined : findNode(editor.document.nodes, nodeId);
  const worn =
    node === undefined || library === undefined
      ? null
      : wornLook(node.classes, looksOfType(library, node.type));
  const tiles =
    node === undefined || library === undefined
      ? []
      : lookTiles(library, node.type, ownLookName(node.type), worn);
  if (node === undefined || library === undefined || tiles.length === 0) {
    return null;
  }
  // Every look of the type comes off when another is chosen, those the
  // library no longer offers included, so none is left to return later.
  const removable = boundLooksOf(library, node.type);
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
    // A panel section as every other in the tab, so it folds and is
    // remembered as they are, and opens first as the tab's first section.
    // Its own list of one: the editing bar sits between it and the rest.
    <div className="nx-block-style">
      <PanelSections
        tab="style"
        sections={[
          {
            key: "block-style",
            label: BLOCK_STYLE_SECTION,
            // A style other than the block's own is a choice the block holds.
            holdsValue: worn !== null,
            body: (
              <div
                className="nx-look-tiles"
                data-held={held === undefined ? undefined : ""}
              >
                <TileGrid
                  tiles={tiles}
                  worn={worn}
                  held={held}
                  blockType={node.type}
                  base={siteBaseOf(library, node.type)}
                  tokens={tokens}
                  mode={mode}
                  onChoose={choose}
                />
                {held === undefined ? null : (
                  <p className="nx-look-tiles__held">{held}</p>
                )}
                <BlockStyleLine
                  blockType={node.type}
                  onEditBlockStyles={onEditBlockStyles}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The tiles as one radio group, named by the section: one Tab stop, the
 * arrows moving the choice, and focus following it.
 */
function TileGrid({
  tiles,
  worn,
  held,
  blockType,
  base,
  tokens,
  mode,
  onChoose,
}: {
  readonly tiles: readonly LookTile[];
  readonly worn: string | null;
  readonly held: string | undefined;
  readonly blockType: string;
  /** The base as the site draws it, its edits to the own look included. */
  readonly base: NodeStyles | undefined;
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
  readonly onChoose: (tile: LookTile) => void;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={BLOCK_STYLE_SECTION}
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
        onChoose(next);
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
            onClick={() => onChoose(tile)}
          >
            {/* The choice said without colour as well as with the ring:
                aria-checked for a reader, a mark for the eye. */}
            {checked ? (
              <span className="nx-look-tile__check" aria-hidden="true">
                <Check size={10} strokeWidth={3} />
              </span>
            ) : null}
            <LookSpecimen
              blockType={blockType}
              base={base}
              styles={tile.styles}
              tokens={tokens}
              mode={mode}
            />
            <TileName tile={tile} />
          </button>
        );
      })}
    </div>
  );
}

/** A tile's name, with "Default" on the block's own style and "Hidden" on one no longer offered. */
function TileName({ tile }: { readonly tile: LookTile }): React.JSX.Element {
  return (
    <span className="nx-look-tile__name">
      {tile.name}
      {tile.id === null && tile.name !== "Default" ? (
        <span className="nx-look-tile__tag">Default</span>
      ) : null}
      {/* Worn, and no longer offered to other blocks. */}
      {tile.hidden ? <span className="nx-look-tile__tag">Hidden</span> : null}
    </span>
  );
}

/**
 * The line under the tiles: what a block style is, by the block's own name
 * ("A saved style for every Section."), and the way to the Design panel's
 * Block styles at this type, where its styles are added, renamed and removed.
 */
function BlockStyleLine({
  blockType,
  onEditBlockStyles,
}: {
  readonly blockType: string;
  readonly onEditBlockStyles: ((blockType: string) => void) | undefined;
}): React.JSX.Element {
  const label = getBlock(blockType)?.editor?.label ?? "block";
  return (
    <p className="nx-block-style__line">
      {`A saved style for every ${label}.`}
      {onEditBlockStyles === undefined ? null : (
        <>
          {" "}
          <button
            type="button"
            className="nx-block-style__edit"
            onClick={() => onEditBlockStyles(blockType)}
          >
            Edit block styles
            {/* It opens another panel: the arrow says so, and is not read. */}
            <ArrowUpRight aria-hidden="true" size={12} />
          </button>
        </>
      )}
    </p>
  );
}

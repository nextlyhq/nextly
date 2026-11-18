/**
 * The Styles tab's Block styles section: every block type's block styles,
 * the block's own style first, each drawn as a small block of its type. A
 * type's styles fold under its name and end with "+ New <block> style".
 * Choosing a row edits that style in the style editor, with no block
 * selected; its ⋯ menu holds the style's other actions.
 *
 * Keyboard: Enter or Space on a row edits it, F2 renames a style the site
 * made, and the menu key or Shift+F10 opens its ⋯ menu. Escape in a name
 * field puts it down and hands focus back to the row it came from.
 *
 * @module block-looks-group
 * @experimental Settles with the Styles tab's Block styles.
 */

import type {
  NamedClass,
  SiteTokenSet,
  TokenMode,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  ownLookDescription,
  sameLook,
  siteBaseOf,
  type BlockLookGroup,
  type BlockLookRow,
  type LookKey,
} from "./block-look-rows";
import {
  BLOCK_STYLE_WORDS,
  newStyleWords,
  type BlockStyleActions,
  type BlockStyleMade,
} from "./block-style-actions";
import {
  blockStyleOffers,
  BlockStyleMenu,
  BlockStyleNameField,
  offersAny,
  type BlockStyleMenuActions,
  type BlockStyleOffers,
} from "./block-style-row-menu";
import { GroupToggle } from "./design-group-toggle";
import { LookSpecimen } from "./look-tiles-view";
import { blockLabel } from "./panels/add/inserter";
import {
  sharedStyleReachSentence,
  type BlocksOnThisPage,
  type SharedStyleReach,
} from "./shared-style-library";
import type { GroupFolds } from "./tokens-panel";

export interface BlockLooksGroupProps {
  readonly groups: readonly BlockLookGroup[];
  readonly library: readonly NamedClass[];
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
  /** The style being edited in the style editor, whose row shows as chosen. */
  readonly editing: LookKey | null | undefined;
  /** Edit a style in the style editor. Absent: the rows are shown, not chosen. */
  readonly onEdit?: (look: LookKey) => void;
  /** The host's writes. Absent, or read-only: the rows offer no action. */
  readonly actions?: BlockStyleActions;
  readonly readOnly?: boolean;
  /** Which types the author folded, kept by the host. Absent: none fold. */
  readonly folds?: GroupFolds;
  /** Whether a search is narrowing the rows: every type is open then. */
  readonly searching?: boolean;
  /** A worn style's reach, as the tab's usage read has it, or `undefined`. */
  readonly reachOf: (row: BlockLookRow) => SharedStyleReach | undefined;
  /**
   * The open page's blocks wearing a worn style, as the shared styles count
   * theirs: the page's unsaved blocks are not in the site's index yet.
   */
  readonly blocksOf: (row: BlockLookRow) => BlocksOnThisPage | undefined;
  /** A reach drawn as the shared styles' counts are. */
  readonly chip: (reach: SharedStyleReach) => React.ReactNode;
}

/**
 * A block type's group in the author's folds, and the name a reveal finds it
 * by (`data-group`), so a host sending the author to one type's styles opens
 * the group this section draws.
 *
 * @experimental Settles with the Design panel's Block styles.
 */
export function blockStyleFoldId(blockType: string): string {
  return `block-styles:${blockType}`;
}

/** Whether the section may write: a host's actions, and a role that may change Design. */
function writableOf(props: BlockLooksGroupProps): boolean {
  return props.readOnly !== true && props.actions !== undefined;
}

export function BlockLooksGroup(
  props: BlockLooksGroupProps
): React.JSX.Element | null {
  const headingId = React.useId();
  const lineId = React.useId();
  if (props.groups.length === 0) return null;
  return (
    <section
      className="nx-vars__group nx-block-styles"
      aria-labelledby={headingId}
      aria-describedby={lineId}
    >
      <div className="nx-block-styles__head">
        <h3 id={headingId} className="nx-vars__group-name">
          {BLOCK_STYLE_WORDS.heading}
        </h3>
        <p id={lineId} className="nx-block-styles__line">
          {BLOCK_STYLE_WORDS.line}
        </p>
      </div>
      {props.groups.map(group => (
        <TypeGroup key={group.blockType} group={group} panel={props} />
      ))}
    </section>
  );
}

/** Whether a type's group is folded: never while a search narrows the rows. */
function foldedOf(panel: BlockLooksGroupProps, id: string): boolean {
  return panel.searching !== true && panel.folds?.folded.has(id) === true;
}

/** One block type's styles under its folding heading, then its add row. */
function TypeGroup({
  group,
  panel,
}: {
  readonly group: BlockLookGroup;
  readonly panel: BlockLooksGroupProps;
}): React.JSX.Element {
  const title = blockLabel(group.blockType);
  const base = siteBaseOf(panel.library, group.blockType);
  const id = blockStyleFoldId(group.blockType);
  const folded = foldedOf(panel, id);
  const folds = panel.searching === true ? undefined : panel.folds;
  return (
    <div
      className="nx-block-styles__type"
      data-group={id}
      data-block-type={group.blockType}
    >
      <h4 className="nx-block-styles__type-head">
        <GroupToggle
          heading={title}
          count={group.rows.length}
          open={!folded}
          onToggle={
            folds === undefined ? undefined : () => folds.onFold(id, !folded)
          }
        />
      </h4>
      {folded ? null : (
        <>
          <ul className="nx-block-styles__rows" aria-label={`${title} styles`}>
            {group.rows.map(row => (
              <li key={row.id}>
                <StyleRow
                  row={row}
                  title={title}
                  panel={panel}
                  specimen={
                    <LookSpecimen
                      blockType={group.blockType}
                      // The own style's specimen is the site's base itself;
                      // every other style is drawn over it.
                      base={base}
                      styles={row.own ? undefined : row.styles}
                      tokens={panel.tokens}
                      mode={panel.mode}
                    />
                  }
                />
              </li>
            ))}
          </ul>
          {writableOf(panel) ? (
            <NewStyleRow
              blockType={group.blockType}
              title={title}
              panel={panel}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Focus a button once the field that took its place is gone. */
function focusLater(target: React.RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => target.current?.focus());
}

/** "+ New <block> style", then the field its name is typed in. */
function NewStyleRow({
  blockType,
  title,
  panel,
}: {
  readonly blockType: string;
  readonly title: string;
  readonly panel: BlockLooksGroupProps;
}): React.JSX.Element {
  const [naming, setNaming] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const words = newStyleWords(title);
  if (naming) {
    return (
      <BlockStyleNameField
        label={`${words.slice(2)} name`}
        initial=""
        onCommit={async name => {
          const made = await panel.actions?.create(blockType, name);
          if (made === undefined) return undefined;
          if (!made.ok) return made.reason;
          setNaming(false);
          // Opened in the style editor, as the new style's first edit.
          panel.onEdit?.({ id: made.id, blockType });
          return undefined;
        }}
        onCancel={() => {
          setNaming(false);
          focusLater(button);
        }}
      />
    );
  }
  return (
    <button
      ref={button}
      type="button"
      className="nx-block-styles__add"
      onClick={() => setNaming(true)}
    >
      {words}
    </button>
  );
}

/** A row's chips: ★ Default and Hidden, then how widely it is used. */
function Chips({
  row,
  reach,
  chip,
}: {
  readonly row: BlockLookRow;
  readonly reach: SharedStyleReach | undefined;
  readonly chip: (reach: SharedStyleReach) => React.ReactNode;
}): React.JSX.Element {
  // Hidden from assistive technology: the row's name says each in words.
  return (
    <span className="nx-block-styles__chips" aria-hidden="true">
      {row.starred ? (
        <span className="nx-vars__chip nx-block-styles__star">
          {BLOCK_STYLE_WORDS.defaultChip}
        </span>
      ) : null}
      {row.hidden ? (
        <span className="nx-vars__chip">{BLOCK_STYLE_WORDS.hidden}</span>
      ) : null}
      {reach === undefined ? null : chip(reach)}
    </span>
  );
}

/** What a row is called: its name, what it is, and its reach in words. */
function rowName(row: BlockLookRow, sentence: string): string {
  return [
    row.name,
    row.starred ? "default" : "",
    row.hidden ? "hidden" : "",
    row.inCode && !row.own ? "built-in" : "",
    sentence,
  ]
    .filter(part => part !== "")
    .join(", ");
}

/** A write's refusal in words, or nothing once stored. */
type Write = () => Promise<string | undefined>;

/** A write that makes a style, opening the style it made in the style editor. */
function opening(
  make: () => Promise<BlockStyleMade>,
  open: (id: string) => void
): Write {
  return async () => {
    const made = await make();
    if (!made.ok) return made.reason;
    open(made.id);
    return undefined;
  };
}

/**
 * Why a style can't be removed for what the open page holds, or `undefined`:
 * a block on it wears the style, unsaved and so in no document the removal
 * reads, or the page has more blocks than could be read to tell.
 */
function pageUseRefusal(
  row: BlockLookRow,
  blocks: BlocksOnThisPage | undefined
): string | undefined {
  if (blocks === undefined || !blocks.complete) {
    return `${row.name} can't be removed: this page has more blocks than could be read to check it isn't used.`;
  }
  if (blocks.count === 0) return undefined;
  const them = blocks.count === 1 ? "1 block" : `${blocks.count} blocks`;
  return `${row.name} is used on ${them} on this page. Take it off them first.`;
}

/** The menu's actions for one row, through the host's writes. */
function menuActionsOf(
  row: BlockLookRow,
  panel: BlockLooksGroupProps,
  run: (write: Write | undefined) => void,
  onRename: () => void
): BlockStyleMenuActions {
  const actions = panel.actions;
  const edit = (id: string) => panel.onEdit?.({ id, blockType: row.blockType });
  return {
    onEdit: () => edit(row.id),
    onSetDefault: () =>
      run(
        actions &&
          (() => actions.setDefault(row.blockType, row.own ? null : row.id))
      ),
    onRename,
    onDuplicate: () =>
      run(actions && opening(() => actions.duplicate(row.id), edit)),
    onHidden: hidden =>
      run(actions && (() => actions.setHidden(row.id, hidden))),
    onRemove: () =>
      run(
        actions &&
          (async () =>
            pageUseRefusal(row, panel.blocksOf(row)) ?? actions.remove(row.id))
      ),
  };
}

/** Whether a key on a row opens its ⋯ menu: the menu key, or Shift+F10. */
function opensMenu(event: React.KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/** The row's keys: F2 renames where a rename is offered; the menu key opens ⋯. */
function rowKeys(
  offers: BlockStyleOffers,
  onRename: () => void,
  onMenu: () => void
): (event: React.KeyboardEvent) => void {
  return event => {
    if (event.key === "F2" && offers.rename) {
      event.preventDefault();
      onRename();
    } else if (opensMenu(event) && offersAny(offers)) {
      event.preventDefault();
      onMenu();
    }
  };
}

function StyleRow({
  row,
  title,
  panel,
  specimen,
}: {
  readonly row: BlockLookRow;
  readonly title: string;
  readonly panel: BlockLooksGroupProps;
  readonly specimen: React.ReactNode;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Set while the menu was opened from the row by its keys, so closing it
  // returns there; a ref, since the close reads it after the last render.
  const returnTo = React.useRef<HTMLElement | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const rowRef = React.useRef<HTMLButtonElement>(null);
  const reach = row.own ? undefined : panel.reachOf(row);
  const sentence = sharedStyleReachSentence(
    row.own ? undefined : panel.blocksOf(row),
    reach
  );
  const offers = blockStyleOffers(
    {
      own: row.own,
      builtIn: row.inCode,
      starred: row.starred,
      hidden: row.hidden,
    },
    !writableOf(panel)
  );
  const run = (write: Write | undefined): void => {
    if (write === undefined) return;
    void write().then(refused => setRefusal(refused ?? null));
  };
  const startRename = () => {
    setRefusal(null);
    setRenaming(true);
  };
  // Drawn only while the section may still write: a role that loses the
  // right with the field open is shown the row again.
  if (renaming && writableOf(panel)) {
    return (
      <BlockStyleNameField
        label={`Rename ${row.name}`}
        initial={row.name}
        onCommit={async name => {
          if (!writableOf(panel)) return undefined;
          const refused = await panel.actions?.rename(row.id, name);
          if (refused === undefined) {
            setRenaming(false);
            focusLater(rowRef);
          }
          return refused;
        }}
        onCancel={() => {
          setRenaming(false);
          focusLater(rowRef);
        }}
      />
    );
  }
  return (
    <div
      className="nx-vars__line nx-block-styles__item"
      data-hidden={row.hidden ? "" : undefined}
    >
      <button
        ref={rowRef}
        type="button"
        className="nx-vars__row nx-block-styles__row"
        aria-pressed={
          panel.onEdit === undefined ? undefined : sameLook(row, panel.editing)
        }
        aria-label={rowName(row, sentence)}
        aria-description={row.own ? ownLookDescription(title) : undefined}
        title={sentence === "" ? undefined : sentence}
        data-block-look={row.id}
        onClick={() => panel.onEdit?.({ id: row.id, blockType: row.blockType })}
        onKeyDown={rowKeys(offers, startRename, () => {
          returnTo.current = rowRef.current;
          setMenuOpen(true);
        })}
      >
        <span className="nx-block-looks__specimen">{specimen}</span>
        <span className="nx-vars__name" title={row.name}>
          {row.name}
        </span>
        <Chips row={row} reach={reach} chip={panel.chip} />
      </button>
      {offersAny(offers) ? (
        <BlockStyleMenu
          name={row.name}
          offers={offers}
          actions={menuActionsOf(row, panel, run, startRename)}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          returnTo={returnTo}
        />
      ) : null}
      {refusal === null ? null : (
        <p
          className="nx-vars-editor__issue nx-block-styles__issue"
          role="alert"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}

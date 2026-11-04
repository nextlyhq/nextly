"use client";

/**
 * The editor's command palette, assembled and mounted.
 *
 * `CommandPalette` is the surface and `builderCommands` is the list; this is
 * the one piece that knows both, and it exists so a host does not have to.
 * Mounting the palette otherwise means reaching into the verbs context,
 * rebuilding the command array on the right renders, and knowing that the
 * palette must sit inside `BlockKeyboardActions` — three things every host
 * would have to get right, and would get right differently.
 *
 * **It was the missing piece.** `CommandPalette` shipped and was tested and was
 * exported, and no host ever mounted it — so the editor advertised a command
 * palette that no author could open. Pressing `mod+k` in the admin opens
 * `@nextlyhq/admin`'s palette instead, which is the reason the gap survived a
 * browser check: something opens, so the feature looks present.
 *
 * @module editor-command-palette
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import { builderCommands } from "./builder-commands";
import {
  CommandPalette,
  type BuilderCommand,
  type CommandGroupOptions,
} from "./command-palette";
import type { EditorState } from "./editor-state";
import {
  placementWords,
  useInsertOffers,
  type InsertOffers,
  type InsertOffersInputs,
} from "./insert-panel";
import { blockLabel, filterEntries } from "./inserter";
import { useBlockActionsContext } from "./keyboard-actions";
import {
  layersOf,
  UNNAMED_COMPONENT,
  type ComponentTitleOf,
  type LayerNode,
} from "./layers";
import { useSelectionActions } from "./selection-actions";

/** The groups a search shows, in the order an author reads them. */
const ADD_GROUP = "Add";
const PAGE_GROUP = "On this page";
/** How many of each kind a search shows: enough to choose from at a glance. */
const SEARCH_LIMIT = 5;

/**
 * Results the host finds elsewhere, such as the site's other pages, shown as
 * one more group between the page's blocks and the commands.
 *
 * @experimental
 */
export interface EditorSearchResults {
  /** The group's heading, and what it says while its search runs or fails. */
  group: Omit<CommandGroupOptions, "matched">;
  /** What the host found for the current search, best first. */
  commands: readonly BuilderCommand[];
}

export interface EditorCommandPaletteProps {
  /** The editor whose state the commands read and change. */
  editor: EditorState;
  /**
   * Leaving the editor, when the host has somewhere to go.
   *
   * Omitted where there is nowhere — the editor embedded in a form that is
   * already on screen — and the palette then offers no way out rather than a
   * command that does nothing. Passed to `builderCommands`, which makes the
   * same distinction the shell's exit affordance does.
   */
  onExit?: () => void;
  /**
   * What the Add panel adds from, so a search offers the same blocks and adds
   * each where the panel would. Without it, search adds nothing.
   */
  insert?: Omit<InsertOffersInputs, "editor" | "enabled">;
  /** Bring a block into view on the canvas once a search has selected it. */
  revealBlock?: (id: string) => void;
  /** Results the host searches for itself: the site's other pages. */
  results?: EditorSearchResults;
  /** Told the search as the author types it, for the host's own results. */
  onSearchChange?: (query: string) => void;
  /**
   * A component's title by id, so a placed component is found and named by
   * what the author placed, as Layers names it.
   */
  componentTitle?: ComponentTitleOf;
  /** Controls the palette, for a host that also opens it from a button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EditorCommandPalette({
  editor,
  onExit,
  insert,
  revealBlock,
  results,
  onSearchChange,
  componentTitle,
  open,
  onOpenChange,
}: EditorCommandPaletteProps): React.JSX.Element {
  const verbs = useBlockActionsContext();
  const actions = useSelectionActions(editor);
  // Taken out of `editor` so the list below depends on these two functions
  // rather than on the store object, for the reason given there.
  const { undo, redo } = editor;

  /*
   * Rebuilt when what it OFFERS could have changed, which is the document, the
   * selection and the history's two flags.
   *
   * `editor` as a whole would be the obvious dependency and is the wrong one:
   * the store hands back a fresh object on every render, so the list would be
   * rebuilt on every frame of a panel drag — and `CommandPalette` keys its rows
   * on identity, so a list rebuilt mid-search is a list that loses the row the
   * author had highlighted.
   */
  const commands = React.useMemo(
    () =>
      builderCommands({
        // The SAME list the bar and the menu are drawing, not a second call
        // that could be given a narrower question — which is how this surface
        // came to offer a verb the bar refused.
        actions,
        verbs,
        // Undo and redo answer as a promise for a recorded step. The palette
        // only runs them, and that promise settles on its own (a failed step
        // answers `false` rather than rejecting), so the answer is let go here
        // rather than handed to a command whose `run` returns nothing.
        undo: () => {
          void undo();
        },
        redo: () => {
          void redo();
        },
        canUndo: editor.canUndo,
        canRedo: editor.canRedo,
        onExit,
      }),
    [actions, undo, redo, editor.canUndo, editor.canRedo, verbs, onExit]
  );

  // What is being searched for, so the blocks to add are matched as the Add
  // panel matches them and the page's blocks are listed only while searching.
  const [query, setQuery] = React.useState("");
  const offers = useInsertOffers({
    editor,
    ...insert,
    // Judged only while a search could show them.
    enabled: insert !== undefined && query !== "",
  });
  const found = [
    ...(insert === undefined ? [] : addCommands(offers, editor, query)),
    ...pageCommands(
      editor,
      query,
      revealBlock,
      iconsOf(offers.catalog),
      componentTitle
    ),
    ...(results?.commands ?? []),
    ...commands,
  ];

  return (
    <CommandPalette
      commands={found}
      groups={[
        // Already matched, by the Add panel's own rule.
        { name: ADD_GROUP, limit: SEARCH_LIMIT, matched: true },
        { name: PAGE_GROUP, limit: SEARCH_LIMIT },
        ...(results === undefined ? [] : [{ ...results.group, matched: true }]),
      ]}
      onSearchChange={next => {
        setQuery(next);
        onSearchChange?.(next);
      }}
      placeholder="Search blocks, this page, pages and commands…"
      emptyMessage={searched => (
        <>
          <p className="text-foreground">Nothing matches “{searched}”.</p>
          <p className="mt-1">
            Search finds blocks to add, blocks on this page, your pages and
            commands.
          </p>
        </>
      )}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    />
  );
}

/**
 * The blocks and components the Add panel would offer for this search, each
 * saying where it will go and added there.
 *
 * Matched by the panel's own filter, so search and the panel agree on what a
 * word finds. Saved sections stay in the panel, and a block with nowhere to go
 * is left out: a search row is there to be chosen, and the panel is where the
 * reason is explained.
 */
function addCommands(
  { catalog, offers, insert }: InsertOffers,
  editor: Pick<EditorState, "document">,
  query: string
): BuilderCommand[] {
  if (query === "") return [];
  return byLabelFirst(filterEntries(catalog, query), query).flatMap(entry => {
    const offer = offers.get(entry.id);
    if (entry.kind === "pattern" || offer?.place === undefined) return [];
    return [
      {
        id: `add:${entry.id}`,
        label: entry.label,
        group: ADD_GROUP,
        icon: <BlockIconMark icon={entry.icon} size={16} />,
        // The panel's words: "Adding after Hero", or, when this block can't
        // go there, where it goes instead.
        detail: placementWords(
          offer.climbed ? "Goes" : "Adding",
          editor.document,
          offer.place
        ),
        verb: "Add",
        run: () => insert(offer),
      },
    ];
  });
}

/**
 * The page's blocks, by the names Layers shows, each saying what it is and
 * where it sits. Listed only while searching: the whole page is what Layers
 * is for.
 */
function pageCommands(
  editor: Pick<EditorState, "document" | "select">,
  query: string,
  revealBlock: ((id: string) => void) | undefined,
  icons: ReadonlyMap<string, string | undefined>,
  componentTitle: ComponentTitleOf | undefined
): BuilderCommand[] {
  if (query === "") return [];
  return blocksOnPage(editor.document, componentTitle).map(
    ({ layer, parent }) => {
      // A placement is a component, in the word and the mark Layers uses, rather
      // than the engine's name for its node type.
      const kind = layer.component ? UNNAMED_COMPONENT : blockLabel(layer.type);
      return {
        id: `block:${layer.id}`,
        label: layer.label,
        // The same mark the Add panel draws for this kind of block.
        icon: (
          <BlockIconMark
            icon={layer.component ? "component" : icons.get(layer.type)}
            size={16}
          />
        ),
        // Found by what it is as well as by its name: "heading" finds them all.
        keywords: [kind],
        group: PAGE_GROUP,
        // The kind only where the name doesn't already say it.
        detail: [
          ...(layer.label === kind ? [] : [kind]),
          ...(parent === undefined ? [] : [`in ${parent.label}`]),
        ].join(" · "),
        verb: "Select",
        run: () => {
          editor.select(layer.id);
          revealBlock?.(layer.id);
        },
      };
    }
  );
}

/**
 * The panel's matches, those whose NAME the search begins a word of first,
 * then those whose name holds it, then the rest (a match in a description or
 * a keyword). Stable, so the panel's order holds within each.
 */
function byLabelFirst<TEntry extends { label: string }>(
  entries: readonly TEntry[],
  query: string
): TEntry[] {
  const wanted = query.toLowerCase();
  const rank = (label: string): number => {
    const lower = label.toLowerCase();
    if (lower.startsWith(wanted) || lower.includes(` ${wanted}`)) return 0;
    return lower.includes(wanted) ? 1 : 2;
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry.label) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(ranked => ranked.entry);
}

/** Each block type's mark, as the Add panel's catalogue names it. */
function iconsOf(
  catalog: InsertOffers["catalog"]
): ReadonlyMap<string, string | undefined> {
  const icons = new Map<string, string | undefined>();
  for (const entry of catalog) {
    if (entry.kind === "block" && !icons.has(entry.blockName)) {
      icons.set(entry.blockName, entry.icon);
    }
  }
  return icons;
}

/** Every block on the page, in document order, with the block it sits in. */
function blocksOnPage(
  document: BlockDocument,
  componentTitle: ComponentTitleOf | undefined
): { layer: LayerNode; parent?: LayerNode }[] {
  const out: { layer: LayerNode; parent?: LayerNode }[] = [];
  // Bounded by the document's size: each node is visited once.
  const walk = (nodes: readonly LayerNode[], parent?: LayerNode): void => {
    for (const layer of nodes) {
      out.push(parent === undefined ? { layer } : { layer, parent });
      walk(layer.children, layer);
    }
  };
  walk(layersOf(document, componentTitle));
  return out;
}

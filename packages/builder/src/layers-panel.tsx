"use client";

/**
 * The layers panel: the page as a tree, and the way to reach a block the canvas
 * cannot show.
 *
 * Decides nothing about the tree itself — `layers.ts` derives it, filters it and
 * says what has to open. This draws what that returns and owns one thing the
 * pure module cannot: which branches are expanded, which is state rather than
 * derivation.
 *
 * **The tree is `@nextlyhq/ui`'s `TreeView`, not one built here.** That
 * component exists for this control and says so: virtualized so a document of a
 * few thousand blocks costs a window rather than a tree, and flat
 * `role="treeitem"` rows carrying `aria-level`/`aria-setsize`/`aria-posinset`
 * because virtualization makes the nested `role="group"` markup impossible to
 * build. It also brings the APG keyboard model and typeahead. Reimplementing
 * any of that here would be a second answer to a question the design system has
 * already answered, and the accessibility half is the half that would rot.
 *
 * ## Three things open a branch, and they are not the same kind of thing
 *
 * The author clicks a twisty; a selection made on the canvas sits inside
 * collapsed containers; a search finds a match that is buried. Treating all
 * three as one derived union looks right and makes an ancestor of the selected
 * block IMPOSSIBLE TO CLOSE — the author collapses it, the next render puts it
 * straight back.
 *
 * So they are split by how long they should last. A selection opens its
 * ancestors ONCE, into the author's own set, and the author may close them
 * again. A search opens its matches' ancestors only while the query stands, so
 * clearing it returns the tree to what the author had open. Only the author's
 * set is stored.
 *
 * ## The panel says how to reorder, because nothing else does
 *
 * The bindings that move a block already work here — the tree holds focus and
 * the editor's own keystrokes act on the selection, so an author standing in
 * this panel can already reorder and nest without touching the canvas. Nothing
 * told them so, and a capability nobody can find reads exactly like a missing
 * one.
 *
 * The hint is DERIVED from the bindings rather than written beside them. A
 * retyped "Alt+Up" is correct until someone rebinds the keystroke, and then it
 * is a label that teaches a key which does nothing — with no test that can
 * fail, because the two are only related by having been typed by the same
 * person on the same day.
 *
 * It is also the tree's accessible description, not merely text near it. A
 * sighted author reads it because it sits under the tree; a screen-reader user
 * hears it on entering the tree, which is the moment the question arises.
 *
 * @module layers-panel
 */

import { allBlocks } from "@nextlyhq/blocks-engine";
import {
  Input,
  TreeView,
  detectApplePlatform,
  type TreeNode,
} from "@nextlyhq/ui";
import { EyeOff, Lock, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { EditorState } from "./editor-state";
import { keyHint } from "./key-hint";
import { MOVE_KEYS } from "./keyboard-actions";
import type { MoveDirection } from "./keyboard-move";
import { ancestorIds, filterLayers, layersOf, type LayerNode } from "./layers";

export interface LayersPanelProps {
  /** The editor whose document this shows and whose selection it drives. */
  editor: EditorState;
  /**
   * Whether the block-move keystrokes are bound for THIS editor.
   *
   * Asked of the host rather than worked out here, and that is the third answer
   * to this question — the first two were wrong in instructive ways. A React
   * context said no in the product, because `BlocksField` draws this panel
   * through the shell's panel region while the bindings wrap the shell's
   * children, and those are sibling subtrees. Asking the shortcut manager fixed
   * that and broke two other things: it made a `ShortcutProvider` mandatory for
   * a panel that never needed one, and it cannot tell one editor's bindings
   * from another's, so a second editor's enabled keys advertised themselves in
   * a panel whose own were off.
   *
   * The host is the only place that knows, because the host is what mounts both
   * halves. Defaults to `false`: a panel told nothing says nothing, which is
   * the safe direction for a claim that pressing something does something.
   */
  moveHints?: boolean;
}

/** One badge: an icon nobody has to see, and a word every reader gets. */
function Badge({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}): React.JSX.Element {
  return (
    <span className="nx-layer-row__badge">
      {/*
        The icon is decorative and the word is the fact. A title attribute would
        reach a pointer and nothing else, and an icon alone announces as an
        image with no name — so the text ships and is clipped visually.
      */}
      <span aria-hidden="true">{icon}</span>
      <span className="nx-sr-only">{text}</span>
    </span>
  );
}

/**
 * What each block type draws, by type.
 *
 * A layer node carries the block's TYPE and nothing about its definition —
 * `layersOf` reads a document, and a document does not hold editor metadata. So
 * the lookup happens here, where the registry is already reachable, rather than
 * by widening what the derivation returns.
 *
 * Read ONCE per mount, for the reason the insert panel gives for reading the
 * registry the same way: it is global mutable state with no change
 * notification, so there is nothing to subscribe to.
 */
function iconsByType(): ReadonlyMap<string, string | undefined> {
  return new Map(
    allBlocks().map(definition => [definition.name, definition.editor?.icon])
  );
}

/** A layer as a row: its mark, its name, and what is true about it. */
function rowOf(
  node: LayerNode,
  icons: ReadonlyMap<string, string | undefined>
): TreeNode {
  return {
    id: node.id,
    // `textValue` carries the NAME alone even though the label renders badges
    // beside it. Typeahead matches what an author would type, and a row whose
    // searchable text included "Locked" would be reachable by typing a word
    // that is not its name.
    textValue: node.label,
    label: (
      <span className="nx-layer-row">
        <BlockIconMark icon={icons.get(node.type)} size={14} />
        <span className="nx-layer-row__label">{node.label}</span>
        {node.locked ? <Badge icon={<Lock size={12} />} text="Locked" /> : null}
        {node.breakpointHidden ? (
          <Badge
            icon={<EyeOff size={12} />}
            text="Hidden at some screen sizes"
          />
        ) : null}
        {node.conditional ? (
          <Badge
            icon={<SlidersHorizontal size={12} />}
            text="Shown conditionally"
          />
        ) : null}
      </span>
    ),
    children: node.children.map(child => rowOf(child, icons)),
  };
}

/**
 * The short label each direction gets in the legend.
 *
 * The binding's own `description` is a SENTENCE — "Move the selected block into
 * the container above it" — because it is written to be announced after the
 * move happens, where the subject has to be named. Four of those stacked under
 * a tree is a paragraph rather than a legend, and it reads as prose to be
 * waded through rather than a key to be scanned.
 *
 * So the legend names the DIRECTION, which the binding table already carries as
 * an enum. That keeps this a projection of something the editor decided rather
 * than a second wording of it: total over `MoveDirection`, so a direction added
 * to the move rule fails to compile here instead of silently drawing nothing.
 *
 * One verb across all four, matching the arrow that runs them, so the pairs
 * read as opposites rather than as four unrelated commands.
 */
const DIRECTION_LABEL: Readonly<Record<MoveDirection, string>> = {
  up: "Move up",
  down: "Move down",
  indent: "Move in",
  outdent: "Move out",
};

export function LayersPanel({
  editor,
  moveHints = false,
}: LayersPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [opened, setOpened] = React.useState<readonly string[]>([]);

  // Recomputed each render rather than memoised. The tree is only valid against
  // the document it was read from, and every edit replaces that document — a
  // memo would need the document as its key and would therefore never hit.
  const tree = layersOf(editor.document);
  const search = filterLayers(tree, query);

  /*
   * The document, read at effect time rather than depended on.
   *
   * The effect below must run when the SELECTION moves and not when the
   * document changes. Listing the document as a dependency would re-open the
   * selected block's ancestors after every edit, so a branch the author closed
   * would spring back open the next time they typed in the inspector.
   */
  const documentRef = React.useRef(editor.document);
  documentRef.current = editor.document;

  /*
   * A selection made elsewhere opens its ancestors ONCE.
   *
   * Written into state rather than merged into the expanded set at render.
   * Derived, it could not be undone: the author collapses a branch, the union
   * puts it straight back, and an ancestor of the selected block becomes
   * impossible to close.
   */
  React.useEffect(() => {
    const needed = ancestorIds(documentRef.current, editor.selectedId);
    if (needed.length === 0) return;
    setOpened(previous => {
      const missing = needed.filter(id => !previous.includes(id));
      // Returning the same array when nothing is missing is what stops this
      // effect re-rendering forever: a new array every run is a new state value.
      return missing.length === 0 ? previous : [...previous, ...missing];
    });
  }, [editor.selectedId]);

  /*
   * Search reveals TEMPORARILY, so its branches are unioned at render and never
   * stored. Clearing the query returns the tree to what the author had open,
   * which is what makes searching feel like looking rather than like editing.
   */
  const expandedIds = React.useMemo(
    () => [...new Set([...opened, ...search.expand])],
    [opened, search.expand]
  );

  const icons = React.useMemo(iconsByType, []);
  const nodes = React.useMemo(
    () => search.roots.map(root => rowOf(root, icons)),
    [search.roots, icons]
  );

  /*
   * Which keyboard is in front of the author, resolved AFTER mounting.
   *
   * `detectApplePlatform` reads `navigator`, which a server render does not
   * have — it answers false there, so a server would emit `Alt` and the first
   * browser render `⌥`, and React would find markup it did not produce and
   * throw the subtree away. Held as `null` until it is known, so the legend is
   * absent rather than briefly wrong: this module's whole rule is that a hint
   * naming the wrong key is worse than no hint at all.
   */
  /*
   * Per INSTANCE, not a module constant. A host may mount two editors on one
   * page, and a fixed id would have both trees pointing at the same element —
   * an ambiguous lookup, where assistive technology can read one panel's tree
   * the other panel's description.
   */
  const hintId = React.useId();
  const [apple, setApple] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setApple(detectApplePlatform());
  }, []);

  /*
   * Built from the binding table, so a rebound keystroke moves the hint with
   * it. A binding this cannot spell is dropped rather than guessed at — see
   * `keyHint` for why a wrong hint is worse than no hint.
   */
  const hints = React.useMemo(
    () =>
      apple === null || !moveHints
        ? []
        : MOVE_KEYS.flatMap(({ keys, direction, description }) => {
            const shown = keyHint(keys, apple);
            return shown === null
              ? []
              : [
                  {
                    keys,
                    shown,
                    label: DIRECTION_LABEL[direction],
                    description,
                  },
                ];
          }),
    [apple, moveHints]
  );

  return (
    <div className="nx-layers-panel">
      <div className="nx-layers-panel__search">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search layers"
          aria-label="Search layers"
        />
      </div>

      {tree.length === 0 ? (
        <p className="nx-layers-panel__note">
          This page has no blocks yet. Add one from the Insert panel.
        </p>
      ) : nodes.length === 0 ? (
        <p className="nx-layers-panel__note">No blocks match “{query}”.</p>
      ) : (
        <TreeView
          className="nx-layers-panel__tree"
          aria-label="Layers"
          nodes={nodes}
          selectedId={editor.selectedId}
          // The panel shows what the canvas shows. Passing only the primary
          // would leave two surfaces disagreeing about what is selected, on a
          // screen where a delete acts on all of it.
          selectedIds={editor.selection.ids}
          // The tree's three gestures ARE the editor's three gestures: it
          // reports which one a row's modifiers meant and the store's own rules
          // decide what that does. A panel translating them itself would be a
          // second grammar to keep in step.
          onSelectedChange={editor.select}
          expandedIds={expandedIds}
          // The tree reports the whole next set, which during a search includes
          // branches only the search opened. Those are dropped before storing,
          // so clearing the query collapses them again instead of baking a
          // temporary reveal into what the author has open.
          onExpandedChange={next =>
            setOpened(next.filter(id => !search.expand.includes(id)))
          }
          // The hint is the tree's DESCRIPTION, so it is announced on entering
          // the tree rather than only readable by someone who can see it below.
          aria-describedby={hints.length === 0 ? undefined : hintId}
        />
      )}

      {/*
        Outside the empty and no-match branches deliberately: the bindings are
        what an author reaches for once there ARE layers to move, and a page
        with none has nothing to say this about.
      */}
      {tree.length === 0 || nodes.length === 0 || hints.length === 0 ? null : (
        <ul className="nx-layers-panel__hint" id={hintId}>
          {hints.map(({ keys, shown, label, description }) => (
            <li className="nx-layers-panel__hint-row" key={keys}>
              <span className="nx-layers-panel__hint-key" aria-hidden="true">
                {shown}
              </span>
              {/*
                The short label is what is DRAWN; the binding's own sentence is
                what is read out, because a description announced without its
                subject — "Move in" — says less than the sentence the shortcut
                manager already carries for exactly this.
              */}
              <span className="nx-layers-panel__hint-label" aria-hidden="true">
                {label}
              </span>
              <span className="nx-sr-only">
                {shown}: {description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

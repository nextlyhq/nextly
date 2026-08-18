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
 * @module layers-panel
 */

import { Input, TreeView, type TreeNode } from "@nextlyhq/ui";
import { EyeOff, Lock, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { ancestorIds, filterLayers, layersOf, type LayerNode } from "./layers";

export interface LayersPanelProps {
  /** The editor whose document this shows and whose selection it drives. */
  editor: EditorState;
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

/** A layer as a row: its name, and what is true about it. */
function rowOf(node: LayerNode): TreeNode {
  return {
    id: node.id,
    // `textValue` carries the NAME alone even though the label renders badges
    // beside it. Typeahead matches what an author would type, and a row whose
    // searchable text included "Locked" would be reachable by typing a word
    // that is not its name.
    textValue: node.label,
    label: (
      <span className="nx-layer-row">
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
    children: node.children.map(rowOf),
  };
}

export function LayersPanel({ editor }: LayersPanelProps): React.JSX.Element {
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

  const nodes = React.useMemo(() => search.roots.map(rowOf), [search.roots]);

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
          onSelectedChange={editor.select}
          expandedIds={expandedIds}
          // The tree reports the whole next set, which during a search includes
          // branches only the search opened. Those are dropped before storing,
          // so clearing the query collapses them again instead of baking a
          // temporary reveal into what the author has open.
          onExpandedChange={next =>
            setOpened(next.filter(id => !search.expand.includes(id)))
          }
        />
      )}
    </div>
  );
}

import type { ReactElement } from "react";

import { editorMarkers, type EditorAddress } from "./editor-markers";

/** Why a node rendered a placeholder instead of itself. */
export type PlaceholderReason =
  /** No definition is registered for the node's `type`. */
  | "unknown-block"
  /** The node could not be upgraded to its block's current schema version. */
  | "migration-failed"
  /**
   * A component instance could not be replaced by the tree it stands for.
   *
   * ONE member for five causes — the component is missing, it reaches itself,
   * it is nested too deep, its own tree is too deep, or the node names no
   * component at all. Which one it was travels in `DocumentReadStages`
   * instead, because that is the channel with a reader who can act: the
   * publish readiness check lists the components a page embeds that are not
   * published yet, and it needs the cause per instance, not per page. The DOM
   * marker's audience is monitoring, and "a component did not resolve, here"
   * is what monitoring can do something with.
   */
  | "unresolved-component"
  /** The node was saved against a newer definition than this app has. */
  | "version-ahead"
  /** The whole document is in a format version this renderer does not know. */
  | "unsupported-format"
  /** The block's own render threw or rejected. */
  | "render-error"
  /** The block returned something React cannot render. */
  | "invalid-output";

export interface BlockPlaceholderProps {
  reason: PlaceholderReason;
  /** The node's block type, which is the first thing anyone debugging wants. */
  type: string;
  /**
   * The node's id, so a placeholder can be traced to a document position.
   * Absent for a document-level refusal, which belongs to no single node.
   */
  id?: string;
  /** What went wrong, when there is a message worth showing. */
  detail?: string;
  /**
   * Emit the editor's own markers on the placeholder's box.
   *
   * A placeholder is drawn INSTEAD of the block, so it never passes through
   * the boundary's marking step — which left the one element an author can
   * actually see and click carrying no address at all. In an editor that is
   * the difference between a broken block being selectable and being inert.
   */
  editor?: EditorMarkers;
}

/**
 * The editor's address for the node a placeholder stands in for.
 *
 * PICKED from `EditorAddress` rather than declared, so it cannot drift from the
 * shape the markers are actually built from. Re-declaring the same two fields
 * compiles for as long as the two happen to agree — structural typing does not
 * notice a divergence, it accepts one — and the day the shared address gains or
 * renames a field, this path keeps compiling against a contract that no longer
 * describes what an ordinary root carries. That is the same duplication the
 * marker construction itself had, one level up in the types.
 *
 * `declaresSlots` is deliberately not picked: a placeholder is drawn INSTEAD of
 * the block, so it has no definition to declare slots and nothing would consume
 * the marker. Narrowing by `Pick` states that as a choice, and a field added to
 * the address has to be considered here rather than silently omitted.
 */
export type EditorMarkers = Pick<EditorAddress, "nodeId" | "instanceOf">;

/** Human wording per reason, kept out of the component so it reads as data. */
const REASON_TEXT: Readonly<Record<PlaceholderReason, string>> = {
  "unknown-block": "No block is registered for this type",
  "migration-failed": "This block could not be upgraded to its current version",
  "unresolved-component": "This component could not be loaded",
  "version-ahead": "This block was saved by a newer version of the app",
  "unsupported-format": "This page is stored in a format this app cannot read",
  "render-error": "This block failed to render",
  "invalid-output": "This block returned something that cannot be rendered",
};

/**
 * What stands in for a node that cannot render itself.
 *
 * The forgiving half of the strict-at-publish / forgiving-at-render split: one
 * bad node costs its own box, never the page. That is only worth anything if
 * the substitute is the right size for its audience, which differs sharply:
 *
 * - **In development** an author needs to know immediately, so the placeholder
 *   is visible and names the block, the reason and the node id.
 * - **In production** a visitor must not be shown internals, and a broken block
 *   defacing a live page is worse than the block being absent. Nothing renders
 *   except a marker element carrying the same facts as data attributes, so
 *   monitoring and a DOM inspection can still find it.
 *
 * The marker is emitted in both modes and is the stable contract; the visible
 * panel is the development affordance layered on top.
 *
 * Styles are inline rather than classed because a placeholder has to look
 * correct on a page whose stylesheet failed to compile, which is one of the
 * situations that produces it.
 */
export function BlockPlaceholder({
  reason,
  type,
  id,
  detail,
  editor,
}: BlockPlaceholderProps): ReactElement {
  // Read at render rather than module scope so a consumer's bundler can inline
  // it per build, and so a test can exercise both modes in one process.
  // Read defensively. This renderer is meant to run anywhere React does, and an
  // Edge or Worker runtime need not define `process` at all — a bare access
  // would throw HERE, on the one path that exists to contain a failure, turning
  // a contained block error into a page-level crash.
  const isProduction =
    typeof process !== "undefined" && process.env?.NODE_ENV === "production";

  const markers = editorMarkerProps(editor);

  // HIDDEN only on a page nobody is editing, and the `editor` clause is the
  // load-bearing half rather than a refinement.
  //
  // The first version hid it whenever the build was production and spread the
  // markers into both branches, reasoning that hiding a box does not put it
  // beyond the editor's own hit-testing. That is false: `hidden` is
  // `display: none`, so the element generates no box — it has no geometry to
  // read, `elementFromPoint` never returns it, and a click cannot land on it.
  // Marking an element nobody can reach addresses nothing, so an editor served
  // from a production build still could not select the host instance from the
  // one thing an author can see when a block inside a component breaks.
  //
  // The reason the branch exists is that a PUBLISHED page must not show a debug
  // box. An editor render is not a published page, whatever `NODE_ENV` says.
  if (isProduction && editor === undefined) {
    return (
      <div
        hidden
        data-nx-block-placeholder={reason}
        data-nx-block-type={type}
        data-nx-block-id={id}
        {...markers}
      />
    );
  }

  return (
    <div
      data-nx-block-placeholder={reason}
      data-nx-block-type={type}
      data-nx-block-id={id}
      {...markers}
      style={{
        border: "1px dashed currentColor",
        borderRadius: "4px",
        padding: "12px 16px",
        margin: "4px 0",
        font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        opacity: 0.75,
      }}
    >
      <strong>{REASON_TEXT[reason]}</strong>
      <div>
        {type} ({id})
      </div>
      {detail ? <div>{detail}</div> : null}
    </div>
  );
}

/**
 * The editor attributes a placeholder carries, or none at all.
 *
 * DERIVED from `editorMarkers`, which is what an ordinary block root is marked
 * from too. Spelling the names here was the first version, pinned to the
 * boundary's constants by a test — and that test checks the NAMES and nothing
 * else: it stays green when a marker is added to one path, and green when the
 * two disagree about whether an absent value is omitted or removed. A
 * placeholder would then carry a different editor address from the root it
 * stands in for, which nothing observes.
 *
 * `editor-markers` is a leaf precisely so this can ask it: `block-boundary`
 * renders this module, so importing the marking from there would be a cycle.
 *
 * The bag may carry `undefined` values. React omits those on a fresh element,
 * which is exactly the "the page owns this node, so do not claim otherwise"
 * outcome the literal version spelled by hand — and the same value REMOVES a
 * forged attribute where the boundary clones a block's own root.
 */
function editorMarkerProps(
  editor: EditorMarkers | undefined
): Record<string, string | undefined> {
  if (editor === undefined) return {};
  return editorMarkers(editor);
}

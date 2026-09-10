/**
 * The editor's markers, and the ONE place that decides what an element carries.
 *
 * A leaf on purpose: it imports nothing from this package, so both the module
 * that marks a rendered block root and the module that draws a placeholder
 * INSTEAD of one can derive from it without a cycle. That acyclicity is the
 * whole reason it exists as its own file — `block-boundary` renders
 * `placeholder`, so the marking could not live in the former and be reached
 * from the latter.
 *
 * Before this, the placeholder spelled the attribute names itself and a test
 * pinned the two literals together. That checks the names and nothing else: it
 * stays green when a marker is ADDED to one path, and green when the two
 * disagree about whether an absent value is omitted or removed. A placeholder
 * and an ordinary root would then carry different editor addresses, which is
 * the state an editor cannot detect and a reader cannot see.
 *
 * @module editor-markers
 */

/** The attribute an editor addresses a node by. Named, so one string decides it. */
export const NODE_ID_ATTRIBUTE = "data-nx-node";

/**
 * The attribute naming which prop an element renders, for an editor.
 *
 * Written only when the editor asked for node addresses, so a published page
 * carries none of it — the same condition {@link NODE_ID_ATTRIBUTE} rides on,
 * because the two answer one question together: an editor needs to know which
 * node it is looking at AND which of that node's values an element holds, and
 * either alone addresses nothing.
 */
export const PROP_ATTRIBUTE = "data-nx-prop";

/**
 * Marks a block whose definition declares at least one slot.
 *
 * The editor needs to find containers without knowing their names: a list of
 * built-in types would exclude every container a plugin contributes, and would
 * have to be kept in step with packages this one does not own. Whether a block
 * declares slots is the structural fact underneath that list, and it is
 * available here for nothing.
 *
 * Rides `nodeAttribute` for the same reason {@link NODE_ID_ATTRIBUTE} does: it
 * is the editor's own namespace and has no business on a published page.
 */
export const SLOTS_ATTRIBUTE = "data-nx-slots";

/**
 * Names the component INSTANCE an element's node belongs to, for an editor.
 *
 * A component is inlined at render: the instance node is replaced by the tree
 * its definition describes, so every element an author sees inside one carries
 * a node id the page's document does not contain. Without this, an editor
 * hit-testing on {@link NODE_ID_ATTRIBUTE} alone resolves a click inside a
 * component to an address it cannot select, edit or delete.
 *
 * Carries the HOST's instance rather than the nearest one, because that is what
 * `instanceOf` means — the instance the author actually placed on the page,
 * even where components nest.
 *
 * Written only for DEFINITION-owned nodes, which is the discrimination that
 * makes it useful. An instance's slot content is nested inside the inlined tree
 * and belongs to the page, so it is unmarked and stays directly selectable —
 * exactly the nodes a marketer opened the editor to edit.
 *
 * Rides `nodeAttribute` for the reason its siblings do: it is the editor's own
 * namespace and has no business on a published page.
 */
export const INSTANCE_ATTRIBUTE = "data-nx-instance";

/**
 * The prefix every marker the editor puts on a rendered element shares.
 *
 * A NAMESPACE rather than a list, because a list is a thing to keep in sync
 * and this one already fell behind once: three markers exist and only the
 * node id was protected here. Anything a future overlay needs is covered by
 * construction.
 */
export const EDITOR_NAMESPACE = "data-nx-";

/** Which node an element belongs to, in the terms an editor addresses it by. */
export interface EditorAddress {
  /** The node's own id. */
  nodeId: string;
  /**
   * The component instance this node was inlined from, when it has one.
   *
   * `undefined` for a page-owned node, and that is a VALUE here rather than an
   * omission — see {@link editorMarkers}.
   */
  instanceOf?: string | undefined;
  /** Whether the block's definition declares at least one slot. */
  declaresSlots?: boolean;
}

/**
 * Every editor marker an element carries for one node.
 *
 * Values may be `undefined`, and both callers need that to mean REMOVE rather
 * than "leave alone". A block builds its own root element and can return one
 * already carrying `data-nx-instance` — hardcoded, or spread from a stored
 * attribute bag — and the merge that applies these preserves any key they do
 * not name. So a marker that was only ever ADDED left a forged value in place
 * on a root that also carried a valid node address.
 *
 * `undefined` serves both paths without either special-casing it: React omits
 * an undefined prop on a fresh element, and applies it as a removal when
 * cloning one. That is what makes a single bag correct for a placeholder this
 * package builds and for a root a block author built.
 */
export function editorMarkers(
  address: EditorAddress
): Record<string, string | undefined> {
  return {
    [NODE_ID_ATTRIBUTE]: address.nodeId,
    [SLOTS_ATTRIBUTE]: address.declaresSlots === true ? "" : undefined,
    // An EMPTY instance id is treated as no provenance at all. The marker's
    // whole contract is that its PRESENCE means "definition-owned, address the
    // instance instead" — an editor tests for the attribute rather than reading
    // it first — so emitting `data-nx-instance=""` says a node belongs to a
    // component and then names one nothing can select. A document validator
    // accepts any string as an id, and imported or hand-edited content reaches
    // the renderer without ever passing through the editor that mints them, so
    // this is a value the renderer can actually receive.
    //
    // Absent is the safe reading of it: the element keeps its own node address
    // and stays directly selectable, which is what an unmarked node means.
    [INSTANCE_ATTRIBUTE]:
      address.instanceOf === "" ? undefined : address.instanceOf,
  };
}

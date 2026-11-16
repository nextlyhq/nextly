import {
  expandSlotDefaults,
  makeNode,
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

/**
 * The documents the locks harness opens with.
 *
 * Each locked block is placed as inserting places it, by the engine's own
 * `makeNode` and `expandSlotDefaults`, so the page as placed breaks no lock by
 * construction rather than by a hand-copied fixture agreeing with the rules.
 * Ids are then made literal and stable, in depth-first order, because the
 * suite addresses blocks by id.
 *
 * Built after the harness registers its blocks, since expanding a slot reads
 * the registry.
 */
function placed(type: string, ids: readonly string[]): BlockNode {
  const node = makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
  const queue = [...ids];
  const named = (each: BlockNode): BlockNode => {
    const id = queue.shift();
    if (id === undefined) {
      throw new Error(
        `[builder-locks] ${type} holds more blocks than ids given`
      );
    }
    return {
      ...each,
      id,
      ...(each.slots === undefined
        ? {}
        : {
            slots: Object.fromEntries(
              Object.entries(each.slots).map(([slot, children]) => [
                slot,
                children.map(named),
              ])
            ),
          }),
    };
  };
  return named(node);
}

function free(type: string, id: string, text: string): BlockNode {
  return { ...makeNode(type, 1, { text }), id };
}

/** The page as inserting places every block: nothing breaks a lock. */
export function placedDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      free("core/heading", "lk-free-heading", "A free heading"),
      placed("e2e/fixed-row", ["lk-row", "lk-row-heading", "lk-row-text"]),
      placed("e2e/loose-row", [
        "lk-loose",
        "lk-loose-heading",
        "lk-loose-text",
      ]),
      placed("e2e/sealed-card", ["lk-card", "lk-card-heading"]),
      free("core/text", "lk-free-text", "A free paragraph"),
    ],
  };
}

/**
 * A page stored before its locks were enforced: the fixed row holds a block
 * more, and so does the fixed row inside the sealed shelf. The repair moves
 * the first to just after the row, and the second to just after the SHELF,
 * the outermost block whose lock applies, so the shelf still holds only its
 * row.
 */
export function brokenDocument(): BlockDocument {
  const row = placed("e2e/fixed-row", [
    "lk-row",
    "lk-row-heading",
    "lk-row-text",
  ]);
  row.slots!.children.push(free("core/text", "lk-row-extra", "Added by hand"));
  const shelf = placed("e2e/sealed-shelf", [
    "lk-shelf",
    "lk-shelf-row",
    "lk-shelf-heading",
    "lk-shelf-text",
  ]);
  shelf.slots!.children[0].slots!.children.push(
    free("core/text", "lk-shelf-extra", "Also added by hand")
  );
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [row, shelf, free("core/text", "lk-free-text", "A free paragraph")],
  };
}

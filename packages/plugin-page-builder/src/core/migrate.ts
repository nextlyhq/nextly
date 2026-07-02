/**
 * Migration runner (spec §12). Upgrades a stored document to current block versions
 * by running each block's `migrate()` when its instance is older than the registered
 * definition. Unknown block types are PRESERVED as-is (Nextly's "retain and flag"
 * philosophy) — never dropped, never fatal. Pure JSON→JSON; React-free.
 */
import type { BlockRegistry } from "./registry";
import type { BlockDocument, BlockNode } from "./types";

function migrateNode(node: BlockNode, registry: BlockRegistry): BlockNode {
  const def = registry.get(node.type);
  let next: BlockNode = node;

  if (def) {
    const from = node.definitionVersion ?? 1;
    if (from < def.version && def.migrate) {
      const { props, style } = def.migrate(node.props, from);
      next = {
        ...node,
        props: props,
        ...(style ? { style } : {}),
        definitionVersion: def.version,
      };
    } else if (from !== def.version) {
      next = { ...node, definitionVersion: def.version };
    }
  }
  // Unknown blocks (def === undefined): preserved untouched.

  if (!next.slots) return next;
  const slots: Record<string, BlockNode[]> = {};
  for (const [name, children] of Object.entries(next.slots)) {
    slots[name] = children.map(c => migrateNode(c, registry));
  }
  return { ...next, slots };
}

/** Upgrade a stored document to current block versions. */
export function migrateDocument(
  doc: BlockDocument,
  registry: BlockRegistry
): BlockDocument {
  return { ...doc, root: migrateNode(doc.root, registry) };
}

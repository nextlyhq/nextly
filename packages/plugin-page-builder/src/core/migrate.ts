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
    } else if (from < def.version) {
      // Only ever stamped FORWARD. A node whose `definitionVersion` is greater
      // than the registered one was written by a newer deployment — opened after
      // a rollback, or by an older editor — and stamping the older number onto
      // it would tell a later upgrade that migrations still had to run against
      // props they have already been run against. Left exactly as found, which
      // is the same answer this gives an unknown block: retain what this build
      // cannot describe rather than reshaping it.
      next = { ...node, definitionVersion: def.version };
    }
  }
  // Unknown blocks (def === undefined): preserved untouched.

  if (!next.slots) return next;
  // Rebuilt only when a descendant actually moved. Returning the SAME object for
  // an unchanged subtree is what lets a caller ask "did this document need
  // migrating" by identity — and a caller that cannot ask has to either push a
  // fresh object on every mount or never push at all, and both are wrong.
  const slots: Record<string, BlockNode[]> = {};
  let childMoved = false;
  for (const [name, children] of Object.entries(next.slots)) {
    slots[name] = children.map(child => {
      const migrated = migrateNode(child, registry);
      if (migrated !== child) childMoved = true;
      return migrated;
    });
  }
  return childMoved || next !== node ? { ...next, slots } : node;
}

/**
 * Upgrade a stored document to current block versions.
 *
 * Returns the SAME document when nothing needed upgrading, so a caller can tell
 * the two apart by identity. The editor's field mount depends on it: it has to
 * push a migrated document to the host form and must not push an unmigrated one,
 * because a push it makes on every mount loops through the form's own onChange.
 */
export function migrateDocument(
  doc: BlockDocument,
  registry: BlockRegistry
): BlockDocument {
  const root = migrateNode(doc.root, registry);
  return root === doc.root ? doc : { ...doc, root };
}

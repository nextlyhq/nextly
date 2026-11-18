/**
 * The whole upgrade of a stored document: `migrateDocumentOnce`, after
 * settling the blocks that follow a setting it drops.
 *
 * Kept apart from `migration.ts`, which the block registry reads: settling
 * followers reads the component's settings, whose modules read the registry,
 * so the two in one module would load in a cycle.
 *
 * @module migrate-document
 */
import type { BlockDocument, BlockNode } from "./document";
import { pointer } from "./issue-text";
import {
  exposedOf,
  exposureIdsGone,
  migrateDocumentOnce,
  type MigratedNode,
  type MigrateResult,
  type MigrationSource,
} from "./migration";
import { isPlainRecord } from "./plain-record";
import { withSettingDefaults } from "./setting-defaults";

/**
 * Upgrade every node in a document to its block's current schema version.
 *
 * - A type the source does not know (an unregistered/plugin block) is preserved
 *   untouched, including its version — nothing is lost.
 * - A node already at (or ahead of) the current version is left as is.
 * - A node behind the current version is chained forward. On success its props
 *   and version are updated; on failure it keeps its last-good props and is
 *   flagged `migrationFailed`, and the failure is collected for the caller.
 *
 * - A component's exposure into a prop an upgrade drops goes, with its values
 *   in the variants; a block following that setting keeps what it showed and
 *   follows nothing.
 *
 * Immutable: returns a new document; the input is never modified. It recurses
 * over the node tree, whose depth is bounded by the document limits validation
 * enforces, so migration is meant to run on structurally-valid documents (pair
 * it with `validate` for untrusted input).
 */
export function migrateDocument(
  doc: BlockDocument,
  source: MigrationSource
): MigrateResult {
  const result = migrateDocumentOnce(doc, source);
  const gone = exposureIdsGone(exposedOf(doc), exposedOf(result.doc));
  if (gone.size === 0) return result;
  // A block following a setting the upgrade drops keeps what it showed, and
  // follows nothing from then on, as removing the setting in the editor leaves
  // it (`withSettingDefaults`). Its value is read from the stored document,
  // while the dropped prop still holds it, and the upgrade then runs on that.
  let settled = doc;
  for (const id of gone) settled = withSettingDefaults(settled, id);
  if (settled === doc) return result;
  const upgraded = migrateDocumentOnce(settled, source);
  return {
    ...upgraded,
    rewritten: withSettled(upgraded.rewritten, doc.nodes, settled.nodes),
  };
}

/**
 * The upgrade's report with each node the settling rewrote added, in document
 * order. The upgrade compares against the settled document, which already
 * holds a follower's new props, so without this a follower whose version did
 * not move would be missing, and a reader examines only the nodes named.
 * A node in both keeps the upgrade's entry, which says the versions it went
 * through.
 */
function withSettled(
  rewritten: readonly MigratedNode[],
  stored: readonly BlockNode[],
  settled: readonly BlockNode[]
): MigratedNode[] {
  const added = new Map<string, MigratedNode>();
  settledNodes(stored, settled, "/nodes", added);
  if (added.size === 0) return [...rewritten];
  const byPath = new Map<string, MigratedNode>(added);
  for (const entry of rewritten) byPath.set(entry.path, entry);
  const ordered: MigratedNode[] = [];
  eachPath(settled, "/nodes", path => {
    const entry = byPath.get(path);
    if (entry === undefined) return;
    ordered.push(entry);
    byPath.delete(path);
  });
  // Nothing named is ever dropped, though no walk should leave one behind.
  return [...ordered, ...byPath.values()];
}

/**
 * Each node whose props the settling replaced, by its path, walking only
 * where the settled tree differs from the stored one.
 */
function settledNodes(
  stored: readonly BlockNode[] | undefined,
  settled: readonly BlockNode[] | undefined,
  path: string,
  out: Map<string, MigratedNode>
): void {
  if (!Array.isArray(stored) || !Array.isArray(settled)) return;
  if (stored === settled) return;
  settled.forEach((now, index) => {
    const was = stored[index];
    // Typed as nodes, but stored data: anything else is passed over.
    if (!isObject(now) || !isObject(was) || now === was) return;
    const at = pointer(path, index);
    if (now.props !== was.props) {
      out.set(at, {
        path: at,
        ...(typeof now.id === "string" && now.id !== "" ? { id: now.id } : {}),
        type: now.type,
        fromVersion: now.version,
        toVersion: now.version,
      });
    }
    const nowSlots = now.slots;
    const wasSlots = was.slots;
    if (!isObject(nowSlots) || !isObject(wasSlots)) return;
    for (const slot of Object.keys(nowSlots)) {
      settledNodes(
        wasSlots[slot],
        nowSlots[slot],
        pointer(pointer(at, "slots"), slot),
        out
      );
    }
  });
}

/** Whether a value is an object to read (a node, a slot record), keeping its declared type. */
function isObject<T>(value: T | null | undefined): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every node's path in a forest, a parent before its slots' children. */
function eachPath(
  nodes: readonly unknown[],
  path: string,
  visit: (path: string) => void
): void {
  nodes.forEach((node, index) => {
    if (!isPlainRecord(node)) return;
    const at = pointer(path, index);
    visit(at);
    if (!isPlainRecord(node.slots)) return;
    for (const [slot, children] of Object.entries(node.slots)) {
      if (Array.isArray(children)) {
        eachPath(children, pointer(pointer(at, "slots"), slot), visit);
      }
    }
  });
}

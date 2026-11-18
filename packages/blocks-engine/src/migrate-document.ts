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
import type { BlockDocument } from "./document";
import {
  exposedOf,
  exposureIdsGone,
  migrateDocumentOnce,
  type MigrateResult,
  type MigrationSource,
} from "./migration";
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
  return settled === doc ? result : migrateDocumentOnce(settled, source);
}

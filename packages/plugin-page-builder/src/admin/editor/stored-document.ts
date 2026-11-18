/**
 * The field's stored value read as a document, with every block upgraded to
 * its current version, and the name the plugin's client reads go by.
 *
 * Shared by the field control at rest and the editor it opens, so both seed
 * from one reading of a stored value. A module of its own because the editor
 * cannot import from the field control without an import cycle.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/stored-document
 */
import {
  migrateDocument,
  type BlockDocument,
  type DocumentKind,
} from "@nextlyhq/blocks-engine";
import { migrationSourceFor } from "@nextlyhq/blocks-react";

import { emptyBlockDocument } from "../../fields/blocks-document";
import { entryBlockResolver } from "../entry-block-resolver";

export { PLUGIN_SOURCE } from "../plugin-source";

/**
 * A stored value that is not a usable document is treated as absent.
 *
 * The field's value arrives from storage, so it is whatever a previous version,
 * a migration, an import or a hand-edited row left there — `null`, a string of
 * JSON, an object from the old `{version, root}` shape. The canvas walks
 * `nodes`, so anything without an array there would throw inside the render
 * rather than at this boundary, and an editor that crashes on open gives an
 * author no way to repair the value.
 *
 * The KINDS the field accepts are a parameter rather than a default, because
 * the substitute has to be a document the same field will accept. Seeding a
 * `page` into a field declaring `kinds: ["pattern"]` produces an editor that
 * looks like it works and a save the server refuses with
 * `DISALLOWED_DOCUMENT_KIND` — so the store cannot be authored at all through
 * the UI that advertises it, and nothing says why until the author presses
 * Done.
 *
 * Exported for its own tests: it is the only place a malformed stored document
 * is turned into a safe one, and it is worth asserting directly rather than
 * through a rendered editor.
 */
export function documentFrom(
  value: unknown,
  kinds?: readonly DocumentKind[]
): BlockDocument {
  return isDocument(value)
    ? atCurrentVersions(value)
    : emptyBlockDocument(kinds);
}

/**
 * A stored value with every block in it at its current version, as
 * {@link documentFrom} reads it; any value that is not a document is returned
 * as it came, for `documentFrom` to replace.
 *
 * For the editor's read of the saved entry, which compares what arrives with
 * what the editor holds before it hands anything on: the editor holds the
 * upgraded document, so an arrival is compared upgraded too, or the same page
 * read back at its stored versions would count as a different one.
 */
export function storedAtCurrentVersions(value: unknown): unknown {
  return isDocument(value) ? atCurrentVersions(value) : value;
}

/** Whether a stored value is a document the canvas can walk. */
function isDocument(value: unknown): value is BlockDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<BlockDocument>).nodes)
  );
}

/**
 * The document with every block at its block's current version, upgraded as
 * the page's renderer upgrades it.
 *
 * Upgraded once, as the document is read, rather than left to each render.
 * The editor hands over the whole document it holds on the first edit, so a
 * block held at the version it was stored at is saved with its edited props
 * under the OLD version stamp, and the renderer's upgrade then reads those
 * props as old ones: a Quote's source address edited under its new name is
 * overwritten by the old name's value. Upgraded here, the first edit saves the
 * block at its current version, and opening alone saves nothing, since the
 * editor's unsaved work is its own history, which a read does not touch.
 *
 * Resolved as the entry screen resolves blocks, the registry first, so a
 * block the editor has registered and one only the core set or a plugin's
 * contribution defines are both upgraded, with or without the editor open.
 *
 * The stored object itself is returned when no block needed upgrading, so a
 * reader comparing by identity sees the same document it already holds. The
 * stored value is never modified.
 */
function atCurrentVersions(doc: BlockDocument): BlockDocument {
  const migrated = migrateDocument(
    doc,
    migrationSourceFor(entryBlockResolver())
  );
  return migrated.rewritten.length === 0 && migrated.failures.length === 0
    ? doc
    : migrated.doc;
}

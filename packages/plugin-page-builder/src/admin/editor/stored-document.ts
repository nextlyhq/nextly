/**
 * The field's stored value read as a document, and the name the plugin's
 * client reads go by.
 *
 * Shared by the field control at rest and the editor it opens, so both seed
 * from one reading of a stored value. A module of its own because the editor
 * cannot import from the field control without an import cycle.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/stored-document
 */
import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";

import { emptyBlockDocument } from "../../fields/blocks-document";

/** Names the registry attributes these blocks to, for diagnostics. */
export const PLUGIN_SOURCE = "@nextlyhq/plugin-page-builder";

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
  if (typeof value !== "object" || value === null)
    return emptyBlockDocument(kinds);
  const candidate = value as Partial<BlockDocument>;
  return Array.isArray(candidate.nodes)
    ? (value as BlockDocument)
    : emptyBlockDocument(kinds);
}

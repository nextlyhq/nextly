/**
 * Whether the change a pending registry row is waiting for has actually landed.
 *
 * 🔴 The sweep used to promote on TABLE EXISTENCE alone. That is the right
 * evidence for a CREATE and proves nothing for an EDIT: when a collection is
 * edited in the Schema Builder, `collection-registry-service` writes the new
 * fields, sets `migration_status` back to `pending` and leaves the physical
 * table untouched — so the old table still stands, existence still answers yes,
 * and the row is promoted to `applied` while the column, status or localization
 * change it is waiting for has not been migrated. The registry then says a
 * shape is live that the database has never had.
 *
 * ## What is compared, and why it is not the columns
 *
 * The obvious evidence is the desired table spec against a live introspection.
 * It is the wrong instrument here: `buildDesiredTableFromFields` deliberately
 * omits localized fields, which live in the `_locales` companion, and component
 * fields, which live in their own table — so a naive desired-versus-live
 * comparison reports missing columns that are CORRECTLY absent, withholds
 * promotion, and silently reinstates the defect the sweep exists to fix, which
 * is a collection with no dashboard cards. Reproducing the diff pipeline's
 * exclusion, type and nullability rules closely enough to avoid that means
 * maintaining a second copy of them.
 *
 * So the comparison is between two FIELD DEFINITIONS instead: the shape the row
 * is waiting for, and the shape the newest applied snapshot gives that slug.
 * Snapshots are already paired 1:1 with their migration, and the ledger already
 * records which migrations ran, so the question "has this entity's migration
 * landed" is answerable from data the tree already keeps.
 *
 * ## Both sides are hashed HERE, never read from the stored column
 *
 * `dynamic_collections.schema_hash` holds a hash computed when the row was
 * written, and {@link calculateSchemaHash} folds `SYSTEM_SCHEMA_VERSION` into
 * its input. Comparing a stored hash against one computed now would therefore
 * disagree for every row in the database the first time that constant changes —
 * withholding promotion everywhere, which is the failure direction that costs
 * dashboards. Hashing both sides in the same pass costs one extra hash and
 * cannot express that bug.
 *
 * @module domains/schema/migrate/promotion-evidence
 */

import type { FieldConfig } from "@nextly/collections";

import { calculateSchemaHash } from "../services/schema-hash";

import type { LoadedSnapshot, MigrationSnapshot } from "./snapshot-source";

/**
 * What the snapshots can say about one pending row.
 *
 * `unknown` is a first-class answer rather than a failure. Nothing describes a
 * code-first collection, a field group (which snapshots do not carry at all),
 * or an install whose migrations predate snapshots — and treating silence as
 * disagreement would withhold promotion from every one of them.
 */
export type PromotionVerdict = "matches" | "differs" | "unknown";

/** Field-shape hashes for the newest APPLIED snapshot naming each slug. */
export interface ShapeEvidence {
  collections: Map<string, string>;
  singles: Map<string, string>;
}

/** The hash of a field array, or undefined when it is not one. */
function hashFields(fields: unknown): string | undefined {
  if (!Array.isArray(fields)) return undefined;
  return calculateSchemaHash(fields as FieldConfig[]);
}

/**
 * The shape each slug has according to the newest snapshot that both names it
 * and has been applied.
 *
 * 🔴 Filtered to applied snapshots BEFORE later-wins resolution, which is the
 * opposite of what registration does and is the point of the distinction. The
 * question here is what the database has actually reached, so a later snapshot
 * whose migration has not run must not win — it describes a shape nothing has
 * created yet, and letting it win would promote the row on the strength of a
 * file sitting unapplied on disk.
 */
export function buildShapeEvidence(loaded: LoadedSnapshot[]): ShapeEvidence {
  const collections = new Map<string, string>();
  const singles = new Map<string, string>();

  const collect = (
    target: Map<string, string>,
    entriesOf: (s: MigrationSnapshot) => { slug: string; fields: unknown }[]
  ): void => {
    for (const { snapshot, applied } of loaded) {
      if (!applied) continue;
      for (const entry of entriesOf(snapshot)) {
        if (!entry.slug) continue;
        const hash = hashFields(entry.fields);
        // A snapshot entry carrying no usable field array is skipped rather
        // than recorded, so it cannot displace a usable earlier one and turn
        // an answerable slug into an unanswerable one.
        if (hash !== undefined) target.set(entry.slug, hash);
      }
    }
  };

  collect(collections, s => s.collections ?? []);
  collect(singles, s => s.singles ?? []);

  return { collections, singles };
}

/**
 * Whether a pending row's shape is the one the applied migrations produced.
 *
 * 🔴 Returns `unknown` for everything it cannot answer, and the caller promotes
 * on `unknown`. The asymmetry is deliberate: a wrong `differs` withholds a row
 * forever from an operator who has no way to see why, reinstating "this
 * collection has no dashboard cards"; a wrong `matches` leaves the previous
 * behaviour exactly as it was. Only positive disagreement is allowed to hold a
 * row back.
 */
export function shapeVerdict(
  record: unknown,
  evidence: Map<string, string> | undefined
): PromotionVerdict {
  if (!evidence) return "unknown";
  if (typeof record !== "object" || record === null) return "unknown";

  const { slug, fields } = record as { slug?: unknown; fields?: unknown };
  if (typeof slug !== "string" || slug === "") return "unknown";

  const applied = evidence.get(slug);
  if (applied === undefined) return "unknown";

  const wanted = hashFields(fields);
  if (wanted === undefined) return "unknown";

  return wanted === applied ? "matches" : "differs";
}

/**
 * What the storage migration will rename, derived from the registry.
 *
 * The plan is built from registry rows rather than from configuration, because
 * only the registry knows what the objects are actually called: a field group
 * whose table was named through `dbName` carries whatever the author chose, and
 * that name cannot be recomputed from a slug.
 *
 * This module decides the plan and nothing else — which objects, in what order,
 * under what identity. It deliberately does **not** look at the database. Names
 * that exist, whether a run is already recorded, and how a given dialect
 * compares identifiers are all facts the database layer holds, and reconciling
 * a plan against them belongs there, next to the catalog probe. Keeping that
 * out means this stays a pure function of its inputs and stays testable as one.
 *
 * @module domains/field-groups/migration/manifest
 */

import { createHash } from "node:crypto";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { normalizeIdentifier } from "../../singles/services/resolve-single-table-name";

/**
 * The names storage moves to.
 *
 * Every entry is the counterpart of a `STORAGE_FORMAT` value, and the two files
 * are read together: `STORAGE_FORMAT` is what a database says today, this is
 * what it says afterwards. Keeping the pairs in one place is what lets a plan
 * and the rewrite that applies it be checked against each other rather than
 * matched by eye.
 *
 * `dynamic_field_groups` is parallel to `dynamic_collections` and
 * `dynamic_singles`. `fg_` is deliberately shorter than the prefix it replaces,
 * so no name that fits an identifier limit today can overflow one by migrating.
 */
export const MIGRATION_TARGET = {
  registryTable: "dynamic_field_groups",
  tablePrefix: "fg_",
  columnType: "_field_group_type",

  /** Directory segment a registry row's `config_path` records. */
  configPathDir: "field-groups",

  /** Discriminator a stored field definition's `type` carries. */
  fieldType: "fieldGroup",

  /**
   * The key a dynamic-zone instance announces its type under once it is JSON.
   *
   * Read by user application code out of a dynamic zone, so this is a public
   * contract and not only an on-disk one. It pairs with `columnType`: the same
   * value, spelled for the database and spelled for the wire.
   */
  wireTypeKey: "_fieldGroupType",

  /**
   * Property names a stored field definition uses to reference a field group.
   *
   * There is no counterpart to `STORAGE_FORMAT.refKeys.legacy`, deliberately.
   * That spelling is read-only compatibility — nothing writes it — so renaming
   * it would mint a fresh obsolete key that nothing writes either. Rows
   * carrying it are normalised onto `single` instead, which retires the concept
   * rather than translating it.
   */
  refKeys: {
    single: "fieldGroup",
    many: "fieldGroups",
  },

  /** Scope kind a schema event carries when it concerns a field group. */
  schemaEventScope: "fieldGroup",
} as const;

/** A registry row, as far as the migration is concerned. */
export interface RegistryRow {
  /**
   * The registry row's own primary key.
   *
   * Stable across the run — renames rewrite `table_name`, never this — and not
   * reusable by a row recreated under the same slug, which is what lets a resume
   * tell a surviving field group from a replaced one.
   */
  id: string;
  slug: string;
  /** Read from `table_name`. Never recomputed from the slug. */
  tableName: string;
  /**
   * Whether a companion table is physically present.
   *
   * Deliberately not `localized`: a localized group with no translatable fields
   * has no companion, and the create path accepts exactly that. Reading this
   * from the catalog rather than inferring it keeps the plan from naming a
   * table that was never created.
   */
  hasCompanion: boolean;
}

/** A companion table's rename, carried by the entry for the table it belongs to. */
export interface CompanionRename {
  from: string;
  to: string;
}

/** One thing the migration will rename. */
export interface ManifestEntry {
  kind: "registry" | "table" | "column";
  from: string;
  to: string;
  /** Set for `column`, naming the table the column belongs to. */
  table?: string;
  /**
   * The localization companion that moves with this table.
   *
   * A property rather than an entry of its own, because a companion is not an
   * independent object: it has no registry row, its name is derived from its
   * owner's `table_name`, and it can never be renamed apart from its owner. As a
   * sibling entry it occupied a second step position, which left the resume
   * crash window unable to explain it and let `invertManifest`'s order reversal
   * separate it from the owner it must move with. Held here, neither is
   * expressible.
   */
  companion?: CompanionRename;
  /**
   * This rename is already reflected in the database.
   *
   * Set by catalog reconciliation, which lives with the probe rather than here.
   * Annotated rather than removed: the plan is indexed by position and
   * identified by hash, so dropping an entry would renumber every later step
   * and change the identity the marker recorded, making a resume refuse the
   * very plan it is resuming.
   */
  satisfied?: boolean;
}

export interface MigrationManifest {
  entries: ManifestEntry[];
  /**
   * Identifies the object map this plan was built against. Recorded when a run
   * starts so a resume can refuse a plan that has since moved.
   */
  hash: string;
}

/**
 * The name this migration would have generated for a field group, or `null` if
 * the stored one is not a name it generated.
 *
 * Ownership is decided by comparing against the canonical name for the slug,
 * not by looking at the prefix. `dbName` was historically taken verbatim for
 * field groups, so an author could name a table `comp_archive` while its slug is
 * `hero` — a prefix rule reads that as generated and renames it to `fg_archive`,
 * changing an identifier this migration never created. Only the canonical name
 * for the slug distinguishes the two.
 *
 * `resolveComponentTableName` is the single source of truth for that canonical
 * name; deriving it here again would let the two drift, which is exactly the
 * drift that helper was written to end.
 */
export function retargetName(row: {
  slug: string;
  tableName: string;
}): string | null {
  if (row.tableName !== resolveComponentTableName(row.slug)) return null;
  return `${MIGRATION_TARGET.tablePrefix}${normalizeIdentifier(row.slug)}`;
}

/**
 * Reverse a plan that was applied, for a rollback.
 *
 * A down plan is **inverted, never derived.** Deriving it from the prefix
 * cannot work: a field group whose author named its table `fg_hero` before any
 * migration existed is left untouched on the way up, and a prefix rule going
 * back down would rename it to `comp_hero` — destroying an author-chosen
 * identifier this migration never created. Nothing in the database
 * distinguishes a name we made from one that was always there; only the record
 * of what was applied does.
 *
 * Order reverses along with direction, so each column reverts while its table
 * still carries the migrated name. That is why every column entry keeps the
 * table it already names.
 */
export function invertManifest(
  entries: readonly ManifestEntry[]
): MigrationManifest {
  const inverted = [...entries].reverse().map(entry => ({
    kind: entry.kind,
    from: entry.to,
    to: entry.from,
    ...(entry.table === undefined ? {} : { table: entry.table }),
    // Inverted with its owner rather than beside it. Order reverses here, so a
    // companion held as a separate entry would come to precede the table it
    // belongs to and stop being recognised as its companion at all.
    ...(entry.companion === undefined
      ? {}
      : {
          companion: {
            from: entry.companion.to,
            to: entry.companion.from,
          },
        }),
  }));
  return { entries: inverted, hash: hashManifest(inverted) };
}

/**
 * Build the ordered rename plan.
 *
 * The registry is renamed **last**, so that for every step but the final one
 * the plan can still be rebuilt from the legacy registry on resume.
 *
 * That ordering is necessary but not sufficient. The final step has the same
 * commit-before-marker crash window as any other: once the registry rename
 * commits, a crash before the marker records it leaves a resume that must retry
 * a step whose source table no longer exists. So callers read registry rows
 * from whichever registry is present — legacy first, then the migrated name —
 * and this function produces an identical plan from either, because the rows
 * are its only input and nothing here reads the registry's own name from the
 * database.
 */
export function buildMigrationManifest(
  rows: readonly RegistryRow[]
): MigrationManifest {
  assertNoAliasedCompanion(rows);

  const entries: ManifestEntry[] = [];

  // Sorted by the stored table name so the plan is stable across runs. Step
  // numbers index into this list, so an unstable order would make a resumed
  // step point at a different object.
  const ordered = [...rows].sort((a, b) =>
    a.tableName < b.tableName ? -1 : a.tableName > b.tableName ? 1 : 0
  );

  for (const row of ordered) {
    // Idempotent by construction: a row already carrying a migrated name
    // produces no rename, so a plan rebuilt after a partial run contains only
    // the work still outstanding.
    const target = retargetName(row);

    if (target !== null) {
      // Derived from the table name that was read, not from the slug, so a
      // custom-named table's companion is still found.
      const suffix = STORAGE_FORMAT.companionSuffix;
      entries.push({
        kind: "table",
        from: row.tableName,
        to: target,
        ...(row.hasCompanion
          ? {
              companion: {
                from: `${row.tableName}${suffix}`,
                to: `${target}${suffix}`,
              },
            }
          : {}),
      });
    }

    // Every field-group data table carries the discriminator column: the schema
    // service emits it unconditionally, and so do all three runtime schemas.
    // A table left with the legacy column while the rest of its storage moved
    // would be read against the wrong name, so the column rename is
    // unconditional too. It is addressed by the table's post-rename name where
    // there is one, because the column rename runs after the table's.
    entries.push({
      kind: "column",
      from: STORAGE_FORMAT.columns.type,
      to: MIGRATION_TARGET.columnType,
      table: target ?? row.tableName,
    });
  }

  entries.push({
    kind: "registry",
    from: STORAGE_FORMAT.registryTable,
    to: MIGRATION_TARGET.registryTable,
  });

  assertNoTargetConflict(entries, rows);

  return { entries, hash: hashManifest(entries) };
}

/**
 * Hash the set of field groups a run was planned against.
 *
 * Row id **and** slug, not table names. `table_name` is rewritten as each rename
 * commits, so hashing it would stop matching partway through a run and refuse
 * the resume it exists to protect. The id is what makes this an identity rather
 * than a census: a slug alone cannot tell a group that survived from one that
 * was deleted and recreated under the same name, and a recreated row carrying an
 * author-chosen `dbName` of `fg_hero` would otherwise look exactly like the
 * migration's own completed work — letting a resume adopt the author's table and
 * a later rollback rename it away.
 *
 * `hasCompanion` is part of the identity because the plan's shape depends on it,
 * not just on which rows exist. Enabling localization on a field group creates a
 * companion table without replacing the registry row, so id and slug alone stay
 * identical while the storage the plan describes gains a table the recorded plan
 * never names — and the resume would move the base and leave the companion.
 *
 * Sorted by id so the hash is a property of the set rather than of row order.
 */
export function hashRegistryIdentity(
  rows: readonly { id: string; slug: string; hasCompanion: boolean }[]
): string {
  const canonical = JSON.stringify(
    rows
      .map(row => [row.id, row.slug, row.hasCompanion])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Hash the plan's object map.
 *
 * Covers what will be renamed and in what order, so a schema change between an
 * interrupted run and its resume is detected. It deliberately does not cover
 * the step list the running build produces; that is a separate hash, because a
 * Nextly upgrade can reorder steps while this map is untouched.
 */
export function hashManifest(entries: readonly ManifestEntry[]): string {
  // JSON rather than delimiter-joined text. `table_name` is an unconstrained
  // varchar, so a name containing the delimiters would let two different plans
  // serialize identically -- one row called
  // `a:_component_type>_field_group_type\ncolumn:b` produced the same bytes as
  // two rows called `a` and `b`. A resume would then accept a plan whose step
  // positions address different operations.
  //
  // `satisfied` is deliberately excluded: progress is not identity. A plan whose
  // steps have partly run is the same plan, and the marker must still recognise
  // it on resume.
  //
  // The companion is part of the map because it names a second physical table
  // this step moves. Omitting it would let two plans that rename the same table
  // but disagree about whether it has a companion hash identically, and a resume
  // would then accept a plan that moves one more object than the one recorded.
  const canonical = JSON.stringify(
    entries.map(e => [
      e.kind,
      e.table ?? null,
      e.from,
      e.to,
      e.companion === undefined ? null : [e.companion.from, e.companion.to],
    ])
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fold a name for occupancy comparisons.
 *
 * SQLite matches table names case-insensitively and MySQL usually does, so a
 * name differing only in case still occupies the target. Folding is the safe
 * direction for that question: it is stricter than Postgres requires, and a
 * refusal before the run costs an operator one rename while a missed conflict
 * fails after the marker is written.
 *
 * It is only sound because this asks whether a name is *taken*. Asking whether
 * a name *exists* needs the opposite bias, and that question is not asked here
 * — it belongs to catalog reconciliation, which has the dialect to answer it
 * properly.
 */
function fold(name: string): string {
  return name.toLowerCase();
}

/**
 * Refuse when one physical table is claimed by two field groups.
 *
 * A companion name is derived from its owner's table name, not stored, so it can
 * land on a name an author chose for a different group: `comp_hero`'s companion
 * computes to `comp_hero_locales`, which was a legal `dbName`. The unique
 * constraint on `table_name` does not prevent it, because the companion is not a
 * registry row.
 *
 * Left unchecked the collision hides rather than fails: the aliased row's stored
 * name appears among the sources this plan renames, so it reads as intentionally
 * renamed away, passes every conflict check, and has its table moved out from
 * under it. Ownership of a table cannot be shared, so this refuses.
 */
function assertNoAliasedCompanion(rows: readonly RegistryRow[]): void {
  // A row naming a system table is malformed rather than merely unusual, and the
  // damage is specific: the row is left unrenamed, so its discriminator rename
  // would be issued against the registry itself, and the registry's own rename
  // puts that name among the plan's sources so nothing flags the overlap.
  //
  // Compared exactly, not folded. This asks whether a row *is* the system table,
  // which is an identity question, and folding an identity question is
  // permanently destructive here: on Postgres a legitimate custom table quoted
  // as `DYNAMIC_COMPONENTS` is a different table, and refusing it would block
  // that installation's upgrade for good. The case-insensitive variant, where
  // MySQL really does resolve the two to one table, needs the dialect and so
  // belongs to catalog reconciliation.
  const systemTables = new Set<string>([
    STORAGE_FORMAT.registryTable,
    MIGRATION_TARGET.registryTable,
  ]);
  for (const row of rows) {
    if (!systemTables.has(row.tableName)) continue;
    throw NextlyError.serviceUnavailable({
      logMessage: `field-group migration cannot plan: ${row.tableName} is a system table, not field group storage`,
      logContext: {
        reason: "field group row names a system table",
        table: row.tableName,
        slug: row.slug,
      },
    });
  }

  // Compared exactly, like the system-table check above and unlike the
  // occupancy check below. This asks whether a derived companion name and a
  // stored table name are the *same physical table*, which is identity: on
  // Postgres a quoted `COMP_HERO_LOCALES` is a different table from
  // `comp_hero_locales`, and folding would refuse that installation for good.
  // Where MySQL really does resolve both spellings to one table, deciding that
  // needs the dialect and belongs to catalog reconciliation.
  const owners = new Map<string, string>();
  for (const row of rows) owners.set(row.tableName, row.slug);

  for (const row of rows) {
    if (!row.hasCompanion) continue;
    // No self-collision is possible: a name cannot equal itself plus a suffix,
    // so any owner found here is necessarily a different group.
    const companion = `${row.tableName}${STORAGE_FORMAT.companionSuffix}`;
    const owner = owners.get(companion);
    if (owner === undefined) continue;
    throw NextlyError.serviceUnavailable({
      logMessage: `field-group migration cannot plan: ${companion} is claimed by more than one field group`,
      logContext: {
        reason: "storage name is claimed by more than one field group",
        table: companion,
        companionOf: row.slug,
        storedBy: owner,
      },
    });
  }
}

/**
 * No two entries may claim the same name, and none may claim a name a registry
 * row is keeping.
 *
 * Both are properties of the plan and its inputs, which is why they are checked
 * here rather than against the database. A row whose table is left alone — one
 * named through `dbName` — still occupies its name, and `table_name` being
 * unique does not stop `comp_hero` and `fg_hero` coexisting.
 */
function assertNoTargetConflict(
  entries: readonly ManifestEntry[],
  rows: readonly RegistryRow[]
): void {
  const renamedAway = new Set(
    entries.flatMap(tableRenamesOf).map(rename => fold(rename.from))
  );
  // A row this plan leaves alone keeps its companion as well as its base table,
  // so both names stay occupied. Reserving only the base name let another row's
  // companion be renamed onto a companion that is still there.
  const kept = new Set<string>();
  for (const row of rows) {
    if (renamedAway.has(fold(row.tableName))) continue;
    kept.add(fold(row.tableName));
    if (row.hasCompanion) {
      kept.add(fold(`${row.tableName}${STORAGE_FORMAT.companionSuffix}`));
    }
  }

  const claimed = new Map<string, string>();
  for (const rename of entries.flatMap(tableRenamesOf)) {
    const key = fold(rename.to);

    if (kept.has(key)) {
      throw refuseRename(
        rename,
        "migration target name is already in use",
        `${rename.to} belongs to a field group this plan leaves unchanged`
      );
    }
    const previous = claimed.get(key);
    if (previous !== undefined) {
      throw refuseRename(
        rename,
        "two objects would be renamed to the same name",
        `${previous} also renames to ${rename.to}`
      );
    }
    claimed.set(key, rename.from);
  }
}

/** One physical table move: the name it leaves, and the name it takes. */
export interface TableRename {
  from: string;
  to: string;
}

/**
 * Every physical table an entry moves: its own, and its companion's.
 *
 * A companion occupies a name and can collide exactly like a table that has an
 * entry, so name checks have to see it even though it no longer has one of its
 * own. Column entries move no table and contribute nothing.
 */
export function tableRenamesOf(entry: ManifestEntry): TableRename[] {
  if (entry.kind === "column") return [];
  const own = { from: entry.from, to: entry.to };
  return entry.companion === undefined ? [own] : [own, entry.companion];
}

function refuseRename(
  rename: { from: string; to: string },
  reason: string,
  detail: string
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration cannot rename ${rename.from}: ${detail}`,
    logContext: { reason, from: rename.from, to: rename.to, detail },
  });
}

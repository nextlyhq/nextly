/**
 * `nextly_schema_owners`, read and written.
 *
 * A repository in the same shape as `SchemaEventsRepository`: constructed with
 * a Drizzle handle and a dialect, resolving its table from the dialect barrel.
 * The policy — what a transfer means, which states are reachable — stays in
 * `owner-registry.ts`, which is testable without a database. This is the half
 * that has to be right about three dialects.
 *
 * @module domains/schema/ownership/schema-owners-repository
 * @since 1.0.0
 */
import { eq, inArray } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { schemaOwnersTables } from "../../../schemas/schema-owners";

import type {
  OwnerKind,
  OwnerRecord,
  OwnerRegistryStore,
  OwnerState,
} from "./owner-registry";

/** Structural shape of the Drizzle methods this repository uses. */
type SelectChain = Promise<Array<Record<string, unknown>>> & {
  where: (c: unknown) => Promise<Array<Record<string, unknown>>>;
};
interface AnyDb {
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => Promise<unknown>;
  };
  select: () => { from: (t: unknown) => SelectChain };
  update: (t: unknown) => {
    set: (v: Record<string, unknown>) => {
      where: (c: unknown) => Promise<unknown>;
    };
  };
  delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
}

function toRecord(row: Record<string, unknown>): OwnerRecord {
  return {
    tableName: String(row.tableName),
    ownerKind: String(row.ownerKind) as OwnerKind,
    ownerId: String(row.ownerId),
    migratedBy: String(row.migratedBy),
    // Narrowed rather than stringified: the column is nullable text, and
    // `String()` on an unexpected shape yields "[object Object]" — a value
    // that would be written back to the database on the next upsert.
    ownerVersion:
      typeof row.ownerVersion === "string" ? row.ownerVersion : null,
    schemaVersion:
      typeof row.schemaVersion === "number" ? row.schemaVersion : null,
    state: String(row.state) as OwnerState,
  };
}

export class SchemaOwnersRepository {
  private readonly db: AnyDb;
  private readonly table: ReturnType<
    typeof schemaOwnersTables
  >["nextlySchemaOwners"];

  constructor(db: unknown, dialect: SupportedDialect) {
    this.db = db as AnyDb;
    this.table = schemaOwnersTables(dialect).nextlySchemaOwners;
  }

  /**
   * Rows for the named tables, or every row when none are named.
   *
   * `inArray` with an EMPTY list is avoided: some dialects render it as a
   * predicate that matches nothing and others reject it outright, and "no
   * names given" means "all rows" here rather than "no rows".
   */
  async read(tableNames?: readonly string[]): Promise<OwnerRecord[]> {
    const query = this.db.select().from(this.table);
    const rows =
      tableNames === undefined
        ? await query
        : tableNames.length === 0
          ? []
          : await query.where(inArray(this.table.tableName, [...tableNames]));
    return rows.map(toRecord);
  }

  /**
   * Insert or update each row.
   *
   * Done as a read-then-write per row rather than a dialect-specific upsert:
   * the three disagree about `ON CONFLICT` / `ON DUPLICATE KEY`, and this runs
   * inside the caller's transaction where a race cannot interleave.
   */
  async upsert(rows: readonly OwnerRecord[]): Promise<void> {
    if (rows.length === 0) return;
    const existing = new Set(
      (await this.read(rows.map(row => row.tableName))).map(
        row => row.tableName
      )
    );
    const now = new Date();

    for (const row of rows) {
      const values = {
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        migratedBy: row.migratedBy,
        ownerVersion: row.ownerVersion,
        schemaVersion: row.schemaVersion,
        state: row.state,
        updatedAt: now,
      };
      if (existing.has(row.tableName)) {
        await this.db
          .update(this.table)
          .set(values)
          .where(eq(this.table.tableName, row.tableName));
        continue;
      }
      await this.db.insert(this.table).values({
        tableName: row.tableName,
        ...values,
        createdAt: now,
      });
    }
  }

  /** Remove every row an owner holds. Used by uninstall. */
  async deleteByOwner(ownerId: string): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.ownerId, ownerId));
  }
}

/**
 * The repository IS the store the policy layer expects.
 *
 * Asserted at compile time rather than left to coincidence: the two are
 * written apart so the policy can be tested without a database, and nothing
 * else would notice if they drifted.
 */
const _satisfiesStore: OwnerRegistryStore =
  null as unknown as SchemaOwnersRepository;
void _satisfiesStore;

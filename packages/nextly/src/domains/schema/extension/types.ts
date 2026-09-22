/**
 * The dialect-neutral description of a table a plugin or app adds.
 *
 * Deliberately limited to the column kinds the collection pipeline already
 * renders on all three dialects, so a declaration is portable by construction:
 * what cannot be expressed here cannot drift between dialects. A plugin author
 * working on Postgres therefore cannot express a table that fails only once
 * somebody deploys it on MySQL.
 *
 * Kept free of Drizzle imports on purpose. This is the model every consumer
 * agrees on — the diff engine, the runtime registry and the migration
 * generator — and a Drizzle type reaching in here would make one of them the
 * privileged reader.
 *
 * @module domains/schema/extension/types
 * @since 1.0.0
 */
import type { ColumnKind } from "../services/field-column-descriptor";

/**
 * The kinds an extension column may take.
 *
 * `skip` and `fkSingle` are excluded because neither is a thing an author
 * declares: `skip` means a field stores its values in another table, and
 * `fkSingle` is emitted by the relation machinery rather than written down.
 */
export type ExtensionColumnKind = Exclude<ColumnKind, "skip" | "fkSingle">;

/**
 * A default no dialect stores literally, filled in per dialect at compile time.
 *
 * `now` becomes that dialect's current-timestamp expression.
 */
export interface DefaultToken {
  token: "now";
}

export interface ExtensionColumn {
  /** Property name as authored (camelCase allowed); `name` is the SQL column. */
  key: string;
  name: string;
  kind: ExtensionColumnKind;
  nullable: boolean;
  primaryKey?: boolean;
  /**
   * A literal default, or a portable token.
   *
   * The token is TAGGED rather than spelled as a magic string, because a magic
   * string cannot be told apart from a value: `"now"` is a perfectly ordinary
   * default for a text column, and an untagged union would render it as
   * CURRENT_TIMESTAMP. The tag makes the two representable at once.
   */
  default?: string | number | boolean | DefaultToken;
  generated?: "uuidv7";
  /**
   * Refreshed on every update, as a portable token.
   *
   * Written here rather than left to the caller because an `updated_at` that
   * only some writers remember to set is worse than none: it reads as accurate.
   */
  onUpdate?: "now";
  length?: number;
  precision?: number;
  scale?: number;
  /**
   * Whether this column is hidden from the entry API.
   *
   * True for a column added to a table its owner did not declare — an entity
   * or an extendable core table. An entity read is `db.select().from(table)`,
   * so an unhidden extension column would appear in every REST response,
   * every Direct API read, every version and every webhook payload; and
   * keeping it out of the runtime table instead would make the next dev push
   * propose DROPPING it.
   *
   * Hiding it at the row mapper is the only place both problems are solved at
   * once: the column exists everywhere the schema machinery looks, and
   * nowhere an entry is produced.
   */
  hidden?: boolean;

  /**
   * Documentation-only target of a reference column.
   *
   * Never a database constraint: `IndexSpec` cannot express a foreign key and
   * the Drizzle round-trip drops one, so emitting it would produce a constraint
   * the diff engine could neither see nor drop. Part C adds real FKs.
   */
  references?: string;
}

export interface ExtensionIndex {
  /** SQL column names. Order is significant — it decides left-prefix lookups. */
  columns: string[];
  unique: boolean;
  /** Optional explicit name; otherwise derived with the portable index-name rules. */
  name?: string;
}

/** Who added a table or index, recorded on every one of them. */
export type SchemaOwner = { kind: "plugin"; id: string } | { kind: "app" };

export interface ExtensionTable {
  /** Final SQL table name (prefix applied for plugins). */
  name: string;
  /**
   * The name as the author wrote it, before any prefix.
   *
   * Recorded rather than recovered by splitting the SQL name on the
   * separator: that split is a PROXY for the naming rules, and a proxy that
   * disagrees with them fails on exactly the tables it was written for.
   */
  authored: string;
  owner: SchemaOwner;
  columns: ExtensionColumn[];
  indexes: ExtensionIndex[];
}

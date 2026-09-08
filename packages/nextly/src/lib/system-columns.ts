/**
 * What a system column is, declared once.
 *
 * A system column is not one fact but several: which tables carry it, what shape it has per
 * dialect, whether a client may write it, what name it is published under, whether a user may take
 * that name for a field of their own. Each of those questions used to be answered by a separate
 * hand-written list, and a list only ever knows the columns that existed when it was written, so a
 * column could reach the physical table while some other surface went on as if it did not exist.
 *
 * Every one of those lists is a projection of this one, so a column declared here reaches all of
 * them at once. Where they genuinely differ, the difference is declared rather than implied: see
 * `reservedIn`, where the four validators do not agree and now say so.
 *
 * This module deliberately has no imports. Its consumers span the config layer, the shared response
 * helpers and the schema pipeline, and a leaf cannot create a cycle with any of them.
 *
 * @module lib/system-columns
 */

/** The dialects a physical shape is declared for. */
export type SystemColumnDialect = "postgresql" | "mysql" | "sqlite";

/** Which kind of table is being described. */
export type SystemColumnEntity = "collection" | "single";

/**
 * When a column is part of a table.
 *
 * `title` and `slug` are injected only when the author has not declared fields of their own by
 * those names, and the lifecycle pair exists only when Draft/Published is enabled. Spelled as a
 * token rather than a predicate so the set stays inspectable: a test can ask which columns the
 * lifecycle owns without evaluating anything.
 */
export type SystemColumnPresence =
  | "always"
  | "unlessAuthorDeclaredTitle"
  | "unlessAuthorDeclaredSlug"
  | "withStatusLifecycle";

/**
 * A validator that refuses a name for an author's own field.
 *
 * Four surfaces ask this question and they do NOT agree on the answer: the Schema Builder refuses
 * the widest set, the UI field-payload schema three universal columns, a code-first collection two,
 * a code-first single one. The narrower ones are missing names that collide — a code-first
 * collection may declare `createdAt` today, and it lands in the same `CREATE TABLE` as the injected
 * `created_at`, which the database rejects outright.
 *
 * Declared per surface rather than derived from one rule precisely because of that. One rule would
 * widen every validator at once, and a payload that is legal today would begin failing without
 * anyone deciding it should. Recording the disagreement is what makes correcting it a choice.
 */
export type ReservationSurface =
  | "builder"
  | "collectionConfig"
  | "singleConfig"
  | "fieldGroupConfig"
  | "uiSchema";

/**
 * Whether a surface refuses both spellings of a column or only the physical one.
 *
 * A property of the surface rather than of the column: it depends on what that validator's payload
 * can express, not on what the column is.
 *
 * Every surface refuses both, because every table these validate — a collection, a single, and a
 * component in its own `comp_` table — carries the columns under their physical names, and a field
 * whose camelCase name snake-cases onto one is emitted into the same `CREATE TABLE` as the injected
 * column. The statement is then rejected, so the payload could never have produced a working table.
 */
const RESERVATION_SPELLINGS: Readonly<
  Record<ReservationSurface, "both" | "columnOnly">
> = {
  builder: "both",
  collectionConfig: "both",
  singleConfig: "both",
  fieldGroupConfig: "both",
  uiSchema: "both",
};

/**
 * The column family a shape belongs to.
 *
 * Semantic rather than spelled per dialect, because three consumers need three different renderings
 * of the same fact: the introspection token the diff compares, the `CREATE TABLE` text, and the
 * Drizzle builder the runtime schema is made of. Spelling any of them out separately is how they
 * drift — a runtime schema built as text against a table created as a timestamp is exactly the
 * disagreement this module exists to prevent.
 */
export type SystemColumnKind = "text" | "varchar" | "timestamp";

/**
 * What a column defaults to, if anything.
 *
 * `now` is a database-side clock, spelled differently by every dialect. `literal` is a value, which
 * the DDL quotes and the Drizzle builder does not.
 */
export type SystemColumnDefault =
  | { kind: "now" }
  | { kind: "literal"; value: string };

/** The physical column, for one dialect. */
export interface SystemColumnShape {
  kind: SystemColumnKind;
  /** Declared size, for the dialects whose type carries one. */
  length?: number;
  nullable: boolean;
  primaryKey?: boolean;
  default?: SystemColumnDefault;
}

/**
 * The type token introspection reports for a shape: PostgreSQL `udt_name`, MySQL `COLUMN_TYPE`,
 * SQLite's declared PRAGMA type. The diff compares desired against live using this exact string.
 *
 * PostgreSQL reports `varchar` without its length while MySQL reports the full declared type, which
 * is why the two differ for the same column.
 */
export function systemColumnDialectType(
  shape: SystemColumnShape,
  dialect: SystemColumnDialect
): string {
  if (dialect === "postgresql") {
    return shape.kind === "timestamp" ? "timestamp" : shape.kind;
  }
  if (dialect === "mysql") {
    if (shape.kind === "timestamp") return "timestamp";
    if (shape.kind === "varchar") return `varchar(${shape.length ?? 255})`;
    return "text";
  }
  // SQLite stores a timestamp as an epoch integer and has no distinct varchar.
  return shape.kind === "timestamp" ? "integer" : "text";
}

/**
 * The default as it must appear in `CREATE TABLE`, or undefined when there is none.
 *
 * Must match what the runtime Drizzle builder emits for the same shape, or the diff reads a
 * phantom default change on every apply.
 */
export function systemColumnDefaultSql(
  shape: SystemColumnShape,
  dialect: SystemColumnDialect
): string | undefined {
  const value = shape.default;
  if (!value) return undefined;
  if (value.kind === "literal") return `'${value.value}'`;
  if (dialect === "postgresql") return "now()";
  if (dialect === "mysql") return "CURRENT_TIMESTAMP";
  return "(strftime('%s', 'now'))";
}

export interface SystemColumnDeclaration {
  /** The physical, snake_case column name. */
  name: string;
  /**
   * The camelCase spelling that snake-cases back to `name`, equal to `name` for a single word.
   *
   * Config validation accepts camelCase field names and converts them, so the two spellings reach
   * the same column and reserving one alone reserves nothing.
   */
  camelName: string;
  /** The tables that carry it. */
  appliesTo: readonly SystemColumnEntity[];
  presence: SystemColumnPresence;
  /**
   * Whether a value in a request body is honoured.
   *
   * False means the service alone decides it and a supplied value is stripped. `title`, `slug` and
   * `status` are system-injected and fully writable: they are content and lifecycle. Only the
   * columns describing provenance are closed.
   */
  writableByClient: boolean;
  /** Whether responses publish it under `camelName` and drop the snake_case key. */
  publishedUnderCamelName: boolean;
  /** Whether it is removed from responses entirely. */
  strippedFromResponses: boolean;
  reservedIn: readonly ReservationSurface[];
  shape: Readonly<Record<SystemColumnDialect, SystemColumnShape>>;
}

const BOTH_ENTITIES: readonly SystemColumnEntity[] = ["collection", "single"];

/**
 * Every system column, in the order a table declares them.
 *
 * Order is load-bearing: it is the column order of the emitted `CREATE TABLE`, so reordering this
 * array reorders physical tables.
 */
export const SYSTEM_COLUMNS: readonly SystemColumnDeclaration[] = [
  {
    name: "id",
    camelName: "id",
    appliesTo: BOTH_ENTITIES,
    presence: "always",
    writableByClient: false,
    publishedUnderCamelName: false,
    strippedFromResponses: false,
    reservedIn: [
      "builder",
      "collectionConfig",
      "singleConfig",
      "fieldGroupConfig",
      "uiSchema",
    ],
    shape: {
      postgresql: { kind: "text", nullable: false, primaryKey: true },
      mysql: {
        kind: "varchar",
        length: 36,
        nullable: false,
        primaryKey: true,
      },
      sqlite: { kind: "text", nullable: false, primaryKey: true },
    },
  },
  {
    name: "title",
    camelName: "title",
    appliesTo: BOTH_ENTITIES,
    presence: "unlessAuthorDeclaredTitle",
    writableByClient: true,
    publishedUnderCamelName: false,
    strippedFromResponses: false,
    reservedIn: ["builder"],
    shape: {
      postgresql: { kind: "text", nullable: false },
      mysql: { kind: "varchar", length: 255, nullable: false },
      sqlite: { kind: "text", nullable: false },
    },
  },
  {
    name: "slug",
    camelName: "slug",
    appliesTo: BOTH_ENTITIES,
    presence: "unlessAuthorDeclaredSlug",
    writableByClient: true,
    publishedUnderCamelName: false,
    strippedFromResponses: false,
    reservedIn: ["builder"],
    shape: {
      postgresql: { kind: "text", nullable: false },
      mysql: { kind: "varchar", length: 255, nullable: false },
      sqlite: { kind: "text", nullable: false },
    },
  },
  {
    // The defaults mirror what the runtime Drizzle generator builds, per dialect. A shape that
    // reports no default where the generator emits one describes the diff's desired state as
    // something neither creation path produces, and the diff then sees a phantom default change on
    // every apply. SQLite was the dialect that had none while the Schema Builder emitted this exact
    // expression, so an insert omitting the column stored NULL where the other two stored a time.
    name: "created_at",
    camelName: "createdAt",
    appliesTo: BOTH_ENTITIES,
    presence: "always",
    writableByClient: false,
    publishedUnderCamelName: true,
    strippedFromResponses: false,
    reservedIn: [
      "builder",
      "collectionConfig",
      "singleConfig",
      "fieldGroupConfig",
      "uiSchema",
    ],
    shape: {
      postgresql: {
        kind: "timestamp",
        nullable: true,
        default: { kind: "now" },
      },
      mysql: { kind: "timestamp", nullable: true, default: { kind: "now" } },
      sqlite: { kind: "timestamp", nullable: true, default: { kind: "now" } },
    },
  },
  {
    name: "updated_at",
    camelName: "updatedAt",
    appliesTo: BOTH_ENTITIES,
    presence: "always",
    writableByClient: false,
    publishedUnderCamelName: true,
    strippedFromResponses: false,
    reservedIn: [
      "builder",
      "collectionConfig",
      "singleConfig",
      "fieldGroupConfig",
      "uiSchema",
    ],
    shape: {
      postgresql: {
        kind: "timestamp",
        nullable: true,
        default: { kind: "now" },
      },
      mysql: { kind: "timestamp", nullable: true, default: { kind: "now" } },
      sqlite: { kind: "timestamp", nullable: true, default: { kind: "now" } },
    },
  },
  {
    // The creating user's id, not the row id, which is why MySQL sizes it to the users table's
    // varchar(191) rather than the varchar(36) row id: a longer user id would be truncated.
    // Nullable because existing rows and system or seed writes have no user.
    //
    // Collections only. A single is one global row, so owner-only access is meaningless and no
    // owner column is injected — which leaves `created_by` an ordinary, legal field name for a
    // single to declare. That is the case `appliesTo` exists for: sharing one list wholesale made
    // a single's own column get stripped on every write.
    name: "created_by",
    camelName: "createdBy",
    appliesTo: ["collection"],
    presence: "always",
    writableByClient: false,
    publishedUnderCamelName: false,
    // Owner-only access filters on this in SQL, so the value never needs to leave the server.
    // Returning it would hand a stable user id to anyone who can read a collection whose rows
    // were created by other people.
    strippedFromResponses: true,
    reservedIn: ["builder", "collectionConfig"],
    shape: {
      postgresql: { kind: "text", nullable: true },
      mysql: { kind: "varchar", length: 191, nullable: true },
      sqlite: { kind: "text", nullable: true },
    },
  },
  {
    // PostgreSQL declares this one as `varchar` with the size held only in `length`, because
    // information_schema reports udt_name=varchar for the runtime generator's
    // pgVarchar("status", { length: 20 }); emitting "varchar(20)" as the type would read as a
    // phantom type change on every apply. Existing rows backfill to 'draft' so unpublished
    // content cannot leak during the migration that adds the column.
    name: "status",
    camelName: "status",
    appliesTo: BOTH_ENTITIES,
    presence: "withStatusLifecycle",
    writableByClient: true,
    publishedUnderCamelName: false,
    strippedFromResponses: false,
    reservedIn: [],
    shape: {
      postgresql: {
        kind: "varchar",
        length: 20,
        nullable: false,
        default: { kind: "literal", value: "draft" },
      },
      mysql: {
        kind: "varchar",
        length: 20,
        nullable: false,
        default: { kind: "literal", value: "draft" },
      },
      sqlite: {
        kind: "text",
        nullable: false,
        default: { kind: "literal", value: "draft" },
      },
    },
  },
  {
    // When a document first became public.
    //
    // `status` says what a document IS; nothing said what it HAS BEEN. Unpublishing returns a row
    // to `draft` and erases every trace it was ever live, while the links, feeds and search results
    // it accumulated stay where they are. Anything deciding "was this address ever public" — slug
    // stability, redirect capture — needs a fact that survives that round trip.
    //
    // NULLABLE with NO DEFAULT, and that is the whole design. NULL means "not known to have been
    // published": true of a draft, and equally true of every row predating the column, which cannot
    // be told apart from a draft after the fact. A default would assert a publication that never
    // happened.
    //
    // Set once on the first transition into published and never moved, so it is not a
    // "last published" value. Those are different questions: a last-published timestamp moves on
    // every republish and its behaviour across an unpublish is a product choice, while this one has
    // a single defensible answer. Contentful carries both under distinct names for the same reason.
    //
    // Closed to clients for a reason the timestamps are not: it is meant to be written once, and a
    // value taken from a request would make that guarantee decorative — a draft create could claim
    // a publication that never happened, and any later update could reset a real one.
    name: "first_published_at",
    camelName: "firstPublishedAt",
    appliesTo: BOTH_ENTITIES,
    presence: "withStatusLifecycle",
    writableByClient: false,
    publishedUnderCamelName: true,
    strippedFromResponses: false,
    // Reserved even on an entity that has not enabled the lifecycle, because enabling it later
    // would otherwise collide at migration time rather than here, where the name is chosen.
    reservedIn: ["builder", "collectionConfig", "singleConfig"],
    shape: {
      postgresql: { kind: "timestamp", nullable: true },
      mysql: { kind: "timestamp", nullable: true },
      sqlite: { kind: "timestamp", nullable: true },
    },
  },
];

// ============================================================
// Projections
// ============================================================

/**
 * Both spellings of a column, deduplicated.
 *
 * Single-word columns spell the same in either case, and a list that repeated them would make
 * every consumer's set look larger than the set of columns it describes.
 */
function bothSpellings(column: SystemColumnDeclaration): string[] {
  return column.name === column.camelName
    ? [column.name]
    : [column.name, column.camelName];
}

/** Every spelling of every column matching `predicate`, in declaration order. */
export function systemColumnNames(
  predicate: (column: SystemColumnDeclaration) => boolean
): string[] {
  return SYSTEM_COLUMNS.filter(predicate).flatMap(bothSpellings);
}

/**
 * Whether a physical column name is one this surface reserves.
 *
 * Takes the column rather than the field name, so a caller normalizes with the rule its own
 * generator uses and no spelling can slip past by being cased differently. Matching literal
 * spellings can only ever cover the ones somebody thought of.
 */
export function isReservedSystemColumn(
  physicalName: string,
  surface: ReservationSurface
): boolean {
  return SYSTEM_COLUMNS.some(
    column =>
      column.name === physicalName && column.reservedIn.includes(surface)
  );
}

/**
 * Whether an author's own field may take over this column by declaring it.
 *
 * True only for the columns whose presence is conditional on the author declaring them — today
 * `title` and `slug`. Taking one over is allowed **under that column's own name only**: a field
 * named `Title` reaches the same column but stays a different identity everywhere the declared
 * name is the key — the runtime table's property, the payload keys a mutation generates, the
 * response document, the generated types — so the two would write one column under two names and
 * the generated value would overwrite the author's.
 */
export function isOwnableSystemColumn(
  physicalName: string,
  entity: SystemColumnEntity
): boolean {
  return SYSTEM_COLUMNS.some(
    column =>
      column.name === physicalName &&
      column.appliesTo.includes(entity) &&
      (column.presence === "unlessAuthorDeclaredTitle" ||
        column.presence === "unlessAuthorDeclaredSlug")
  );
}

/**
 * Whether this column exists only because the publish lifecycle is enabled.
 *
 * The lifecycle owns the column's exact shape — its length, its NOT NULL, its `'draft'` default
 * and the values publish/unpublish write — so an author's field cannot stand in for it. When the
 * lifecycle is on, a field reaching one of these columns is a collision rather than a takeover.
 */
export function isLifecycleSystemColumn(
  physicalName: string,
  entity: SystemColumnEntity
): boolean {
  return SYSTEM_COLUMNS.some(
    column =>
      column.name === physicalName &&
      column.appliesTo.includes(entity) &&
      column.presence === "withStatusLifecycle"
  );
}

/**
 * Whether the lifecycle already emits a member under this DECLARED name.
 *
 * Distinct from the column question. A field that occupies no column — a
 * component, a many-to-many — is exempt from every column rule because its
 * values live in its own table, but it keeps its declared name as its payload
 * key and as its member in the generated types and schemas. The lifecycle emits
 * a member under the column's own name, so the two are declared twice there
 * even though they never share a column.
 *
 * Matched on the declared name rather than the converted column, because that
 * is the key the artifacts emit: a column-less `Status` stays a distinct member
 * and is left alone, while a column-producing one is caught by the column rule.
 *
 * Stated once because both the collection and the Single validator ask it, and
 * an answer written twice is one that can drift.
 */
export function lifecycleReservesDeclaredName(
  name: string,
  entity: SystemColumnEntity,
  lifecycleEnabled: boolean
): boolean {
  return lifecycleEnabled && isLifecycleSystemColumn(name, entity);
}

/** The refusal both validators report for {@link lifecycleReservesDeclaredName}. */
export function lifecycleDeclaredNameMessage(name: string): string {
  return `Field name '${name}' is owned by the Draft/Published lifecycle and would be declared twice in the generated types. Rename the field, or turn the lifecycle off`;
}

/** The names a validator on `surface` refuses for an author's own field. */
export function reservedSystemFieldNames(
  surface: ReservationSurface
): string[] {
  const columns = SYSTEM_COLUMNS.filter(column =>
    column.reservedIn.includes(surface)
  );
  return RESERVATION_SPELLINGS[surface] === "columnOnly"
    ? columns.map(column => column.name)
    : columns.flatMap(bothSpellings);
}

/**
 * The columns a client may never write, for a given entity.
 *
 * `appliesTo` is what keeps a single's own `created_by` field: the column does not exist on a
 * single's table, so the name is an ordinary one there and stripping it would silently discard the
 * author's own value on every write.
 */
export function immutableSystemColumnNames(
  entity: SystemColumnEntity
): string[] {
  return systemColumnNames(
    column => !column.writableByClient && column.appliesTo.includes(entity)
  );
}

/**
 * The columns a client may never write, on any entity.
 *
 * The union rather than one entity's view, for callers that run before the entity is known or that
 * protect both — a restore refuses to carry the owner column back even for a single, where it is
 * not a system column at all.
 */
export function immutableSystemColumnNamesAnyEntity(): string[] {
  return systemColumnNames(column => !column.writableByClient);
}

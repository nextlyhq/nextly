/**
 * What a system column is, declared once.
 *
 * A system column is not one fact but several: which tables carry it, what shape it has per
 * dialect, whether a client may write it, what name it is published under, whether a user may take
 * that name for a field of their own. Those answers were spread across nine modules, each holding a
 * hand-written list of the columns it happened to know about when it was written. Nothing connected
 * them, so adding a column had no definition of done — it was finished when a reviewer stopped
 * finding lists that had not been edited, and roughly a third of the review findings on the two
 * pull requests that added `first_published_at` were exactly that.
 *
 * Every one of those lists is now a projection of this one. A column added here reaches all of them
 * at once, and the disagreements between them became visible instead of accidental: see
 * `reservedIn`, where the four validators genuinely do not agree and now say so.
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
  | "uiSchema";

/**
 * Whether a surface refuses both spellings of a column or only the physical one.
 *
 * A property of the surface rather than of the column: it depends on what that validator's payload
 * can express, not on what the column is.
 *
 * `uiSchema` validates field payloads for collections, singles AND components, and a component
 * keeps its values in tables of its own whose system columns are not described here. Refusing the
 * camelCase spelling there could reject a component field that is legal today, so it stays as
 * narrow as it is until those tables are declared too.
 */
const RESERVATION_SPELLINGS: Readonly<
  Record<ReservationSurface, "both" | "columnOnly">
> = {
  builder: "both",
  collectionConfig: "both",
  singleConfig: "both",
  uiSchema: "columnOnly",
};

/** The physical column, for one dialect. */
export interface SystemColumnShape {
  dialectType: string;
  /** Declared size, where the dialect carries one separately from `dialectType`. */
  length?: number;
  nullable: boolean;
  primaryKey?: boolean;
  /** Raw DDL default expression, exactly as it must appear (`now()`, `'draft'`). */
  default?: string;
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
    reservedIn: ["builder", "uiSchema"],
    shape: {
      postgresql: { dialectType: "text", nullable: false, primaryKey: true },
      mysql: {
        dialectType: "varchar(36)",
        length: 36,
        nullable: false,
        primaryKey: true,
      },
      sqlite: { dialectType: "text", nullable: false, primaryKey: true },
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
      postgresql: { dialectType: "text", nullable: false },
      mysql: { dialectType: "varchar(255)", length: 255, nullable: false },
      sqlite: { dialectType: "text", nullable: false },
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
      postgresql: { dialectType: "text", nullable: false },
      mysql: { dialectType: "varchar(255)", length: 255, nullable: false },
      sqlite: { dialectType: "text", nullable: false },
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
    reservedIn: ["builder", "uiSchema"],
    shape: {
      postgresql: {
        dialectType: "timestamp",
        nullable: true,
        default: "now()",
      },
      mysql: {
        dialectType: "timestamp",
        nullable: true,
        default: "CURRENT_TIMESTAMP",
      },
      sqlite: {
        dialectType: "integer",
        nullable: true,
        default: "(strftime('%s', 'now'))",
      },
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
    reservedIn: ["builder", "uiSchema"],
    shape: {
      postgresql: {
        dialectType: "timestamp",
        nullable: true,
        default: "now()",
      },
      mysql: {
        dialectType: "timestamp",
        nullable: true,
        default: "CURRENT_TIMESTAMP",
      },
      sqlite: {
        dialectType: "integer",
        nullable: true,
        default: "(strftime('%s', 'now'))",
      },
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
      postgresql: { dialectType: "text", nullable: true },
      mysql: { dialectType: "varchar(191)", length: 191, nullable: true },
      sqlite: { dialectType: "text", nullable: true },
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
        dialectType: "varchar",
        length: 20,
        nullable: false,
        default: "'draft'",
      },
      mysql: {
        dialectType: "varchar(20)",
        length: 20,
        nullable: false,
        default: "'draft'",
      },
      sqlite: { dialectType: "text", nullable: false, default: "'draft'" },
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
      postgresql: { dialectType: "timestamp", nullable: true },
      mysql: { dialectType: "timestamp", nullable: true },
      sqlite: { dialectType: "integer", nullable: true },
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

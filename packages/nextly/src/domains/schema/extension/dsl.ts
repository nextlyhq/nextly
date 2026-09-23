/**
 * The authoring surface for an extension table, and the types it infers.
 *
 * Two things happen here and nowhere else: a column is described as plain data,
 * and that description is given a TypeScript type. Both matter. The data is
 * what every consumer downstream compiles — so the DSL holds no Drizzle import
 * and no dialect branch — and the type is what lets `ctx.db` be checked without
 * a codegen step, which is the part Payload's hook tables lose.
 *
 * The type carried alongside each column is PHANTOM: declared on the interface,
 * never assigned at runtime. That is what keeps a definition JSON-serialisable
 * while still being precise enough to infer a row from.
 *
 * @module domains/schema/extension/dsl
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { DeclaredCheck, DeclaredForeignKey } from "./types";
import { toSnakeCase } from "../services/field-column-descriptor";

import type {
  DefaultToken,
  ExtensionColumnKind,
  ExtensionIndex,
} from "./types";

/** The current-timestamp token, as one value so it compares by identity too. */
const NOW: DefaultToken = { token: "now" };

function invalid(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/**
 * One column, as data plus a phantom type.
 *
 * `TValue` is the value the column reads back as, `TNullable` whether it may be
 * null, and `THasDefault` whether an insert may omit it. The last two are
 * separate because they answer different questions: a nullable column widens
 * the READ type, a defaulted one narrows what a WRITE must supply.
 */
export interface ColumnBuilder<
  TValue = unknown,
  TNullable extends boolean = boolean,
  THasDefault extends boolean = boolean,
> {
  readonly kind: ExtensionColumnKind;
  readonly nullable: TNullable;
  readonly hasDefault: THasDefault;
  readonly default?: string | number | boolean | DefaultToken;
  readonly generated?: "uuidv7";
  readonly onUpdate?: "now";
  /** The permitted values, for the `enum` kind. */
  readonly enumValues?: readonly string[];
  /** An explicit type name for a native PostgreSQL enum. */
  readonly enumName?: string;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly primaryKey?: boolean;
  readonly references?: string;
  /** Phantom. Never assigned, so it survives no JSON round trip — by design. */
  readonly __value?: TValue;
}

/** Options every scalar builder accepts. */
export interface ColOpts<TValue> {
  nullable?: boolean;
  default?: TValue extends string | number | boolean ? TValue : never;
}

type NullableOf<O> = O extends { nullable: true } ? true : false;
type HasDefaultOf<O> = O extends { default: string | number | boolean }
  ? true
  : false;

function build<TValue>(
  kind: ExtensionColumnKind,
  opts: ColOpts<TValue> | undefined,
  extra: Partial<ColumnBuilder<TValue>> = {}
): ColumnBuilder<TValue, boolean, boolean> {
  const hasDefault = opts?.default !== undefined;
  return {
    kind,
    nullable: opts?.nullable === true,
    hasDefault,
    ...(hasDefault ? { default: opts?.default } : {}),
    ...extra,
  };
}

/**
 * `col.json`, as an overload set.
 *
 * Overloaded rather than inferred from the options, because supplying `T`
 * explicitly switches TypeScript's inference off for every remaining type
 * parameter — so one signature taking both would record `{ nullable: true }`
 * without widening the type it produces.
 */
export interface JsonColumnBuilder {
  <T = unknown>(opts: { nullable: true }): ColumnBuilder<T, true, false>;
  <T = unknown>(opts?: { nullable?: false }): ColumnBuilder<T, false, false>;
}

/**
 * The column builders.
 *
 * Each returns data, so a definition can be inspected, serialised and diffed
 * without evaluating anything. The generic on each one exists to capture the
 * OPTIONS object literally, which is what makes `{ nullable: true }` widen the
 * inferred type rather than merely being recorded.
 */
export const col = {
  /** PG `text`, MySQL `varchar(255)`, SQLite `text`. */
  text<const O extends ColOpts<string>>(
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    return build<string>("text", opts) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** An explicitly short text field: `varchar(255)` on PG and MySQL. */
  shortText<const O extends ColOpts<string>>(
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    return build<string>("shortText", opts) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** Unbounded text, for textarea and rich-text sized values. */
  longText<const O extends ColOpts<string>>(
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    return build<string>("longText", opts) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** `varchar(n)`. A bounded width is what makes a text column indexable on MySQL. */
  varchar<const O extends ColOpts<string>>(
    length: number,
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    if (!Number.isInteger(length) || length < 1 || length > 65_535) {
      invalid(
        "varchar.length",
        `A varchar length must be an integer between 1 and 65535; received ${String(length)}.`
      );
    }
    return build<string>("varchar", opts, { length }) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  boolean<const O extends ColOpts<boolean>>(
    opts?: O
  ): ColumnBuilder<boolean, NullableOf<O>, HasDefaultOf<O>> {
    return build<boolean>("boolean", opts) as ColumnBuilder<
      boolean,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  integer<const O extends ColOpts<number>>(
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    return build<number>("integer", opts) as ColumnBuilder<
      number,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  double<const O extends ColOpts<number>>(
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    return build<number>("double", opts) as ColumnBuilder<
      number,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /**
   * Exact `DECIMAL(precision, scale)`.
   *
   * Reads back as a number, matching the runtime column builders, which use
   * Drizzle's `mode: "number"`. Values beyond 2^53 lose precision, so money
   * belongs in an `integer` column of minor units rather than here.
   */
  decimal<const O extends ColOpts<number>>(
    precision: number,
    scale: number,
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    if (!Number.isInteger(precision) || precision < 1 || precision > 65) {
      invalid(
        "decimal.precision",
        `A decimal precision must be an integer between 1 and 65; received ${String(precision)}.`
      );
    }
    if (!Number.isInteger(scale) || scale < 0) {
      invalid(
        "decimal.scale",
        `A decimal scale must be a non-negative integer; received ${String(scale)}.`
      );
    }
    // A scale wider than the precision describes no representable number: the
    // scale counts digits that the precision has not allocated.
    if (scale > precision) {
      invalid(
        "decimal.scale",
        `A decimal scale (${String(scale)}) may not exceed its precision (${String(precision)}).`
      );
    }
    return build<number>("decimal", opts, {
      precision,
      scale,
    }) as ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>>;
  },

  timestamp<const O extends ColOpts<never>>(
    opts?: O
  ): ColumnBuilder<Date, NullableOf<O>, HasDefaultOf<O>> {
    return build<Date>("timestamp", opts) as ColumnBuilder<
      Date,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /**
   * A JSON document, typed by its caller.
   *
   * Overloaded rather than inferred from the options, because supplying `T`
   * explicitly switches TypeScript's inference off for every remaining type
   * parameter — so a single signature would record `{ nullable: true }` without
   * widening the type it produces.
   */
  json: ((opts?: { nullable?: boolean }) =>
    build<unknown>("json", {
      nullable: opts?.nullable === true,
    })) as JsonColumnBuilder,

  /** 64-bit integer. Reads as a number, so values beyond 2^53 lose precision. */
  bigint<const O extends ColOpts<number>>(
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    return build<number>("bigint", opts) as ColumnBuilder<
      number,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** 16-bit integer. */
  smallint<const O extends ColOpts<number>>(
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    return build<number>("smallint", opts) as ColumnBuilder<
      number,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /**
   * Fixed-width text.
   *
   * Worth knowing before choosing it: PostgreSQL PADS a `char(n)` value with
   * spaces to the full width, and returns it padded. A country code is the
   * case it suits; anything variable belongs in `varchar`.
   */
  char<const O extends ColOpts<string>>(
    length: number,
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    if (!Number.isInteger(length) || length < 1 || length > 255) {
      invalid(
        "char.length",
        `A char length must be an integer between 1 and 255; received ${String(length)}.`
      );
    }
    return build<string>("char", opts, { length }) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** A UUID. Native on PostgreSQL; `char(36)` on MySQL; text on SQLite. */
  uuid<const O extends ColOpts<string>>(
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    return build<string>("uuid", opts) as ColumnBuilder<
      string,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** 32-bit float. Prefer `decimal` for money. */
  real<const O extends ColOpts<number>>(
    opts?: O
  ): ColumnBuilder<number, NullableOf<O>, HasDefaultOf<O>> {
    return build<number>("real", opts) as ColumnBuilder<
      number,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /** Raw bytes. */
  bytes<const O extends ColOpts<never>>(
    opts?: O
  ): ColumnBuilder<Uint8Array, NullableOf<O>, HasDefaultOf<O>> {
    return build<Uint8Array>("bytes", opts) as ColumnBuilder<
      Uint8Array,
      NullableOf<O>,
      HasDefaultOf<O>
    >;
  },

  /**
   * One of a fixed set of strings.
   *
   * `InferRow` gives the literal union, so a value outside the set is a
   * compile error rather than a row the database refuses. The storage differs
   * by dialect — a native type on PostgreSQL, `ENUM(...)` on MySQL, text with
   * a CHECK on SQLite — and the declaration is the same everywhere.
   */
  enum<const TValues extends readonly string[]>(
    values: TValues,
    opts?: { nullable?: boolean; name?: string }
  ): ColumnBuilder<TValues[number], boolean, false> {
    if (values.length === 0) {
      invalid("enum.values", "An enum must list at least one value.");
    }
    if (new Set(values).size !== values.length) {
      invalid("enum.values", "An enum may not list a value twice.");
    }
    return {
      kind: "enum",
      nullable: opts?.nullable === true,
      hasDefault: false,
      enumValues: [...values],
      ...(opts?.name !== undefined ? { enumName: opts.name } : {}),
    };
  },

  /**
   * The conventional primary key: a `varchar(36)` filled with a UUIDv7.
   *
   * Bounded rather than `text` so it stays indexable and usable in a unique key
   * on MySQL, where an unbounded text column is neither.
   */
  id(): ColumnBuilder<string, false, true> {
    return {
      kind: "varchar",
      length: 36,
      nullable: false,
      hasDefault: true,
      primaryKey: true,
      generated: "uuidv7",
    };
  },

  /**
   * A reference to another table, recorded but not constrained.
   *
   * `references` is documentation and a validation target; no FK reaches the
   * database in this part, because the diff engine cannot express one.
   */
  ref<const O extends ColOpts<string>>(
    target: string,
    opts?: O
  ): ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>> {
    if (target.trim() === "") {
      invalid("ref.target", "A reference must name a target table.");
    }
    return build<string>("shortText", opts, {
      references: target,
    }) as ColumnBuilder<string, NullableOf<O>, HasDefaultOf<O>>;
  },

  /** `created_at` and `updated_at`, both maintained by `ctx.db`. */
  timestamps(): {
    createdAt: ColumnBuilder<Date, false, true>;
    updatedAt: ColumnBuilder<Date, false, true>;
  } {
    return {
      createdAt: {
        kind: "timestamp",
        nullable: false,
        hasDefault: true,
        default: NOW,
      },
      updatedAt: {
        kind: "timestamp",
        nullable: false,
        hasDefault: true,
        default: NOW,
        onUpdate: "now",
      },
    };
  },
};

/** What an author writes as the index list on a table. */
export interface TableIndexInput {
  /** Column KEYS as authored; resolved to SQL names by `defineTable`. */
  columns: string[];
  unique?: boolean;
  name?: string;
  /** Partial-index predicate. PostgreSQL and SQLite only; MySQL is refused by its renderer. */
  where?: string;
  /** Expression index, per-dialect SQL, in place of column names. */
  expression?: string;
}

/** A foreign key declared on the table's own columns. */
export interface TableForeignKeyInput {
  /** Column KEYS as authored; resolved to SQL names by `defineTable`. */
  columns: string[];
  references: { table: string; columns: string[] };
  onDelete?: "cascade" | "set null" | "restrict" | "no action" | "set default";
  onUpdate?: "cascade" | "set null" | "restrict" | "no action" | "set default";
  /** Defaults to `fk_<table>_<cols>`. */
  name?: string;
}

/** A check constraint; `sql` is the boolean expression over SQL column names. */
export interface TableCheckInput {
  /** Defaults to `ck_<table>_<name>`. */
  name: string;
  sql: string;
}

/** A relation edge as the author writes it: target is the FINAL table name (prefixed, or a core table like users). */
export interface TableRelationInput {
  /** The property a relational query names under "with". */
  name: string;
  kind: "one" | "many";
  targetTable: string;
  /** This table column key, for a one-edge. */
  fromColumn?: string;
  /** The target column key, for a many-edge. */
  toColumn?: string;
}

export interface TableDefinitionOptions {
  indexes?: TableIndexInput[];
  foreignKeys?: TableForeignKeyInput[];
  checks?: TableCheckInput[];
  relations?: TableRelationInput[];
}

/** The output of `defineTable`: plain data, plus the column map as a phantom. */
export interface TableDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnBuilder> = Record<
    string,
    ColumnBuilder
  >,
> {
  readonly name: TName;
  readonly columns: readonly ResolvedColumn[];
  readonly indexes: readonly ExtensionIndex[];
  readonly foreignKeys: readonly DeclaredForeignKey[];
  readonly checks: readonly DeclaredCheck[];
  readonly relations: readonly TableRelationInput[];
  readonly __columns?: TColumns;
}

/** A column once its SQL name is known. Mirrors `ExtensionColumn` minus ownership. */
export interface ResolvedColumn {
  key: string;
  name: string;
  kind: ExtensionColumnKind;
  nullable: boolean;
  primaryKey?: boolean;
  default?: string | number | boolean | DefaultToken;
  generated?: "uuidv7";
  onUpdate?: "now";
  enumValues?: readonly string[];
  enumName?: string;
  length?: number;
  precision?: number;
  scale?: number;
  references?: string;
}

/**
 * The optional fields a resolved column copies when the builder set them.
 *
 * A list rather than a conditional spread per field: each was its own branch,
 * and the count grew with every kind that needed one more. Copying by key also
 * means a field added to `ColumnBuilder` reaches `ResolvedColumn` by being
 * named here once.
 */
const OPTIONAL_COLUMN_FIELDS = [
  "primaryKey",
  "default",
  "generated",
  "onUpdate",
  "enumValues",
  "enumName",
  "length",
  "precision",
  "scale",
  "references",
] as const satisfies readonly (keyof ColumnBuilder)[];

/**
 * One column, once its SQL name is known.
 *
 * Optional fields are omitted rather than set to `undefined`, because the
 * definition is compared by value downstream and an explicit `undefined` is
 * not the same shape as an absent key.
 */
function toResolvedColumn(
  key: string,
  sqlName: string,
  builder: ColumnBuilder
): ResolvedColumn {
  const resolved: ResolvedColumn = {
    key,
    name: sqlName,
    kind: builder.kind,
    nullable: builder.nullable,
  };
  for (const field of OPTIONAL_COLUMN_FIELDS) {
    const value = builder[field];
    if (value !== undefined) {
      (resolved as unknown as Record<string, unknown>)[field] = value;
    }
  }
  return resolved;
}

/** The resolved columns, and the key each SQL name came from. */
function resolveColumns(
  tableName: string,
  columns: Record<string, ColumnBuilder>
): { resolved: ResolvedColumn[]; byName: Map<string, string> } {
  const resolved: ResolvedColumn[] = [];
  const byName = new Map<string, string>();

  for (const [key, builder] of Object.entries(columns)) {
    const sqlName = toSnakeCase(key);
    const clash = byName.get(sqlName);
    // Two authored keys can snake-case to one column — `fooBar` and `foo_bar`
    // are the obvious pair — and the table would then declare it twice.
    if (clash !== undefined) {
      invalid(
        `${tableName}.${key}`,
        `Columns "${clash}" and "${key}" both resolve to the SQL column "${sqlName}".`
      );
    }
    byName.set(sqlName, key);
    resolved.push(toResolvedColumn(key, sqlName, builder));
  }

  if (resolved.length === 0) {
    invalid(tableName, "A table must declare at least one column.");
  }
  return { resolved, byName };
}

/** Index inputs with their column KEYS resolved to SQL names. */
function resolveIndexes(
  tableName: string,
  byName: ReadonlyMap<string, string>,
  inputs: readonly TableIndexInput[]
): ExtensionIndex[] {
  return inputs.map((index, position) => {
    const path = `${tableName}.indexes[${String(position)}]`;
    if (index.columns.length === 0 && !index.expression) {
      invalid(
        path,
        "An index must name at least one column or carry an expression."
      );
    }
    const columns = index.columns.map(columnKey => {
      const sqlName = toSnakeCase(columnKey);
      if (!byName.has(sqlName)) {
        invalid(
          path,
          `Index names the column "${columnKey}", which the table does not declare.`
        );
      }
      return sqlName;
    });
    return {
      columns,
      unique: index.unique === true,
      ...(index.name !== undefined ? { name: index.name } : {}),
      ...(index.where !== undefined ? { where: index.where } : {}),
      ...(index.expression !== undefined ? { expression: index.expression } : {}),
    };
  });
}

/** Resolve the author's foreign keys to specs, deriving names and defaults. */
function resolveForeignKeys(
  tableName: string,
  byName: ReadonlyMap<string, string>,
  inputs: readonly TableForeignKeyInput[]
): DeclaredForeignKey[] {
  return inputs.map((input, position) => {
    const path = `${tableName}.foreignKeys[${String(position)}]`;
    const columns = input.columns.map(columnKey => {
      const sqlName = toSnakeCase(columnKey);
      if (!byName.has(sqlName)) {
        invalid(
          path,
          `The foreign key names the column "${columnKey}", which the table does not declare.`
        );
      }
      return sqlName;
    });
    if (input.references.columns.length !== columns.length) {
      invalid(
        path,
        "A foreign key must reference exactly as many columns as it declares."
      );
    }
    return {
      // Derived at COMPILE time from the FINAL table name, because that is
      // the name live introspection also derives from — a name derived here
      // (pre-prefix) could never match the live side and the diff would
      // propose a drop-plus-add on every comparison.
      name: input.name,
      columns,
      referencesTable: input.references.table,
      referencesColumns: [...input.references.columns],
      onDelete: input.onDelete ?? "no action",
      onUpdate: input.onUpdate ?? "no action",
    };
  });
}

/** Resolve the author's relation edges: keys snake-cased against THIS table's columns, targets kept as final table names. */
function resolveRelations(
  tableName: string,
  byName: ReadonlyMap<string, string>,
  inputs: readonly TableRelationInput[]
): TableRelationInput[] {
  return inputs.map((input, position) => {
    const path = `${tableName}.relations[${String(position)}]`;
    if (input.fromColumn !== undefined) {
      const sqlName = toSnakeCase(input.fromColumn);
      if (!byName.has(sqlName)) {
        invalid(
          path,
          `The relation names the column ${input.fromColumn}, which the table does not declare.`
        );
      }
      return { ...input, fromColumn: sqlName };
    }
    if (input.kind === "one") {
      invalid(path, "A one-edge must name its fromColumn.");
    }
    return input;
  });
}

/** Resolve the author's checks to specs under the ck_ naming rule. */
function resolveChecks(
  tableName: string,
  inputs: readonly TableCheckInput[]
): DeclaredCheck[] {
  return inputs.map((input, position) => {
    if (input.sql.trim() === "") {
      invalid(
        `${tableName}.checks[${String(position)}]`,
        "A check must carry a SQL expression."
      );
    }
    return { name: input.name, sql: input.sql };
  });
}

/**
 * Describe a table.
 *
 * Validation happens here rather than at compile time because the failures that
 * matter — two keys colliding once snake-cased, an index naming a column that
 * is not there — are about the table as a WHOLE, and no per-column type can see
 * its siblings.
 */
export function defineTable<
  const TName extends string,
  const TColumns extends Record<string, ColumnBuilder>,
>(
  name: TName,
  columns: TColumns,
  opts?: TableDefinitionOptions
): TableDefinition<TName, TColumns> {
  if (name.trim() === "") {
    invalid("table.name", "A table must be named.");
  }
  const { resolved, byName } = resolveColumns(name, columns);
  const indexes = resolveIndexes(name, byName, opts?.indexes ?? []);
  const foreignKeys = resolveForeignKeys(
    name,
    byName,
    opts?.foreignKeys ?? []
  );
  const checks = resolveChecks(name, opts?.checks ?? []);
  const declaredRelations = resolveRelations(
    name,
    byName,
    opts?.relations ?? []
  );
  // A ref() column carries its one-edge implicitly: the target is already
  // declared beside the column, and asking the author to repeat it as a
  // relation would be a second place to say the same thing. An explicit
  // relation with the same name wins, so an author can rename or retarget
  // the edge without the column fighting them.
  const declaredNames = new Set(declaredRelations.map(rel => rel.name));
  const autoRelations: TableRelationInput[] = resolved
    .filter(column => column.references !== undefined)
    .filter(column => !declaredNames.has(column.key))
    .map(column => ({
      name: column.key,
      kind: "one" as const,
      targetTable: column.references as string,
      // The SQL name: the registry resolves edges against the table's
      // column properties, which are keyed by SQL name.
      fromColumn: column.name,
    }));
  const relations = [...declaredRelations, ...autoRelations];

  return Object.freeze({
    name,
    columns: Object.freeze(resolved),
    indexes: Object.freeze(indexes),
    foreignKeys: Object.freeze(foreignKeys),
    checks: Object.freeze(checks),
    relations: Object.freeze(relations),
  });
}

type ValueOf<B> =
  B extends ColumnBuilder<infer TValue, infer TNullable, boolean>
    ? TNullable extends true
      ? TValue | null
      : TValue
    : never;

type OptionalInsertKeys<TColumns> = {
  [K in keyof TColumns]: TColumns[K] extends ColumnBuilder<
    unknown,
    infer TNullable,
    infer THasDefault
  >
    ? TNullable extends true
      ? K
      : THasDefault extends true
        ? K
        : never
    : never;
}[keyof TColumns];

/**
 * The row a select returns.
 *
 * `-readonly` is load-bearing: `defineTable` captures its columns with a
 * `const` type parameter, which marks every inferred property readonly. Left
 * on, a caller could not assign to a row they had just read back.
 */
export type InferRow<TDefinition> =
  TDefinition extends TableDefinition<string, infer TColumns>
    ? { -readonly [K in keyof TColumns]: ValueOf<TColumns[K]> }
    : never;

/**
 * What an insert must supply.
 *
 * Nullable and defaulted columns become optional, because both have an answer
 * when the caller says nothing — which is exactly the distinction
 * `THasDefault` exists to carry.
 */
export type InferInsert<TDefinition> =
  TDefinition extends TableDefinition<string, infer TColumns>
    ? {
        -readonly [K in Exclude<
          keyof TColumns,
          OptionalInsertKeys<TColumns>
        >]: ValueOf<TColumns[K]>;
      } & {
        -readonly [K in OptionalInsertKeys<TColumns>]?: ValueOf<TColumns[K]>;
      }
    : never;

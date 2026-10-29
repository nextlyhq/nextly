/**
 * The one rule that judges an entity's address: the slug of a collection, a
 * Single or a field group.
 *
 * Every road that creates or changes an address asks this module — a Builder
 * save, the field-group Direct API, configuration at start, `migrate:check` and
 * `migrate:create` — so an address one road writes is never one another road
 * refuses. The rule refuses an address that collides with a route, a system
 * resource or table, or a reserved SQL word, or from which a table the entity
 * needs would pass the databases' limit on a name, and it accepts a hyphen: the
 * table is named from the address's snake_case form.
 *
 * Only a NEW or CHANGED address is judged. An entity that already exists under
 * an address the rule refuses keeps working; each road decides which addresses
 * are new, since only the road knows what already exists.
 *
 * @module shared/address-rule
 */

import { z } from "zod";

import {
  identifierBytes,
  MAX_INDEX_NAME_LENGTH,
} from "../domains/schema/services/index-name";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
import {
  normalizeIdentifier,
  resolveSingleTableName,
} from "../domains/singles/services/resolve-single-table-name";
import { NextlyError } from "../errors/nextly-error";
import {
  isReservedResourceSlug,
  NEWLY_RESERVED_SLUG_NOTES,
} from "../schemas/_zod/rbac";
import { STORAGE_FORMAT } from "../schemas/storage-format";

import { SLUG_PATTERN } from "./slug-pattern";
import {
  BUILDER_RESERVED_COLLECTION_NAMES,
  BUILDER_SQL_KEYWORDS,
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "./sql-reserved";

/** The entity kinds that have an address. */
export type AddressKind = "collection" | "single" | "fieldGroup";

/** A used address, as the snake_case check compares them. */
export interface UsedAddress {
  kind: AddressKind;
  address: string;
}

/** Why the rule refuses an address. The codes the configuration validators already report. */
export type AddressRefusalCode =
  | "SLUG_REQUIRED"
  | "SLUG_INVALID_TYPE"
  | "SLUG_INVALID_FORMAT"
  | "SLUG_TOO_LONG"
  | "SLUG_RESERVED"
  | "SLUG_SQL_KEYWORD"
  | "SLUG_SAME_SNAKE_CASE";

/** A refusal, naming the address and the reason. */
export interface AddressRefusal {
  code: AddressRefusalCode;
  message: string;
  /**
   * Whether configuration in code accepted this address before the one rule,
   * so an entity configured under it may already exist. A road that cannot
   * tell a new address from an existing one (a `define*` call, which runs
   * before anything is read) leaves such a refusal to the roads that can.
   */
  mayAlreadyExist: boolean;
}

/**
 * Longest address the product accepts, for every kind. A kind whose tables
 * need a longer name than the address is held lower by the name limit below.
 */
export const MAX_SLUG_LENGTH = 50;

/**
 * Addresses a field group may not take beyond the shared list: the API's own
 * route segment, which an address would be indistinguishable from in a URL.
 */
export const FIELD_GROUP_ROUTE_SLUGS = ["field-groups", "field-group"] as const;

const LABELS: Record<AddressKind, string> = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
};

const ROUTE_AND_TABLE_NAMES: Record<AddressKind, ReadonlySet<string>> = {
  collection: new Set<string>([
    ...RESERVED_SLUGS,
    ...BUILDER_RESERVED_COLLECTION_NAMES,
  ]),
  single: new Set<string>(RESERVED_SLUGS),
  fieldGroup: new Set<string>([...RESERVED_SLUGS, ...FIELD_GROUP_ROUTE_SLUGS]),
};

// What configuration refused before this rule, for `mayAlreadyExist`.
const CONFIG_ROUTE_AND_TABLE_NAMES: Record<AddressKind, ReadonlySet<string>> = {
  collection: new Set<string>(RESERVED_SLUGS),
  single: new Set<string>(RESERVED_SLUGS),
  fieldGroup: ROUTE_AND_TABLE_NAMES.fieldGroup,
};

const CONFIG_SQL_KEYWORDS: ReadonlySet<string> = new Set<string>(
  SQL_RESERVED_KEYWORDS
);
const SQL_KEYWORDS: ReadonlySet<string> = new Set<string>([
  ...SQL_RESERVED_KEYWORDS,
  ...BUILDER_SQL_KEYWORDS,
]);

/**
 * The names a kind's storage needs whose length grows with the address: the
 * table and its localization companion, and for a field group the index every
 * one of its tables carries (`idx_comp_<address>_parent`).
 */
function namesTheAddressNeeds(kind: AddressKind, address: string): string[] {
  const suffix = STORAGE_FORMAT.companionSuffix;
  if (kind === "collection") {
    const table = resolveCollectionTableName(address);
    return [table, `${table}${suffix}`];
  }
  if (kind === "single") {
    const table = resolveSingleTableName({ slug: address });
    return [table, `${table}${suffix}`];
  }
  const table = resolveComponentTableName(address);
  return [
    table,
    `${table}${suffix}`,
    `${STORAGE_FORMAT.indexPrefix}${table}_parent`,
  ];
}

/**
 * Every refusal of an address, in the order a road reports the first one. The
 * checks that configuration never made sit last, so a road that defers them
 * still meets every refusal it made before in the same order.
 */
function* refusals(
  kind: AddressKind,
  address: unknown
): Generator<AddressRefusal> {
  const label = LABELS[kind];
  const refuse = (
    code: AddressRefusalCode,
    message: string,
    mayAlreadyExist = false
  ): AddressRefusal => ({ code, message, mayAlreadyExist });

  if (address === undefined || address === null || address === "") {
    yield refuse("SLUG_REQUIRED", `${label} address is required`);
    return;
  }
  if (typeof address !== "string") {
    yield refuse("SLUG_INVALID_TYPE", `${label} address must be a string`);
    return;
  }
  if (!SLUG_PATTERN.test(address)) {
    yield refuse(
      "SLUG_INVALID_FORMAT",
      `${label} address '${address}' must start with a lowercase letter and contain only lowercase letters, numbers, hyphens and underscores`
    );
  }
  if (address.length > MAX_SLUG_LENGTH) {
    yield refuse(
      "SLUG_TOO_LONG",
      `${label} address '${address}' is ${address.length} characters; the longest allowed is ${MAX_SLUG_LENGTH}`
    );
  }

  const lower = address.toLowerCase();
  // A collection or Single seeds `read-<address>` and the rest under its
  // address, so one named after a system resource would share the rows that
  // resource's routes check. A field group seeds no permission.
  if (kind !== "fieldGroup" && isReservedResourceSlug(lower)) {
    const note = NEWLY_RESERVED_SLUG_NOTES.get(lower);
    yield refuse(
      "SLUG_RESERVED",
      `${label} address '${address}' is reserved: it names a Nextly system resource, whose permissions the ${label.toLowerCase()} would share` +
        (note === undefined ? "" : `. ${note}`)
    );
  } else if (ROUTE_AND_TABLE_NAMES[kind].has(lower)) {
    yield refuse(
      "SLUG_RESERVED",
      `${label} address '${address}' is reserved: Nextly uses it for a route or a system table`,
      !CONFIG_ROUTE_AND_TABLE_NAMES[kind].has(lower)
    );
  }
  // `<prefix><address>_locales` would read as another entity's localization
  // companion. Normalised as table names are, so `posts-locales` is caught.
  if (
    lower.replace(/[^a-z0-9]+/g, "_").endsWith(STORAGE_FORMAT.companionSuffix)
  ) {
    yield refuse(
      "SLUG_RESERVED",
      `${label} address '${address}' cannot end in '${STORAGE_FORMAT.companionSuffix}': that suffix names a localization table`
    );
  }
  if (SQL_KEYWORDS.has(lower)) {
    yield refuse(
      "SLUG_SQL_KEYWORD",
      `${label} address '${address}' is a reserved SQL word`,
      !CONFIG_SQL_KEYWORDS.has(lower)
    );
  }
  // A repeated or trailing separator is written differently by each road's
  // table naming (`posts-` is `dc_posts_` from one and `dc_posts` from
  // another), so only an address without one names the same table everywhere.
  if (SLUG_PATTERN.test(address) && /[-_]{2,}|[-_]$/.test(address)) {
    yield refuse(
      "SLUG_INVALID_FORMAT",
      `${label} address '${address}' must not repeat '-' or '_', nor end with one`,
      true
    );
  }
  // PostgreSQL silently truncates a name past 63 bytes and MySQL refuses one
  // past 64, so the tighter limit holds for every name the address leads to.
  // Judged only within the product's own bound, which configuration applied.
  if (address.length <= MAX_SLUG_LENGTH) {
    const over = namesTheAddressNeeds(kind, address).find(
      n => identifierBytes(n) > MAX_INDEX_NAME_LENGTH
    );
    if (over !== undefined) {
      yield refuse(
        "SLUG_TOO_LONG",
        `${label} address '${address}' is too long for its tables: '${over}' would be ${identifierBytes(over)} characters, past the ${MAX_INDEX_NAME_LENGTH} a database name may have`,
        true
      );
    }
  }
}

/** The rule's verdict on a new or changed address: its first refusal, or `null`. */
export function judgeAddress(
  kind: AddressKind,
  address: unknown
): AddressRefusal | null {
  for (const refusal of refusals(kind, address)) return refusal;
  return null;
}

/**
 * The verdict for configuration in code, judged where nothing says whether an
 * entity already exists under the address: the rule's first refusal that
 * configuration made before the rule. The rest are judged at start and by the
 * migrate commands, which know what exists.
 */
export function judgeConfiguredAddress(
  kind: AddressKind,
  address: unknown
): AddressRefusal | null {
  for (const refusal of refusals(kind, address)) {
    if (!refusal.mayAlreadyExist) return refusal;
  }
  return null;
}

/**
 * The address's snake_case form, which two addresses are compared by: each run
 * of `-` and `_` written as one underscore, with none at the end. It is the
 * form a Single's and a field group's table name is derived from
 * (`normalizeIdentifier`), so two addresses with one form need one table there;
 * for an address with no repeated or trailing separator it is the address
 * with each hyphen written as an underscore, which a collection's table uses.
 */
export function addressSnakeForm(address: string): string {
  return normalizeIdentifier(address);
}

/**
 * Whether a used address must differ from one of `kind`: a collection's or
 * Single's from every collection's and Single's, a field group's from every
 * other field group's.
 */
function sharesNamespace(kind: AddressKind, other: AddressKind): boolean {
  return (kind === "fieldGroup") === (other === "fieldGroup");
}

/**
 * Refuses a new or changed address whose snake_case form is that of a
 * different address already used where the two must differ, naming both and
 * the form they share. The exact same address is left to the check that an
 * address is taken.
 */
export function findSameSnakeCaseAddress(
  kind: AddressKind,
  address: string,
  used: Iterable<UsedAddress>,
  /**
   * Whether the refusal may name the kind. A caller that knows only the
   * namespace (a collection's or Single's) says so, and the refusal names the
   * address alone.
   */
  options: { kindKnown?: boolean } = {}
): AddressRefusal | null {
  const form = addressSnakeForm(address);
  const label = options.kindKnown === false ? "The" : `${LABELS[kind]}`;
  for (const other of used) {
    if (
      other.address !== address &&
      sharesNamespace(kind, other.kind) &&
      addressSnakeForm(other.address) === form
    ) {
      return {
        code: "SLUG_SAME_SNAKE_CASE",
        message: `${label} address '${address}' has the snake_case form '${form}', which the ${LABELS[other.kind].toLowerCase()} '${other.address}' already has; two addresses that differ only by '-' and '_' would read as one`,
        mayAlreadyExist: false,
      };
    }
  }
  return null;
}

/** An entity's address as a road judges it, with whether the road found it new. */
export interface AddressedEntity extends UsedAddress {
  /** New or changed on this road; `false` for an address the entity already had. */
  isNew: boolean;
}

/** An entity and the rule's refusal of its address. */
export interface JudgedAddress {
  entity: AddressedEntity;
  refusal: AddressRefusal;
}

/**
 * Judges a road's entities at once: each new address by the rule and against
 * every other address used (the road's own and `alsoUsed`), refused; each
 * existing address the rule refuses, kept and reported, so the road can warn
 * once without refusing an entity that already works.
 */
export function judgeAddresses(
  entities: readonly AddressedEntity[],
  alsoUsed: readonly UsedAddress[] = []
): { refused: JudgedAddress[]; existing: JudgedAddress[] } {
  const refused: JudgedAddress[] = [];
  const existing: JudgedAddress[] = [];
  for (const entity of entities) {
    const verdict = judgeAddress(entity.kind, entity.address);
    if (!entity.isNew) {
      if (verdict) existing.push({ entity, refusal: verdict });
      continue;
    }
    const refusal =
      verdict ??
      findSameSnakeCaseAddress(entity.kind, entity.address, [
        ...entities.filter(other => other !== entity),
        ...alsoUsed,
      ]);
    if (refusal) refused.push({ entity, refusal });
  }
  return { refused, existing };
}

/** A refusal as the error every road throws: a validation error on `slug`. */
export function addressRefusalError(
  refusal: AddressRefusal,
  address?: unknown
): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "slug", code: refusal.code, message: refusal.message }],
    logContext: { reason: "address-rule", code: refusal.code, address },
  });
}

/** Several roads' refusals as one validation error, one entry per address. */
export function addressRefusalsError(
  refused: readonly JudgedAddress[]
): NextlyError {
  return NextlyError.validation({
    errors: refused.map(({ refusal }) => ({
      path: "slug",
      code: refusal.code,
      message: refusal.message,
    })),
    logContext: {
      reason: "address-rule",
      refused: refused.map(({ entity }) => `${entity.kind}:${entity.address}`),
    },
  });
}

/** Throws the rule's refusal of a new or changed address, if it has one. */
export function assertAddressAllowed(
  kind: AddressKind,
  address: unknown
): void {
  const refusal = judgeAddress(kind, address);
  if (refusal) throw addressRefusalError(refusal, address);
}

type Slugged = ReadonlyArray<{ slug: string; dbName?: string }>;
type Registered = ReadonlyArray<{ slug: string; tableName?: string }>;

/** The table a configured entity is stored in, as each kind's resolver names it. */
function configuredTable(
  kind: AddressKind,
  entity: { slug: string; dbName?: string }
): string {
  if (kind === "collection") {
    return resolveCollectionTableName(entity.slug, entity.dbName);
  }
  if (kind === "single") {
    return resolveSingleTableName({ slug: entity.slug, dbName: entity.dbName });
  }
  return resolveComponentTableName(entity.slug);
}

/**
 * The addresses in configuration in code the rule refuses, as a start or a
 * configuration reload judges them, before either writes anything, so a
 * refused configuration leaves the registries and tables as they were.
 *
 * An entity a registry row holds exists and keeps its address. One no row
 * holds is new and judged by the whole rule and against every address used,
 * unless its table already exists and no registry row owns it: then an earlier
 * start or `nextly migrate` made it (a new environment migrated before its
 * first start, or a registry read that answered nothing), and it keeps its
 * address too. The tables are asked about only for an address the rule would
 * refuse.
 */
export async function refusedConfiguredAddresses(
  config: {
    collections?: Slugged;
    singles?: Slugged;
    fieldGroups?: Slugged;
  },
  registered: {
    collections: Registered;
    singles: Registered;
    components: Registered;
  },
  tableExists: (table: string) => Promise<boolean>
): Promise<JudgedAddress[]> {
  const configured: Array<[AddressKind, Slugged, Registered]> = [
    ["collection", config.collections ?? [], registered.collections],
    ["single", config.singles ?? [], registered.singles],
    ["fieldGroup", config.fieldGroups ?? [], registered.components],
  ];
  // A table a registry row owns is that entity's, so finding it says nothing about a
  // configured entity of another address having been made (a same-form twin names it too).
  const ownedTables = new Set(
    configured.flatMap(([, , rows]) =>
      rows.flatMap(row => (row.tableName === undefined ? [] : [row.tableName]))
    )
  );
  const entities: AddressedEntity[] = [];
  const tables = new Map<AddressedEntity, string>();
  const used: UsedAddress[] = [];
  for (const [kind, declared, rows] of configured) {
    const held = new Set(rows.map(row => row.slug));
    const declaredSlugs = new Set(declared.map(entity => entity.slug));
    for (const entity of declared) {
      const addressed = {
        kind,
        address: entity.slug,
        isNew: !held.has(entity.slug),
      };
      entities.push(addressed);
      tables.set(addressed, configuredTable(kind, entity));
    }
    for (const { slug } of rows) {
      if (!declaredSlugs.has(slug)) used.push({ kind, address: slug });
    }
  }
  const refused: JudgedAddress[] = [];
  for (const judged of judgeAddresses(entities, used).refused) {
    const table = tables.get(judged.entity);
    if (
      table === undefined ||
      ownedTables.has(table) ||
      !(await tableExists(table))
    ) {
      refused.push(judged);
    }
  }
  return refused;
}

/**
 * The start's check: throws the refusals {@link refusedConfiguredAddresses}
 * finds, one validation error naming each address and its reason.
 */
export async function assertConfiguredAddresses(
  ...args: Parameters<typeof refusedConfiguredAddresses>
): Promise<void> {
  const refused = await refusedConfiguredAddresses(...args);
  if (refused.length > 0) throw addressRefusalsError(refused);
}

/**
 * The rule as a zod string schema, for a road that parses its input with zod:
 * an address the rule refuses fails with the refusal's message.
 */
export function addressSchema(kind: AddressKind): z.ZodType<string> {
  return z.string().superRefine((address, ctx) => {
    const refusal = judgeAddress(kind, address);
    if (refusal) ctx.addIssue({ code: "custom", message: refusal.message });
  });
}

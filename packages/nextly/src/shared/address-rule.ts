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

import {
  identifierBytes,
  MAX_INDEX_NAME_LENGTH,
} from "../domains/schema/services/index-name";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../domains/singles/services/resolve-single-table-name";
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

/** The address's snake_case form, which names its table: each hyphen written as an underscore. */
export function addressSnakeForm(address: string): string {
  return address.replace(/-/g, "_");
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
  used: Iterable<UsedAddress>
): AddressRefusal | null {
  const form = addressSnakeForm(address);
  for (const other of used) {
    if (
      other.address !== address &&
      sharesNamespace(kind, other.kind) &&
      addressSnakeForm(other.address) === form
    ) {
      return {
        code: "SLUG_SAME_SNAKE_CASE",
        message: `${LABELS[kind]} address '${address}' has the snake_case form '${form}', which the ${LABELS[other.kind].toLowerCase()} '${other.address}' already has; two addresses that differ only by '-' and '_' would read as one`,
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

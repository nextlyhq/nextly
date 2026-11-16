/**
 * The one rule for sibling fields: two fields directly inside one container
 * (an entity's top level, one group, one repeater, or a field group's own top
 * level) may not have the same name, names that differ only in letter case, or
 * names that become the same column (`fooBar` and `foo_bar`). The column is what
 * the database refuses, and MySQL and SQLite compare column names without regard
 * to case, so only a rule that compares all three refuses every clash before a
 * statement runs rather than at it.
 *
 * Only a NEW pair is refused: one the definition the entity last had, where the
 * pair is judged, does not hold. An entity that already holds such a pair keeps
 * working, since its two fields read and write one stored value and refusing it
 * would stop a site that works today; the migrate check warns about it instead.
 * Each road decides what the previous definition is, since only the road knows:
 * the registry row for a save or a start, the latest snapshot for the migrate
 * commands, none for an entity the change creates.
 *
 * @module domains/schema/sibling-fields
 */

import { NextlyError } from "../../errors/nextly-error";
import { configuredTable } from "../../shared/address-rule";

import { siblingNameClash, type SiblingClashKind } from "./field-rules";
import {
  fieldProducesColumn,
  toSnakeCase,
} from "./services/field-column-descriptor";

// The comparison itself is the browser-safe field rules', which the Builder
// applies too; the kind is re-exported for this module's callers.
export type { SiblingClashKind } from "./field-rules";

/** A pair of sibling fields the rule refuses. */
export interface SiblingClash {
  /** The container, as a refusal names it: `the top level`, `group 'seo'`, `repeater 'seo.links'`. */
  container: string;
  /** The names of the groups and repeaters that lead to the container; empty at the top level. */
  path: string[];
  /** The first field of the pair, in declaration order, and the second. */
  first: string;
  second: string;
  kind: SiblingClashKind;
  /**
   * The stored value both fields read and write, where they share one: at the
   * top level the column both become (both must have a column), inside a group
   * or a repeater the key of its value, which only one exact name shares.
   */
  shared: { column: string } | { key: string } | null;
}

/** The entity kinds whose fields the rule judges. */
export type SiblingEntityKind = "collection" | "single" | "fieldGroup";

/** The entity a road judges, as a refusal or a warning names it. */
export interface SiblingEntity {
  kind: SiblingEntityKind;
  slug: string;
}

type NamedField = Record<string, unknown> & {
  name: string;
  type?: unknown;
  options?: unknown;
  virtual?: unknown;
};

const LABELS: Record<SiblingEntityKind, string> = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
};

/** The only field types whose own `fields` are a container of sibling fields. */
const CONTAINER_TYPES = new Set(["group", "repeater"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The named fields directly inside one container. A layout container (a field
 * with no name, such as a row) holds no value: its children are stored on the
 * level that holds it, so they are siblings of that level's fields. `open`
 * holds the layout containers on this path, so one that reaches itself ends.
 */
function namedFieldsOf(
  fields: readonly unknown[],
  open: WeakSet<object>
): NamedField[] {
  const out: NamedField[] = [];
  for (const field of fields) {
    if (!isRecord(field)) continue;
    if (typeof field.name === "string" && field.name !== "") {
      out.push(field as NamedField);
    } else if (Array.isArray(field.fields) && !open.has(field)) {
      open.add(field);
      out.push(...namedFieldsOf(field.fields, open));
      open.delete(field);
    }
  }
  return out;
}

function sharedValue(
  a: NamedField,
  b: NamedField,
  topLevel: boolean
): SiblingClash["shared"] {
  if (!topLevel) return a.name === b.name ? { key: a.name } : null;
  const column = toSnakeCase(a.name);
  return column === toSnakeCase(b.name) &&
    fieldProducesColumn(a) &&
    fieldProducesColumn(b)
    ? { column }
    : null;
}

/**
 * The system fields `define*` adds at a collection's and a Single's top level
 * (`title`, `slug`). Each is added only when no declared field takes its
 * column, so one beside a declared sibling that shares no stored value or key
 * with it (a column-less `Title`, a `TITLE` whose column is `t_i_t_l_e`) is a
 * pair the author never wrote, and the definition stands as `define*` accepted
 * it, a sibling of the exact same name included. Only `define*` output gets this
 * (`SiblingJudgeOptions.definedInCode`); a road that writes fields as it was
 * sent judges a system name like any other.
 */
const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set(["title", "slug"]);

/** A field shaped as `define*` adds one: a system name, with a column of its own. */
function isSystemShaped(field: NamedField): boolean {
  return SYSTEM_FIELD_NAMES.has(field.name) && fieldProducesColumn(field);
}

/**
 * The pairs one of whose fields is shaped as an added system field, recorded
 * while the walk still holds the fields. Two column-less fields of a system
 * name are not among them: neither is the field `define*` adds.
 */
const SYSTEM_SHAPED_PAIRS = new WeakSet<SiblingClash>();

function containerLabel(path: readonly string[], type: string): string {
  return path.length === 0 ? "the top level" : `${type} '${path.join(".")}'`;
}

function walk(
  fields: readonly unknown[],
  path: string[],
  type: string,
  out: SiblingClash[],
  open: WeakSet<object>
): void {
  const named = namedFieldsOf(fields, open);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const kind = siblingNameClash(named[i].name, named[j].name);
      if (kind === null) continue;
      const clash: SiblingClash = {
        container: containerLabel(path, type),
        path,
        first: named[i].name,
        second: named[j].name,
        kind,
        shared: sharedValue(named[i], named[j], path.length === 0),
      };
      if (isSystemShaped(named[i]) || isSystemShaped(named[j])) {
        SYSTEM_SHAPED_PAIRS.add(clash);
      }
      out.push(clash);
    }
  }
  for (const field of named) {
    if (
      typeof field.type === "string" &&
      CONTAINER_TYPES.has(field.type) &&
      Array.isArray(field.fields) &&
      !open.has(field)
    ) {
      open.add(field);
      walk(field.fields, [...path, field.name], field.type, out, open);
      open.delete(field);
    }
  }
}

/** Every pair of sibling fields the rule refuses, at every level, in declaration order. */
export function siblingClashes(fields: unknown): SiblingClash[] {
  const out: SiblingClash[] = [];
  if (Array.isArray(fields)) walk(fields, [], "", out, new WeakSet());
  return out;
}

/** A pair's identity: its container and its two names, in either order. */
function pairKey(clash: SiblingClash): string {
  const names = [clash.first, clash.second].sort();
  return JSON.stringify([clash.path, names]);
}

/** Whether two stored values are the same one: the same column, or the same key. */
function sameShared(a: SiblingClash["shared"], b: SiblingClash["shared"]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSystemFieldStandingAside(
  definedInCode: SiblingEntityKind | undefined,
  clash: SiblingClash
): boolean {
  return (
    (definedInCode === "collection" || definedInCode === "single") &&
    clash.path.length === 0 &&
    clash.shared === null &&
    SYSTEM_SHAPED_PAIRS.has(clash)
  );
}

/** How a road judges sibling fields. */
export interface SiblingJudgeOptions {
  /**
   * The kind of entity whose `define*` output the fields are. Only `define*` adds `title` and
   * `slug` itself, and it refuses two declared fields equal ignoring case before it adds them, so
   * only on a road that judges its output can such a pair be one the author never wrote. Every
   * other road leaves it unset, and a system-named pair is judged there like any other.
   */
  definedInCode?: SiblingEntityKind;
}

/**
 * Judges the pairs of `next` against the definition the entity last had:
 * `refused`, the pairs `previous` does not hold in the same container, which a
 * change creates whether a field was added, renamed, moved or copied into one;
 * `existing`, the pairs it already held. `previous` is `null` for an entity the
 * change creates, so every pair in it is new.
 *
 * A held pair stays existing only as often as `previous` held it (a third copy
 * of a name already held twice makes new pairs) and only while it shares no
 * stored value it did not share before: a pair whose type change makes both
 * fields one column is new, since that column is what the database refuses.
 * With `options.definedInCode` (only for `define*` output), a system field
 * standing aside for a sibling is not judged.
 */
export function judgeSiblingFields(
  next: unknown,
  previous: unknown,
  options: SiblingJudgeOptions = {}
): { refused: SiblingClash[]; existing: SiblingClash[] } {
  const clashes = siblingClashes(next).filter(
    clash => !isSystemFieldStandingAside(options.definedInCode, clash)
  );
  if (previous === null) return { refused: clashes, existing: [] };
  const held = new Map<string, SiblingClash[]>();
  for (const clash of siblingClashes(previous)) {
    const key = pairKey(clash);
    held.set(key, [...(held.get(key) ?? []), clash]);
  }
  const refused: SiblingClash[] = [];
  const existing: SiblingClash[] = [];
  for (const clash of clashes) {
    const candidates = held.get(pairKey(clash)) ?? [];
    const match = candidates.findIndex(
      before => clash.shared === null || sameShared(before.shared, clash.shared)
    );
    if (match === -1) {
      refused.push(clash);
      continue;
    }
    candidates.splice(match, 1);
    existing.push(clash);
  }
  return { refused, existing };
}

/** The pairs a change creates: {@link judgeSiblingFields}'s `refused`. */
export function newSiblingClashes(
  next: unknown,
  previous: unknown,
  options: SiblingJudgeOptions = {}
): SiblingClash[] {
  return judgeSiblingFields(next, previous, options).refused;
}

/**
 * Whether configuration in code accepted the pair before this rule, so an
 * entity configured with it may already exist. It refused two names at one
 * level that differ only in case, and two fields with a column at a
 * collection's or a Single's top level that become one column.
 */
function mayAlreadyExist(
  kind: SiblingEntityKind,
  clash: SiblingClash
): boolean {
  if (clash.kind !== "same-column") return false;
  return !(
    kind !== "fieldGroup" &&
    clash.shared !== null &&
    "column" in clash.shared
  );
}

/**
 * The pairs a `define*` call refuses, where nothing says whether the entity
 * already exists: those configuration refused before this rule, which no
 * existing entity can hold. The rest are judged at start and by the migrate
 * commands, which know the previous definition.
 */
export function configuredSiblingClashes(
  kind: SiblingEntityKind,
  fields: unknown
): SiblingClash[] {
  return siblingClashes(fields).filter(clash => !mayAlreadyExist(kind, clash));
}

function pairPhrase(entity: SiblingEntity, clash: SiblingClash): string {
  const where =
    clash.path.length === 0 ? "at the top level" : `in ${clash.container}`;
  return `${LABELS[entity.kind]} '${entity.slug}': fields '${clash.first}' and '${clash.second}' ${where}`;
}

const REFUSAL_REASONS: Record<
  SiblingClashKind,
  (clash: SiblingClash) => string
> = {
  "same-name": () => "have the same name",
  "same-name-ignoring-case": () => "differ only in letter case",
  "same-column": clash =>
    `would both become the column '${toSnakeCase(clash.first)}'`,
};

/** The sentence a refusal of one new pair says. */
export function siblingClashMessage(
  entity: SiblingEntity,
  clash: SiblingClash
): string {
  return `${pairPhrase(entity, clash)} ${REFUSAL_REASONS[clash.kind](clash)}. Rename one of them.`;
}

/**
 * The refusal every road throws for the new pairs it found: a validation
 * error on `fields`, one entry per pair, each naming the entity, the container
 * and both fields.
 */
export function siblingClashesError(
  entity: SiblingEntity,
  clashes: readonly SiblingClash[]
): NextlyError {
  return siblingClashesErrorFor(clashes.map(clash => ({ entity, clash })));
}

/** One entity's new pairs, as a road that judges several entities reports them. */
export interface EntitySiblingClash {
  entity: SiblingEntity;
  clash: SiblingClash;
}

/** The refusal for several entities' new pairs at once (a start, a migrate command). */
export function siblingClashesErrorFor(
  refused: readonly EntitySiblingClash[]
): NextlyError {
  const messages = refused.map(({ entity, clash }) =>
    siblingClashMessage(entity, clash)
  );
  return NextlyError.validation({
    errors: messages.map(message => ({
      path: "fields",
      code: "FIELD_NAME_DUPLICATE",
      message,
    })),
    logContext: { reason: "sibling-fields", refusals: messages },
  });
}

/**
 * The warning for a pair an entity already holds: it keeps working, and the
 * warning names the stored value the two share, where they share one, and says
 * to rename one.
 */
export function siblingClashWarning(
  entity: SiblingEntity,
  clash: SiblingClash
): string {
  const phrase = pairPhrase(entity, clash);
  if (clash.shared === null) {
    return `${phrase} ${REFUSAL_REASONS[clash.kind](clash)}. They keep working; rename one of them.`;
  }
  const value =
    "column" in clash.shared
      ? `the column '${clash.shared.column}'`
      : `the key '${clash.shared.key}'`;
  return `${phrase} already share ${value}. They keep working; rename one of them so each keeps its own value.`;
}

/** Throws the refusal of the pairs `next` creates against `previous` (`null` for a new entity). */
export function assertNoNewSiblingClashes(
  entity: SiblingEntity,
  next: unknown,
  previous: unknown,
  options: SiblingJudgeOptions = {}
): void {
  // Unless the caller says the fields are `define*` output, nothing in them was added by `define*`.
  const clashes = newSiblingClashes(next, previous, options);
  if (clashes.length > 0) throw siblingClashesError(entity, clashes);
}

type Configured = ReadonlyArray<{
  slug: string;
  dbName?: string;
  fields?: readonly unknown[];
}>;
type Registered = ReadonlyArray<{
  slug: string;
  tableName?: string;
  fields: readonly unknown[];
}>;

/**
 * The new pairs in configuration in code, as a start or a configuration
 * reload judges them, before either writes anything, so a refused
 * configuration leaves the registries and tables as they were.
 *
 * The registry row of an entity is the definition it last had, so a pair the
 * row holds already exists and keeps working. An entity no row holds is new,
 * and so is every pair in it, unless its table already exists and no registry
 * row owns it: then an earlier start or `nextly migrate` made it (a new
 * environment migrated before its first start, or a row that could not be
 * read), and it is taken as it is. The tables are asked about only for an
 * entity that has a new pair.
 */
export async function refusedConfiguredSiblingFields(
  config: {
    collections?: Configured;
    singles?: Configured;
    fieldGroups?: Configured;
  },
  registered: {
    collections: Registered;
    singles: Registered;
    components: Registered;
  },
  tableExists: (table: string) => Promise<boolean>
): Promise<EntitySiblingClash[]> {
  const configured: Array<[SiblingEntityKind, Configured, Registered]> = [
    ["collection", config.collections ?? [], registered.collections],
    ["single", config.singles ?? [], registered.singles],
    ["fieldGroup", config.fieldGroups ?? [], registered.components],
  ];
  const ownedTables = new Set(
    configured.flatMap(([, , rows]) =>
      rows.flatMap(row => (row.tableName === undefined ? [] : [row.tableName]))
    )
  );
  const refused: EntitySiblingClash[] = [];
  for (const [kind, declared, rows] of configured) {
    const bySlug = new Map(rows.map(row => [row.slug, row]));
    for (const entry of declared) {
      const row = bySlug.get(entry.slug);
      const clashes = newSiblingClashes(
        entry.fields ?? [],
        row?.fields ?? null,
        { definedInCode: kind }
      );
      if (clashes.length === 0) continue;
      if (row === undefined) {
        const table = configuredTable(kind, entry);
        if (!ownedTables.has(table) && (await tableExists(table))) continue;
      }
      const entity = { kind, slug: entry.slug };
      for (const clash of clashes) refused.push({ entity, clash });
    }
  }
  return refused;
}

/**
 * The start's check: throws the refusals {@link refusedConfiguredSiblingFields}
 * finds, one validation error naming each pair.
 */
export async function assertConfiguredSiblingFields(
  ...args: Parameters<typeof refusedConfiguredSiblingFields>
): Promise<void> {
  const refused = await refusedConfiguredSiblingFields(...args);
  if (refused.length > 0) throw siblingClashesErrorFor(refused);
}

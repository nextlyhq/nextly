/**
 * What a widget may read FROM.
 *
 * A source is addressed by a stable string id -- `collection:posts`,
 * `system:users`, `plugin:stripe/revenue` -- and declares the fields and
 * operations it exposes. A widget query names a source id and declared field
 * names; it never names a table or a column, which is what keeps caller input
 * away from the compiler.
 *
 * Validation lives at registration, the same pattern `registry.ts` applies to
 * a widget definition through `registerWidget`/`validateWidgetDefinition`: a
 * malformed source fails loudly at boot rather than quietly admitting, say, an
 * empty `fields` list that would make every query against it fail "undeclared
 * field" for every field name a caller could possibly send.
 *
 * @module domains/widgets/sources
 */

import { NextlyError } from "../../errors/nextly-error";

import { detachedSnapshot } from "./detached-snapshot";

export const WIDGET_OPS = ["count", "list", "groupBy", "timeseries"] as const;
export type WidgetOp = (typeof WIDGET_OPS)[number];

export const WIDGET_SOURCE_KINDS = [
  "collection",
  "single",
  "system",
  "plugin",
] as const;
export type WidgetSourceKind = (typeof WIDGET_SOURCE_KINDS)[number];

export const WIDGET_SOURCE_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
] as const;
export type WidgetSourceFieldType = (typeof WIDGET_SOURCE_FIELD_TYPES)[number];

export interface WidgetSourceField {
  name: string;
  type: WidgetSourceFieldType;
  /**
   * What a human calls this field, when the source knows.
   *
   * A widget that draws a TABLE needs a column heading, and the only honest
   * one is the label the field already carries -- the same string the entry
   * form puts above it. Without this the admin has nothing but the storage
   * name, so a column reads `publishedAt`, and the alternatives are both
   * worse: deriving prose from an identifier guesses at capitalisation and
   * word breaks it cannot know, and asking the widget author to declare
   * headings puts a second answer beside `select`, free to disagree with it.
   *
   * Optional because a source is not obliged to have one. A field declared
   * without a label, and every field of a source that is not a collection,
   * simply says nothing here and the admin falls back to the name.
   */
  label?: string;
}

export interface WidgetSource {
  /** e.g. "collection:posts", "system:users", "plugin:stripe/revenue". */
  id: string;
  /**
   * Which of this source's fields NAMES a row, when one does.
   *
   * Resolved where the source is built, because that is the only place holding
   * both halves of the answer: the author's `admin.useAsTitle` and the full
   * field list it has to exist in. A consumer that resolved it again from
   * `fields` alone would ignore the author's nomination and pick a conventional
   * name instead -- so a collection whose author chose `headline` would have its
   * dashboard card labelled by something else, or no card at all.
   *
   * Absent when nothing names the rows, which is a real answer: a source of pure
   * data rows has no title field, and a caller that invents one shows the reader
   * a column of identifiers.
   */
  titleField?: string;
  label: string;
  kind: WidgetSourceKind;
  /**
   * ADVISORY, and deliberately so: nothing reads it, and nothing should.
   *
   * It exists to tell a widget-configuration UI which sources are worth
   * OFFERING, so a picker can hide a collection the user cannot read instead
   * of listing one whose every query will be refused. It is not a gate: the
   * gate is `executeWidgetQuery`'s `overrideAccess: false` plus the caller,
   * which is the ordinary read path and answers with the row-level rules a
   * permission slug cannot see. Enforcing this here would be a SECOND access
   * implementation, and the two drifting apart is the failure this domain is
   * built to avoid -- Strapi's homepage widgets gated the card on a permission
   * while the query returned rows the viewer could not see.
   *
   * Spelled `read-<slug>`, the vocabulary the permission table and
   * `canReadEntity` use, and the one the same field name already carries on
   * `WidgetDefinition` and `PluginAdminWidget`. One field name, one spelling.
   */
  requiredPermission?: string;
  supports: readonly WidgetOp[];
  /** The only field names a query may reference. */
  fields: readonly WidgetSourceField[];
}

// A malformed widget source is a plugin/core author's mistake, not end-user
// input, so this uses `invalidInput` (developer-facing, safe to surface
// verbatim) -- mirrors `definition.ts`'s `fail`.
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget source: ${message}`,
  });
}

/** Confirms `id` is present and non-blank. */
function validateSourceId(s: Partial<WidgetSource>): void {
  if (typeof s.id !== "string" || s.id.trim() === "") {
    fail(`id is required and must be a non-empty string, got ${String(s.id)}`);
  }
}

/** Confirms `label` carries real, non-whitespace text. */
function validateSourceLabel(s: Partial<WidgetSource>): void {
  if (typeof s.label !== "string" || s.label.trim() === "") {
    fail(`${s.id}: label is required`);
  }
}

/**
 * The namespaces core OWNS, and the kind each one means.
 *
 * `plugin` is deliberately absent: it is what an id claiming no reserved
 * namespace resolves to, including one carrying no prefix at all, so listing it
 * would make `plugin:` a fourth reserved word for no gain.
 */
const RESERVED_NAMESPACE_KINDS: ReadonlyMap<string, WidgetSourceKind> = new Map(
  [
    ["collection", "collection"],
    ["single", "single"],
    ["system", "system"],
  ]
);

/**
 * The kind an id's namespace DECLARES -- the canonical identity, from which
 * `kind` is derived rather than stated a second time.
 *
 * `collection:posts` is a collection because of what it addresses, not because
 * something separately said so. Validating the two independently let them
 * disagree, and the disagreement was not cosmetic: `replaceSourcesOfKind`
 * preserves by KIND, so a `{ id: "collection:posts", kind: "plugin" }` source
 * survived a collection rebuild, collided with the real `collection:posts`
 * `registerSource` was publishing, and threw out of `refreshCollectionSources`
 * -- which runs once per batch, before any slot. One squatting plugin failed
 * every dashboard query request in the install.
 *
 * Exported so anything else needing this answer takes it from here rather than
 * re-deriving a prefix rule that would drift.
 */
export function sourceKindFromId(id: string): WidgetSourceKind {
  const separator = id.indexOf(":");
  if (separator === -1) return "plugin";
  return RESERVED_NAMESPACE_KINDS.get(id.slice(0, separator)) ?? "plugin";
}

/**
 * Confirms `kind` is a known value AND the one the id's namespace derives.
 *
 * The derived kind is not silently substituted for the declared one. A plugin
 * that wrote `kind: "plugin"` under `collection:` believes something false
 * about its source, and correcting it quietly leaves that belief in place --
 * this is a boot-time mistake by a plugin author, which is the case this whole
 * module fails loudly for.
 */
function validateSourceKind(s: Partial<WidgetSource>): void {
  if (!WIDGET_SOURCE_KINDS.includes(s.kind as WidgetSourceKind)) {
    fail(`${s.id}: kind must be one of ${WIDGET_SOURCE_KINDS.join(", ")}`);
  }
  const derived = sourceKindFromId(s.id as string);
  if (s.kind === derived) return;
  if (derived !== "plugin") {
    fail(
      `${s.id}: namespace "${derived}:" is reserved for kind "${derived}", ` +
        `not "${s.kind}"`
    );
  }
  fail(
    `${s.id}: kind "${s.kind}" requires the "${s.kind}:" namespace, ` +
      `so this id cannot carry it`
  );
}

/**
 * Confirms `supports` is a non-empty array of known ops. Empty `supports`
 * would register a source no query could ever validate against -- every
 * `validateWidgetQuery` call would fail at the op check, which is a startup
 * mistake worth catching here rather than at first use.
 */
function validateSourceSupports(s: Partial<WidgetSource>): void {
  if (!Array.isArray(s.supports) || s.supports.length === 0) {
    fail(`${s.id}: supports must be a non-empty array of ops`);
  }
  for (const op of s.supports as unknown[]) {
    if (!WIDGET_OPS.includes(op as WidgetOp)) {
      fail(`${s.id}: supports names an unknown op "${String(op)}"`);
    }
  }
}

/**
 * Confirms `fields` is a non-empty array of well-formed, uniquely-named
 * fields. A duplicate field name would make `validateWidgetQuery`'s
 * declared-field set silently collapse two fields into one entry, so it is
 * refused here rather than discovered later as a query that mysteriously
 * reads the wrong column.
 */
function validateSourceFields(s: Partial<WidgetSource>): void {
  if (!Array.isArray(s.fields) || s.fields.length === 0) {
    fail(`${s.id}: fields must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const raw of s.fields as unknown[]) {
    const field = raw as Partial<WidgetSourceField> | null | undefined;
    if (typeof field?.name !== "string" || field.name.trim() === "") {
      fail(`${s.id}: every field requires a non-empty name`);
    }
    if (
      !WIDGET_SOURCE_FIELD_TYPES.includes(field.type as WidgetSourceFieldType)
    ) {
      fail(
        `${s.id}: field "${field.name}" has an unknown type "${String(field.type)}"`
      );
    }
    if (seen.has(field.name)) {
      fail(`${s.id}: field "${field.name}" is declared more than once`);
    }
    // A label that is present but unusable is refused HERE, where every source
    // passes, rather than only on the path that builds one from a collection.
    // A plugin registering its own source through the SDK reaches the stored
    // snapshot untouched by that path, and `"   "` is legal TypeScript -- so
    // the empty column head this field exists to prevent arrived through the
    // one channel that had no normalisation. Refused rather than trimmed away,
    // because a blank label is a mistake in the plugin's config and silently
    // dropping it leaves the author wondering why their heading never appears.
    if (
      field.label !== undefined &&
      (typeof field.label !== "string" || field.label.trim() === "")
    ) {
      fail(
        `${s.id}: field "${field.name}" has a label that is empty or not a string`
      );
    }
    seen.add(field.name);
  }
}

/** Throws with a named reason if `source` is not a usable widget source. */
export function validateWidgetSource(
  source: unknown
): asserts source is WidgetSource {
  if (typeof source !== "object" || source === null) fail("expected an object");
  const s = source as Partial<WidgetSource>;

  validateSourceId(s);
  validateSourceLabel(s);
  validateSourceKind(s);
  validateSourceSupports(s);
  validateSourceFields(s);
}

const globalForSources = globalThis as unknown as {
  __nextly_widget_sources?: Map<string, WidgetSource>;
};

function store(): Map<string, WidgetSource> {
  globalForSources.__nextly_widget_sources ??= new Map();
  return globalForSources.__nextly_widget_sources;
}

/**
 * The value the store actually holds: a detached, frozen copy.
 *
 * Registration is the ONLY place `validateWidgetSource` runs, so a plugin
 * keeping the object it passed could edit `fields`, `supports`, `kind` or `id`
 * afterwards with nothing revalidating them -- and `fields` is the allowlist
 * `validateWidgetQuery` checks every `select`, `sort` and `where` against.
 * Appending one entry to it after boot admits a field the endpoint's gate was
 * never asked about.
 *
 * Shares `detachedSnapshot` with the widget REGISTRY rather than repeating its
 * clone-and-freeze: both stores answer the same question about the same kind of
 * value, and the reason each refuses is the only part that differs.
 */
function snapshot(source: WidgetSource): WidgetSource {
  return detachedSnapshot(source, () =>
    fail(
      `${source.id}: carries a value that cannot be stored. A widget source ` +
        `is data: functions, symbols and class instances are not part of it.`
    )
  );
}

/**
 * Validates `source` and returns the detached copy the store would hold,
 * refusing when `isTaken` says its id is already spoken for.
 *
 * Separated from the write so a caller replacing a whole KIND can prepare every
 * member before publishing any of them. Both callers ask the same two
 * questions in the same order; only WHICH ids count as taken differs.
 */
function preparedSource(
  source: WidgetSource,
  isTaken: (id: string) => boolean
): WidgetSource {
  validateWidgetSource(source);
  if (isTaken(source.id)) {
    throw NextlyError.conflict({
      message: `Widget source "${source.id}" is already registered.`,
    });
  }
  return snapshot(source);
}

/** Register a source. Throws if it is malformed, or if the id is already taken. */
export function registerSource(source: WidgetSource): void {
  const prepared = preparedSource(source, id => store().has(id));
  store().set(prepared.id, prepared);
}

export function getSource(id: string): WidgetSource | undefined {
  return store().get(id);
}

/**
 * Swap every source of one KIND for `next`, leaving the other kinds standing.
 *
 * The collection sources are DERIVED from the collection registry rather than
 * declared, so they are rebuilt whenever that registry is consulted -- and a
 * rebuild has to be able to run against a store that already holds the
 * previous answer, which `registerSource` refuses (correctly: a duplicate id
 * inside one pass is a real mistake). Replacing by kind is what makes the
 * rebuild idempotent without weakening that refusal.
 *
 * Kind-scoped, not a full clear: a plugin's own `plugin:` sources are declared
 * once at boot and have nothing to do with which collections exist, so a
 * collection rebuild must not take them with it.
 *
 * A collection that has LEFT the registry loses its source here, which is the
 * direction that matters: the set shrinks as well as grows.
 */
export function replaceSourcesOfKind(
  kind: WidgetSourceKind,
  next: readonly WidgetSource[]
): void {
  const map = store();

  // Every member is validated and detached BEFORE anything is deleted, and the
  // swap that follows cannot fail. Deleting first and registering one at a time
  // meant a single refused member left the store holding a partial rebuild:
  // `refreshCollectionSources` runs once per dashboard batch over EVERY
  // collection, so one malformed source unpublished the sources beside it and
  // every widget addressing one answered "unavailable source" until a later
  // refresh happened to succeed. A failed rebuild now leaves the previous set
  // standing, which is the same reading `refreshCollectionSources` already
  // takes of an unreachable registry.
  const staged = new Map<string, WidgetSource>();
  // A source of the KIND being replaced is on its way out, so it does not claim
  // its own id against the incoming set -- that is what makes a rebuild
  // idempotent. A source of ANY OTHER kind does claim it, and so does an id this
  // same pass has already staged: a duplicate inside one pass is a real mistake
  // and stays refused.
  const isTaken = (id: string): boolean => {
    if (staged.has(id)) return true;
    const existing = map.get(id);
    return existing !== undefined && existing.kind !== kind;
  };
  for (const source of next) {
    const prepared = preparedSource(source, isTaken);
    staged.set(prepared.id, prepared);
  }

  for (const [id, source] of [...map]) {
    if (source.kind === kind) map.delete(id);
  }
  for (const [id, source] of staged) map.set(id, source);
}

/**
 * The ONE refusal every "you cannot query that" answer gives.
 *
 * A widget query names a source and an op, and both are caller input on a
 * batch endpoint any authenticated session or API key can reach. Answering
 * "unknown source" for one id and "does not support op" for another tells the
 * caller which sources EXIST -- a source-enumeration oracle over the install's
 * schema, walked one collection name at a time. Same for "kind is not
 * executable yet": it too confirms the source is real.
 *
 * So all of them collapse to one string here, and the thing that actually
 * happened rides in `logContext` where an operator debugging a broken
 * dashboard can still read it. Made indistinguishable, not thrown away.
 *
 * NOT `invalidInput` with the detail as its message: that factory puts its
 * message straight onto the wire, which is exactly the disclosure being
 * closed.
 */
export function failUnavailableSourceOrOp(detail: string): never {
  throw NextlyError.invalidInput({
    message: "Invalid widget query: unavailable source or unsupported op",
    logContext: { widgetQuery: detail },
  });
}

/**
 * The thing a source id ADDRESSES: `collection:posts` -> `posts`.
 *
 * One implementation, because two callers ask it for decisions that must
 * agree: the executor turns it into the collection it reads, and the endpoint
 * turns it into the slug it authorizes. A copy that disagreed would authorize
 * one entity and read another.
 */
export function sourceTarget(sourceId: string): string {
  const separator = sourceId.indexOf(":");
  return separator === -1 ? sourceId : sourceId.slice(separator + 1);
}

export function listSources(): WidgetSource[] {
  return [...store().values()];
}

export function clearSources(): void {
  store().clear();
}

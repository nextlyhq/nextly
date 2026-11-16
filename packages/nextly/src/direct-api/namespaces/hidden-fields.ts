/**
 * Hidden fields at the Direct API boundary.
 *
 * A field is hidden by core's sensitive-field rule (`sensitiveFieldPaths`):
 * `admin.hidden`, or a password. `admin.hidden` is a UI flag, not a secret:
 * it keeps a field out of the admin's forms, and the field is often public
 * data a site renders. So a read returns hidden fields unless it passes
 * `showHiddenFields: false`, trusted or judged as a caller alike. What keeps a
 * value from a caller is the field's own read rule (`access.read`).
 *
 * Password values are a separate, stricter matter: the read services strip
 * them from every read, whatever this option says.
 *
 * The paths and the strip are the public reader's own pipeline
 * (`runtime/routing/declared-fields`), so the Direct API, the public reader
 * and the webhooks cannot disagree about which fields are hidden. A user's
 * custom fields are judged by the same rule (`sensitiveFieldPaths`), over the
 * fields the user services read and write.
 *
 * A filter, a sort or a group key naming a hidden field is refused by core's
 * read pipeline (`assertNoHiddenFieldQueried`), handed a lookup of the paths
 * resolved here (`pathsOf`) that it resolves only past the read gate, so a
 * caller the gate refuses never reaches the declarations.
 *
 * @module direct-api/namespaces/hidden-fields
 */

import { readFieldGroupType } from "../../domains/field-groups/storage/field-group-type-key";
import {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "../../domains/webhooks/sensitive-fields";
import {
  expandedFields,
  hiddenPathsOf,
  withoutHidden,
  type SourceEntity,
} from "../../runtime/routing/declared-fields";

/** The option that decides whether a read leaves hidden fields out. */
interface HiddenFieldOptions {
  readonly showHiddenFields?: boolean;
}

/** Whether this read leaves hidden fields out: only when it says so. */
function stripsHiddenFields(config: HiddenFieldOptions): boolean {
  return config.showHiddenFields === false;
}

const NONE: ReadonlySet<string> = new Set();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The field shape the walk to related documents reads. */
interface WalkedField {
  readonly name?: string;
  readonly type?: string;
  readonly relationTo?: unknown;
  readonly fields?: readonly WalkedField[];
}

/** The value read for `source`, read once and shared by every later ask. */
function once<V>(
  cache: Map<string, Promise<V>>,
  source: SourceEntity,
  read: (source: SourceEntity) => Promise<V>
): Promise<V> {
  // `kind` is one of two fixed words, so the key names one source exactly.
  const key = `${source.kind}:${source.slug}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const value = read(source);
  cache.set(key, value);
  return value;
}

/**
 * Each source's declarations, read at most once for one Direct API call: every
 * row of a list and every related document population reached ask for the same
 * few sources, and each read goes to the registry. The promise is kept, so
 * rows stripped side by side share one read in flight. Per call, never module
 * wide: declarations change at runtime.
 *
 * One snapshot per source: the hidden paths are derived from the same expanded
 * fields the walk to related documents follows, so the registry and the
 * component definitions are read once, and the paths stripped and the fields
 * walked cannot come from two different reads of a changing schema.
 */
class Declarations {
  private readonly hidden = new Map<string, Promise<ReadonlySet<string>>>();
  private readonly fields = new Map<
    string,
    Promise<readonly SensitiveFieldSource[] | undefined>
  >();

  hiddenOf(source: SourceEntity): Promise<ReadonlySet<string>> {
    return once(this.hidden, source, async known =>
      hiddenPathsOf(await this.fieldsOf(known))
    );
  }

  fieldsOf(
    source: SourceEntity
  ): Promise<readonly SensitiveFieldSource[] | undefined> {
    return once(this.fields, source, expandedFields);
  }
}

/** One Direct API call's handling of hidden fields, by its `showHiddenFields`. */
export interface HiddenFieldRead {
  /** The hidden paths of `source` this read leaves out: none when it keeps them. */
  pathsOf(source: SourceEntity): Promise<ReadonlySet<string>>;
  /**
   * The document without its hidden fields, and every related document it
   * carries (a populated relationship or upload, at any depth population
   * reached) without its own, each by its own collection's declarations; the
   * same object when this read keeps hidden fields. A client handed the result
   * gets none of them, whichever document they sat on.
   */
  without<T>(document: T, source: SourceEntity): Promise<T>;
}

/** A read that keeps hidden fields: nothing is resolved or stripped. */
const KEEPS: HiddenFieldRead = {
  pathsOf: () => Promise.resolve(NONE),
  without: document => Promise.resolve(document),
};

/**
 * How one Direct API call handles hidden fields. Make one per call and use it
 * for the call's whole read, its query refusal and every row it returns, so
 * each source's declarations are read once.
 */
export function hiddenFieldRead(config: HiddenFieldOptions): HiddenFieldRead {
  if (!stripsHiddenFields(config)) return KEEPS;
  const declarations = new Declarations();
  return {
    pathsOf: source => declarations.hiddenOf(source),
    without: async (document, source) =>
      isRecord(document)
        ? ((await withoutHiddenAt(
            declarations,
            document,
            source,
            0
          )) as typeof document)
        : document,
  };
}

/**
 * The hidden paths among a user's custom fields this read leaves out, by the
 * fields the user services use (`fields`, asked only when the read strips);
 * none when it keeps them.
 */
export function hiddenUserFieldPaths(
  config: HiddenFieldOptions,
  fields: () => readonly SensitiveFieldSource[]
): ReadonlySet<string> {
  if (!stripsHiddenFields(config)) return NONE;
  return new Set(sensitiveFieldPaths(fields()));
}

/** The record without `hidden`'s paths; the same object when there are none. */
export function withoutHiddenPaths<T>(
  record: T,
  hidden: ReadonlySet<string>
): T {
  if (hidden.size === 0 || !isRecord(record)) return record;
  return withoutHidden(record, hidden) as T;
}

/** The deepest related document the strip follows: past population's own depths. */
const MAX_RELATED_DEPTH = 10;

/**
 * A related value with its document's hidden fields left out, by that
 * document's own collection. An id that was not populated is returned as it
 * is; a polymorphic value (`{ relationTo, value }`) names its collection.
 */
async function withoutHiddenRelated(
  declarations: Declarations,
  value: unknown,
  relationTo: unknown,
  level: number
): Promise<unknown> {
  if (!isRecord(value)) return value;
  if (Array.isArray(relationTo)) {
    const slug = value.relationTo;
    if (typeof slug !== "string" || !isRecord(value.value)) return value;
    return {
      ...value,
      value: await withoutHiddenAt(
        declarations,
        value.value,
        { kind: "collection", slug },
        level + 1
      ),
    };
  }
  if (typeof relationTo !== "string") return value;
  return withoutHiddenAt(
    declarations,
    value,
    { kind: "collection", slug: relationTo },
    level + 1
  );
}

/** A relationship or upload value, one or many, with each document stripped. */
async function strippedRelation(
  declarations: Declarations,
  value: unknown,
  field: WalkedField,
  level: number
): Promise<unknown> {
  if (!Array.isArray(value)) {
    return withoutHiddenRelated(declarations, value, field.relationTo, level);
  }
  return Promise.all(
    value.map(item =>
      withoutHiddenRelated(declarations, item, field.relationTo, level)
    )
  );
}

/** A container's value as rows: a group's one object, a repeater's array. */
function rowsOf(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).filter(isRecord);
}

/** One named field of `holder`, with any related document it carries stripped. */
async function stripRelatedField(
  declarations: Declarations,
  holder: Record<string, unknown>,
  field: WalkedField & { readonly name: string },
  level: number
): Promise<void> {
  const value = holder[field.name];
  if (value === undefined || value === null) return;
  if (field.type === "relationship" || field.type === "upload") {
    holder[field.name] = await strippedRelation(
      declarations,
      value,
      field,
      level
    );
    return;
  }
  if (field.fields === undefined) return;
  for (const row of rowsOf(value)) {
    await stripRelated(declarations, row, field.fields, level);
  }
}

/**
 * Follow `fields` through `holder`, replacing each populated relationship or
 * upload value with its own document stripped. Containers (a group, a
 * repeater's rows, a component's instance) are walked by their sub-fields; a
 * nameless container holds its children inline, at the holder's level.
 */
async function stripRelated(
  declarations: Declarations,
  holder: Record<string, unknown>,
  fields: readonly WalkedField[],
  level: number
): Promise<void> {
  for (const field of fields) {
    const { name } = field;
    if (name?.startsWith("#") === true) {
      // A dynamic zone's member type: its fields apply to an instance that
      // names it, at the instance's own level. Read through the accessor, so
      // an instance stored under either spelling of the key is walked.
      if (
        readFieldGroupType(holder) === name.slice(1) &&
        field.fields !== undefined
      ) {
        await stripRelated(declarations, holder, field.fields, level);
      }
    } else if (name !== undefined && name !== "") {
      await stripRelatedField(declarations, holder, { ...field, name }, level);
    } else if (field.fields !== undefined) {
      await stripRelated(declarations, holder, field.fields, level);
    }
  }
}

/** The document at `level` without its source's hidden fields, nor its related documents'. */
async function withoutHiddenAt(
  declarations: Declarations,
  document: Record<string, unknown>,
  source: SourceEntity,
  level: number
): Promise<Record<string, unknown>> {
  const hidden = await declarations.hiddenOf(source);
  const stripped =
    hidden.size === 0 ? { ...document } : withoutHidden(document, hidden);
  if (level >= MAX_RELATED_DEPTH) return stripped;
  const fields = await declarations.fieldsOf(source);
  if (fields !== undefined) {
    await stripRelated(declarations, stripped, fields, level);
  }
  return stripped;
}

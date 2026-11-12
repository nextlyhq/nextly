/**
 * Which collections a write may concern the page builder at all, answered
 * from the site's code, without a statement.
 *
 * The page builder listens on every collection's writes: an entry's save may
 * move the address its collection's template serves it at, and a document
 * holding blocks is indexed, reported on and judged again after it commits.
 * A collection whose entries no template may serve, and which declares no
 * blocks field, concerns none of it: another plugin's private bookkeeping is
 * the common case, and every write to it would otherwise read the templates,
 * write a lock row of the address store and read the component registry.
 *
 * The answer comes from the site's configuration as plugins see it
 * (`ctx.config`): the collections declared in code, each plugin's included,
 * with the fields other plugins extend them with. That is the one source the
 * registry holds for those collections too, and it cannot go stale while the
 * process runs: a collection, Single or field group defined in code is locked
 * against the Schema Builder, so its schema changes only with its code. A
 * collection the code does not declare, which the Schema Builder made and may
 * change at any time, is not answered here: every write to it is judged as
 * before, from the registry, so a field or a template it is given at runtime
 * counts from its next write.
 *
 * Two questions, each derived from the rule that already answers it:
 * - whether an entry may be served at an address: a collection given one in
 *   code, or one the template guard lets have a template
 *   (`templateRecordProblem`) and that is not localized;
 * - whether a document may hold blocks: a blocks field anywhere in the
 *   declaration, or a field group or container the walk cannot see into
 *   (`blocksFieldReach`), such as a field group made in the admin, whose
 *   fields can change at runtime.
 *
 * @module collection-reach
 */
import {
  blocksFieldReach,
  type FieldGroupDefinitions,
} from "./class-usage-blocks-fields";
import { templateRecordProblem } from "./templates/template-guard";

/**
 * Whether entries of `collection`, as `record` declares it, may be served at
 * the address a template stores: the template guard lets it have one, and it
 * is not localized. Asked of the registry's record on a write and of the
 * site's code here, so the two answer by one rule.
 */
export function mayBeTemplated(
  collection: string,
  record: Record<string, unknown> | null,
  ownCollections: ReadonlySet<string>
): boolean {
  return (
    templateRecordProblem(collection, record, ownCollections) === null &&
    record?.localized !== true
  );
}

/** What is known of a collection from the site's code. */
export interface CollectionReach {
  /**
   * Whether an entry of `collection` may be served at an address: false only
   * for a collection declared in code that no address in code names and no
   * template may serve, and for the page builder's own collections.
   */
  mayServeEntries(collection: string): boolean;
  /**
   * Whether a document of `collection` may hold blocks: false only for a
   * collection declared in code that declares no blocks field anywhere, nor
   * anything one could sit behind unseen.
   */
  mayHoldBlocks(collection: string): boolean;
}

/** Where {@link collectionReach} reads the site from. */
export interface CollectionReachSource {
  /** The collections the site's code declares, each plugin's included. */
  readonly collections: () => readonly unknown[] | undefined;
  /** The field groups the site's code declares, by slug. */
  readonly fieldGroups: FieldGroupDefinitions;
  /** The collections given an address in code. */
  readonly addresses: { has(collection: string): boolean };
  /** The page builder's own collections, by their resolved slugs. */
  readonly own: () => ReadonlySet<string>;
}

/** One collection's answers, worked out once. */
interface Reached {
  readonly servesEntries: boolean;
  readonly holdsBlocks: boolean;
}

/** A declared collection's record, when it is one with a slug. */
function declared(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { slug?: unknown }).slug === "string"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The answers for the collections `source` declares, each worked out the
 * first time it is asked and kept for as long as the declarations are the
 * same list.
 */
export function collectionReach(
  source: CollectionReachSource
): CollectionReach {
  let list: readonly unknown[] | undefined;
  let records = new Map<string, Record<string, unknown>>();
  const answers = new Map<string, Reached>();

  const reached = (collection: string): Reached | undefined => {
    const now = source.collections();
    if (now !== list) {
      list = now;
      records = new Map();
      answers.clear();
      for (const value of now ?? []) {
        const record = declared(value);
        if (record !== null) records.set(String(record.slug), record);
      }
    }
    const record = records.get(collection);
    if (record === undefined) return undefined;
    const known = answers.get(collection);
    if (known !== undefined) return known;
    const blocks = blocksFieldReach(record, undefined, source.fieldGroups);
    const answer: Reached = {
      servesEntries:
        source.addresses.has(collection) ||
        mayBeTemplated(collection, record, source.own()),
      holdsBlocks: blocks.fields.length > 0 || blocks.unreachable,
    };
    answers.set(collection, answer);
    return answer;
  };

  return {
    mayServeEntries: collection =>
      !source.own().has(collection) &&
      (reached(collection)?.servesEntries ?? true),
    mayHoldBlocks: collection => reached(collection)?.holdsBlocks ?? true,
  };
}

// What: the code-first collection a promoted Schema Builder collection is printed as: its fields,
// and every collection-level option its registry record stores that changes how it behaves.
// Why: the printed code becomes the collection's definition once it is pasted into the config. An
// option left out takes its code default at the next start, so a collection with Draft/Published
// would lose its lifecycle (every entry then served whatever its state), one with drafts kept
// beside the live row would write over it, a localized one would lose its translations' columns,
// and one with no timestamps would gain them. Each option is printed as the code-first spelling
// that the sync (`toCodeFirstCollectionConfig`) stores back as the same value, so promoting changes
// nothing about the collection but who owns it.

import type { SerializableCollection } from "../../domains/schema/services/code-generator";
import { resolveCollectionTableName } from "../../domains/schema/utils/resolve-table-name";
import type {
  DynamicCollectionRecord,
  StoredHookConfig,
} from "../../schemas/dynamic-collections";
import type {
  ResolvedVersionsConfig,
  VersionsConfig,
} from "../../schemas/versions/types";

/** The record's parts the printed collection is made from. */
export type PromotedRecord = Pick<
  DynamicCollectionRecord,
  | "slug"
  | "fields"
  | "tableName"
  | "timestamps"
  | "status"
  | "versions"
  | "localized"
  | "revalidate"
  | "webhooks"
  | "indexes"
>;

/**
 * The collection as code-first config, in the order a hand-written one reads: what it is, its
 * storage, its lifecycle and its fields. An option is printed only where the record differs from
 * what code would assume without it.
 */
export function promotedCollection(
  record: PromotedRecord
): SerializableCollection {
  const { slug } = record;
  const versions = versionsOption(record.versions ?? null, record.status);
  return {
    slug,
    // The table the entries are in. Code derives `dc_<slug>` without it, which a record made
    // under another rule (a demoted collection keeps the name its code gave it) does not match.
    ...(record.tableName !== resolveCollectionTableName(slug)
      ? { dbName: record.tableName }
      : {}),
    ...(record.timestamps === false ? { timestamps: false } : {}),
    ...(record.status === true ? { status: true } : {}),
    ...(versions === undefined ? {} : { versions }),
    ...(record.localized === true ? { localized: true } : {}),
    ...(record.revalidate ? { revalidate: record.revalidate } : {}),
    ...(record.webhooks?.record === false
      ? { webhooks: { record: false } }
      : {}),
    ...(record.indexes && record.indexes.length > 0
      ? { indexes: record.indexes }
      : {}),
    fields: (record.fields ??
      []) as unknown as SerializableCollection["fields"],
  };
}

/**
 * The `versions` option that resolves to `stored` (`resolveVersionsConfig`), or undefined where
 * leaving it out already does. Every setting is spelled out, so the defaults code applies cannot
 * differ from the ones the record was stored under.
 *
 * Unversioned is the one case that needs care: in code `status: true` alone turns history on, so a
 * collection with Draft/Published and no history says `versions: false`.
 */
function versionsOption(
  stored: ResolvedVersionsConfig | null,
  status: boolean | undefined
): VersionsConfig | false | undefined {
  if (stored === null) return status === true ? false : undefined;
  const { drafts } = stored;
  return {
    drafts: !drafts.enabled
      ? false
      : drafts.autosave.enabled
        ? { autosave: { intervalMs: drafts.autosave.intervalMs } }
        : { autosave: false },
    maxPerDoc: stored.maxPerDoc,
  };
}

/**
 * The lines that go with the collection's code when it runs Schema Builder hooks: code has no
 * spelling for a stored hook, so the printed code cannot carry them, and they stop running once
 * the collection is defined in code. Said, so the operator can write them as code hooks first.
 * None where it has no enabled hook.
 */
export function droppedHooksNote(
  hooks: readonly StoredHookConfig[] | undefined
): string[] {
  const running = (hooks ?? []).filter(hook => hook.enabled);
  if (running.length === 0) return [];
  return [
    "It runs Schema Builder hooks the code above does not carry, which stop once it is defined",
    `in code: ${running.map(hook => `${hook.hookId} (${hook.hookType})`).join(", ")}.`,
    "Write each as a hook in its `hooks` option to keep it.",
  ];
}

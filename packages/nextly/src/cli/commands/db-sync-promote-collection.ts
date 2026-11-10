// What: the code-first collection a promoted Schema Builder collection is printed as: its fields,
// and every collection-level option its registry record stores that changes how it behaves.
// Why: the printed code becomes the collection's definition once it is pasted into the config. An
// option left out takes its code default at the next start, so a collection with Draft/Published
// would lose its lifecycle (every entry then served whatever its state), one with drafts kept
// beside the live row would write over it, a localized one would lose its translations' columns,
// and one with no timestamps would gain them. Each option is printed as the code-first spelling
// that the sync (`toCodeFirstCollectionConfig`) stores back as the same value, so promoting changes
// nothing about the collection but who owns it. Its names, its description and its admin options
// (sidebar placement, list columns, title field, page sizes, custom views) are printed too, since
// they are what an editor sees of it.

import type { SerializableCollection } from "../../domains/schema/services/code-generator";
import { resolveCollectionTableName } from "../../domains/schema/utils/resolve-table-name";
import type {
  CollectionAdminConfig,
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
  | "labels"
  | "description"
  | "admin"
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
 * storage, its lifecycle, its admin options and its fields. An option is printed only where the
 * record differs from what code would assume without it; its names are the one exception.
 */
export function promotedCollection(
  record: PromotedRecord
): SerializableCollection {
  const { slug } = record;
  const versions = versionsOption(record.versions ?? null, record.status);
  const admin = adminOption(record.admin);
  return {
    slug,
    // Always printed where the record holds them: code's default names depend on whether the
    // entry is wrapped in `defineCollection` (which title-cases the slug) or not (which uses the
    // slug itself), and neither need be the names the collection was given.
    ...(record.labels
      ? {
          labels: {
            singular: record.labels.singular,
            plural: record.labels.plural,
          },
        }
      : {}),
    ...(record.description ? { description: record.description } : {}),
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
    ...(admin === undefined ? {} : { admin }),
    fields: promotedFields(record.fields),
  };
}

/**
 * The fields the collection is printed with. The Schema Builder stores only the fields an author
 * added: a collection's title and slug are columns of their own, outside the list, so one made of
 * nothing else has an empty list, which `defineCollection` refuses. Code declares the two itself
 * in that case, exactly as `defineCollection` adds them where they are absent, so the collection
 * it defines is the one it would have had anyway.
 */
function promotedFields(
  fields: PromotedRecord["fields"] | undefined
): SerializableCollection["fields"] {
  if (fields && fields.length > 0) {
    return fields as unknown as SerializableCollection["fields"];
  }
  return [
    {
      type: "text",
      name: "title",
      label: "Title",
      required: true,
      localized: false,
    },
    {
      type: "text",
      name: "slug",
      label: "Slug",
      required: true,
      unique: true,
      localized: false,
    },
  ];
}

/**
 * The `admin` option, holding every stored admin setting code spells as a value, or undefined
 * where the record stores none. The preview is left out: code declares it as a function of the
 * entry, which a value cannot be, so it is named in `droppedPreviewNote` instead.
 */
function adminOption(
  stored: CollectionAdminConfig | null | undefined
): Record<string, unknown> | undefined {
  if (!stored) return undefined;
  const option = definedOnly({
    group: stored.group,
    icon: stored.icon,
    hidden: stored.hidden,
    useAsTitle: stored.useAsTitle,
    defaultColumns: stored.defaultColumns,
    isPlugin: stored.isPlugin,
    disableCreate: stored.disableCreate,
    disableDelete: stored.disableDelete,
    order: stored.order,
    sidebarGroup: stored.sidebarGroup,
    pagination: definedOnly({
      defaultLimit: stored.pagination?.defaultLimit,
      limits: stored.pagination?.limits,
    }),
    components: stored.components,
  });
  return option;
}

/**
 * `value` without its undefined entries, so only what the record stores is printed, or undefined
 * where it has none.
 */
function definedOnly(
  value: Record<string, unknown>
): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(
    ([, entry]) => entry !== undefined
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
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

/**
 * The lines that go with the collection's code when it has a preview link: the Schema Builder
 * stores it as a `{field}` template, and code declares it as a function of the entry, which the
 * printed values cannot carry. Said, with the code that keeps it, so the preview button does not
 * disappear once the collection is defined in code. None where it has no preview link.
 */
export function droppedPreviewNote(
  admin: CollectionAdminConfig | null | undefined
): string[] {
  const preview = admin?.preview;
  if (!preview?.urlTemplate) {
    return preview?.hasPreview === true
      ? [
          "It has a preview link the code above does not carry. Write it as `admin.preview.url`",
          "to keep the preview button.",
        ]
      : [];
  }
  const kept = definedOnly({
    label: preview.label,
    openInNewTab: preview.openInNewTab,
  });
  const extra = Object.entries(kept ?? {})
    .map(([key, value]) => `, ${key}: ${JSON.stringify(value)}`)
    .join("");
  return [
    `Its preview link ${JSON.stringify(preview.urlTemplate)} is not in the code above, which`,
    "cannot hold a function. To keep it, add to its `admin`:",
    `preview: { url: previewUrlFromTemplate(${JSON.stringify(preview.urlTemplate)})${extra} },`,
    'with `import { previewUrlFromTemplate } from "nextly/config";`.',
  ];
}

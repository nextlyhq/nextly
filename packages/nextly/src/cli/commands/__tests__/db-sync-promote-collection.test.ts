/**
 * A promoted Schema Builder collection is printed as code that the code-first sync stores back as
 * the record it came from: its names, its description, its admin options, its lifecycle, its drafts
 * and history, its translations, its timestamps, its cache and webhook opt-outs, its table and its
 * indexes. Each case prints a record, evaluates the printed object literal, hands it to the sync's
 * own mapping (`toCodeFirstCollectionConfig`), and compares what that would store with the record.
 */
import { describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { toCodeFirstCollectionConfig } from "../../../domains/collections/services/collection-sync-service";
import { serializeCollection } from "../../../domains/schema/services/code-generator";
import { resolveBuilderVersions } from "../../../domains/versions/builder-versions";
import { resolveVersionsConfig } from "../../../domains/versions/resolve-config";
import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
import type { CollectionAdminConfig } from "../../../schemas/dynamic-collections";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import { createLogger } from "../../utils/logger";
import { promoteCollection } from "../db-sync-promote";
import {
  droppedHooksNote,
  promotedCollection,
  type PromotedRecord,
} from "../db-sync-promote-collection";

const FIELDS = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
];

/** A Schema Builder record of `articles`, with `options` over the Builder's defaults. */
function record(options: Partial<PromotedRecord> = {}): PromotedRecord {
  return {
    slug: "articles",
    labels: { singular: "Article", plural: "Articles" },
    description: null,
    admin: null,
    fields: FIELDS as never,
    tableName: "dc_articles",
    timestamps: true,
    status: false,
    versions: null,
    localized: false,
    revalidate: null,
    webhooks: null,
    ...options,
  };
}

/** The code-first config the printed code is, as the sync takes one. */
type Printed = Parameters<typeof toCodeFirstCollectionConfig>[0] &
  Record<string, unknown>;

/** The printed code, evaluated: an object literal of plain values. */
function printed(from: PromotedRecord): Printed {
  const code = serializeCollection(promotedCollection(from));
  const literal: unknown = new Function(`return (${code});`)();
  if (typeof literal !== "object" || literal === null) {
    throw new Error(`not an object literal:\n${code}`);
  }
  return literal as Printed;
}

/**
 * An admin block as stored JSON: undefined entries dropped, and an empty block the same as none.
 * The preview is left out on the record's side: code declares it as a function, so the printed
 * code names it in a note instead (asserted below).
 */
function storedAdmin(
  admin: CollectionAdminConfig | null | undefined,
  { withPreview }: { withPreview: boolean }
): unknown {
  if (!admin) return null;
  const { preview, ...rest } = admin;
  const json: Record<string, unknown> = JSON.parse(
    JSON.stringify(withPreview ? { ...rest, preview } : rest)
  );
  return Object.keys(json).length === 0 ? null : json;
}

/** What the code-first sync stores for the printed code, beside what the record holds. */
function storedBack(from: PromotedRecord) {
  const config = toCodeFirstCollectionConfig(printed(from));
  const of = (
    r: {
      labels?: unknown;
      description?: string | null;
      admin?: CollectionAdminConfig | null;
      tableName?: string;
      timestamps?: boolean;
      status?: boolean;
      versions?: unknown;
      localized?: boolean;
      revalidate?: unknown;
      webhooks?: unknown;
    },
    withPreview: boolean
  ) => ({
    labels: r.labels,
    description: r.description ?? undefined,
    admin: storedAdmin(r.admin, { withPreview }),
    tableName: r.tableName,
    timestamps: r.timestamps !== false,
    status: r.status === true,
    versions: r.versions ?? null,
    localized: r.localized === true,
    revalidate: r.revalidate ?? null,
    webhooks: r.webhooks ?? null,
  });
  return { stored: of(from, false), back: of(config, true) };
}

/** Every admin option the Schema Builder's record can store that code spells as a value. */
const ADMIN: CollectionAdminConfig = {
  group: "Content",
  icon: "FileText",
  hidden: true,
  useAsTitle: "slug",
  defaultColumns: ["title", "slug"],
  isPlugin: true,
  disableCreate: true,
  disableDelete: true,
  order: 3,
  sidebarGroup: "editorial",
  pagination: { defaultLimit: 25, limits: [25, 50] },
  components: {
    views: { Edit: { Component: "pkg/admin#Edit" } },
    BeforeListTable: "pkg/admin#Before",
  },
};

describe("a promoted collection's printed code", () => {
  it.each([
    ["Draft/Published, with no history", record({ status: true })],
    [
      "Draft/Published, with history kept",
      record({ status: true, versions: resolveBuilderVersions(true, 20) }),
    ],
    [
      "drafts kept beside the live row, autosaving",
      record({
        status: true,
        versions: resolveVersionsConfig({
          drafts: { autosave: { intervalMs: 2500 } },
          maxPerDoc: false,
        }),
      }),
    ],
    [
      "drafts kept, not autosaving",
      record({
        status: true,
        versions: resolveVersionsConfig({ drafts: { autosave: false } }),
      }),
    ],
    [
      "history alone, with no lifecycle",
      record({ versions: resolveBuilderVersions(true) }),
    ],
    ["translations", record({ localized: true })],
    ["no timestamps", record({ timestamps: false })],
    [
      "the cache opt-out",
      record({ revalidate: resolveBuilderRevalidate(false) }),
    ],
    ["the webhook opt-out", record({ webhooks: { record: false } })],
    [
      "a table code would name otherwise",
      record({ tableName: "dc_legacy_articles" }),
    ],
    [
      "names of its own",
      record({ labels: { singular: "Story", plural: "Stories" } }),
    ],
    ["a description", record({ description: "News and features." })],
    ["its admin options", record({ admin: ADMIN })],
    [
      "a sidebar group and no other admin option",
      record({ admin: { group: "Content" } }),
    ],
    [
      "its admin options beside a preview link",
      record({
        admin: { group: "Content", preview: { urlTemplate: "/a/{slug}" } },
      }),
    ],
    ["nothing but its fields", record()],
  ])("is stored back as the record it came from: %s", (_what, from) => {
    const { stored, back } = storedBack(from);
    expect(back).toEqual(stored);
  });

  it("prints Draft/Published as `status: true`", () => {
    expect(printed(record({ status: true }))).toMatchObject({ status: true });
  });

  it("prints the collection's indexes", () => {
    const indexes = [{ fields: ["slug"], unique: true }];
    expect(printed(record({ indexes }))).toMatchObject({ indexes });
  });

  it("prints the collection's names, description and admin options", () => {
    expect(
      printed(record({ description: "News and features.", admin: ADMIN }))
    ).toMatchObject({
      labels: { singular: "Article", plural: "Articles" },
      description: "News and features.",
      admin: ADMIN,
    });
  });

  it("prints only the slug, the names and the fields for a collection with no options", () => {
    expect(printed(record())).toEqual({
      slug: "articles",
      labels: { singular: "Article", plural: "Articles" },
      fields: FIELDS,
    });
  });
});

describe("a promoted collection's fields", () => {
  /** The title and slug fields `defineCollection` adds to a collection that declares neither. */
  function systemFields() {
    const defined = defineCollection({
      slug: "articles",
      fields: [{ name: "body", type: "text" }],
    });
    return defined.fields.filter(field => field.name !== "body");
  }

  it("are accepted by `defineCollection` for a collection of only its title and slug", () => {
    // The Schema Builder keeps a collection's title and slug outside its field list, so one with
    // no other field has none stored.
    const config = printed(record({ fields: [] }));
    expect(() => defineCollection(config as never)).not.toThrow();
    expect(defineCollection(config as never).fields).toEqual(systemFields());
  });

  it("are the stored ones for a collection with fields of its own", () => {
    const config = printed(record());
    expect(config.fields).toEqual(FIELDS);
    expect(() => defineCollection(config as never)).not.toThrow();
  });
});

describe("a promoted collection's preview link", () => {
  /** The code and the note a promote of `from` shows before it asks. */
  async function shown(from: PromotedRecord): Promise<string> {
    let preview = "";
    const registry = {
      getCollectionBySlug: async () => ({ ...from, hooks: [] }),
    } as unknown as CollectionRegistryService;
    const outcome = await promoteCollection({
      slug: from.slug,
      logger: createLogger({ quiet: true }),
      cwd: "/nonexistent",
      registry,
      adapter: {} as never,
      // Declined, so nothing is written and no lock is taken.
      confirm: async code => {
        preview = code;
        return false;
      },
    });
    expect(outcome).toBe("cancelled");
    return preview;
  }

  it("is named with the code that keeps it, since code declares it as a function", async () => {
    const preview = await shown(
      record({
        admin: {
          group: "Content",
          preview: { urlTemplate: "/articles/{slug}", label: "View" },
        },
      })
    );
    expect(preview).toContain(
      'preview: { url: previewUrlFromTemplate("/articles/{slug}"), label: "View" },'
    );
    expect(preview).toContain('from "nextly/config"');
  });

  it("is not mentioned for a collection without one", async () => {
    const preview = await shown(record({ admin: { group: "Content" } }));
    expect(preview).not.toContain("preview");
  });
});

describe("a promoted collection's Schema Builder hooks", () => {
  const hook = (hookId: string, enabled: boolean) => ({
    hookId,
    hookType: "beforeChange" as const,
    enabled,
    config: {},
    order: 0,
  });

  it("names each enabled one, since the printed code cannot carry it", () => {
    const note = droppedHooksNote([
      hook("auto-slug", true),
      hook("audit-fields", false),
    ]).join(" ");
    expect(note).toContain("auto-slug (beforeChange)");
    expect(note).not.toContain("audit-fields");
  });

  it("says nothing for a collection with no enabled hook", () => {
    expect(droppedHooksNote(undefined)).toEqual([]);
    expect(droppedHooksNote([hook("audit-fields", false)])).toEqual([]);
  });
});

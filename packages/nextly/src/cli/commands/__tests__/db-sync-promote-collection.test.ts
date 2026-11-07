/**
 * A promoted Schema Builder collection is printed as code that the code-first sync stores back as
 * the record it came from: its lifecycle, its drafts and history, its translations, its timestamps,
 * its cache and webhook opt-outs, its table and its indexes. Each case prints a record, evaluates
 * the printed object literal, hands it to the sync's own mapping (`toCodeFirstCollectionConfig`),
 * and compares what that would store with the record.
 */
import { describe, expect, it } from "vitest";

import { toCodeFirstCollectionConfig } from "../../../domains/collections/services/collection-sync-service";
import { serializeCollection } from "../../../domains/schema/services/code-generator";
import { resolveBuilderVersions } from "../../../domains/versions/builder-versions";
import { resolveVersionsConfig } from "../../../domains/versions/resolve-config";
import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
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

/** What the code-first sync stores for the printed code, beside what the record holds. */
function storedBack(from: PromotedRecord) {
  const config = toCodeFirstCollectionConfig(printed(from));
  const of = (r: {
    tableName?: string;
    timestamps?: boolean;
    status?: boolean;
    versions?: unknown;
    localized?: boolean;
    revalidate?: unknown;
    webhooks?: unknown;
  }) => ({
    tableName: r.tableName,
    timestamps: r.timestamps !== false,
    status: r.status === true,
    versions: r.versions ?? null,
    localized: r.localized === true,
    revalidate: r.revalidate ?? null,
    webhooks: r.webhooks ?? null,
  });
  return { stored: of(from), back: of(config) };
}

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

  it("prints only the slug and the fields for a collection with no options", () => {
    expect(printed(record())).toEqual({ slug: "articles", fields: FIELDS });
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

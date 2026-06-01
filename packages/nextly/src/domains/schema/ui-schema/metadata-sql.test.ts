/**
 * @module domains/schema/ui-schema/metadata-sql.test
 * @since v0.0.3-alpha (Plan D2b)
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { calculateSchemaHash } from "../services/schema-hash";

import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
} from "./metadata-sql";

const manifest = uiSchemaManifest.parse({
  collections: [
    {
      slug: "events",
      labels: { singular: "Event", plural: "Events" },
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "note", type: "text" },
      ],
    },
    { slug: "no-labels", fields: [{ name: "x", type: "text" }] },
  ],
  singles: [{ slug: "home", fields: [{ name: "hero", type: "text" }] }],
  components: [{ slug: "seo", fields: [{ name: "meta_title", type: "text" }] }],
});

const events = manifest.collections[0];
const noLabels = manifest.collections[1];
const home = manifest.singles[0];
const seo = manifest.components[0];

describe("buildCollectionMetadataUpsert", () => {
  it("postgres: INSERT … ON CONFLICT (slug) DO UPDATE with ::jsonb casts", () => {
    const sql = buildCollectionMetadataUpsert(events, "postgresql");
    expect(sql).toContain('INSERT INTO "dynamic_collections"');
    expect(sql).toContain('ON CONFLICT ("slug") DO UPDATE SET');
    expect(sql).toContain("::jsonb");
    expect(sql).toContain("'dc_events'");
    expect(sql).toContain("'ui'");
  });

  it("mysql: INSERT … ON DUPLICATE KEY UPDATE with backtick idents", () => {
    const sql = buildCollectionMetadataUpsert(events, "mysql");
    expect(sql).toContain("INSERT INTO `dynamic_collections`");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toContain("VALUES(`fields`)");
  });

  it("sqlite: ON CONFLICT(slug) and integer booleans", () => {
    const sql = buildCollectionMetadataUpsert(events, "sqlite");
    expect(sql).toContain('ON CONFLICT ("slug") DO UPDATE SET');
    expect(sql).toMatch(/"status"/);
  });

  it("embeds the runtime schema hash for the fields", () => {
    const sql = buildCollectionMetadataUpsert(events, "postgresql");
    const hash = calculateSchemaHash(
      events.fields as unknown as Parameters<typeof calculateSchemaHash>[0]
    );
    expect(sql).toContain(hash);
  });

  it("derives labels from the slug when omitted", () => {
    const sql = buildCollectionMetadataUpsert(noLabels, "postgresql");
    expect(sql).toContain('"labels"');
    expect(sql).toContain("'dc_no_labels'");
  });

  it("is deterministic (same input → identical SQL)", () => {
    expect(buildCollectionMetadataUpsert(events, "postgresql")).toBe(
      buildCollectionMetadataUpsert(events, "postgresql")
    );
  });

  it("escapes single quotes in values", () => {
    const tricky = uiSchemaManifest.parse({
      collections: [
        {
          slug: "quotes",
          labels: { singular: "It's", plural: "It's" },
          fields: [{ name: "x", type: "text" }],
        },
      ],
    }).collections[0];
    const sql = buildCollectionMetadataUpsert(tricky, "postgresql");
    expect(sql).toContain("It''s");
  });
});

describe("buildSingleMetadataUpsert", () => {
  it("targets dynamic_singles with a singular label column", () => {
    const sql = buildSingleMetadataUpsert(home, "postgresql");
    expect(sql).toContain('INSERT INTO "dynamic_singles"');
    expect(sql).toContain('"label"');
    expect(sql).toContain("'single_home'");
  });
});

describe("buildComponentMetadataUpsert", () => {
  it("targets dynamic_components and omits status", () => {
    const sql = buildComponentMetadataUpsert(seo, "postgresql");
    expect(sql).toContain('INSERT INTO "dynamic_components"');
    expect(sql).toContain("'comp_seo'");
    expect(sql).not.toContain('"status"');
  });
});

/**
 * Pins the full registry-row upsert SQL per entity kind and dialect, and the
 * typed row values the SQL is rendered from.
 *
 * The SQL expectations are whole statements rather than fragments: the values
 * are computed apart from their rendering, so a change in either shows up here
 * as a byte difference in the statement a committed migration carries.
 *
 * @module domains/schema/ui-schema/metadata-sql-row-values.test
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";

import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
  collectionRowValues,
  componentRowValues,
  singleRowValues,
} from "./metadata-sql";

// One entity per kind carrying every optional column the builders can write,
// plus a backslash (validation pattern) and an apostrophe so the per-dialect
// quoting is part of what is pinned.
const manifest = uiSchemaManifest.parse({
  collections: [
    {
      slug: "blog-posts",
      labels: { singular: "Post", plural: "Author's Posts" },
      description: "Editorial content",
      admin: { useAsTitle: "title", icon: "FileText", hidden: false, order: 2 },
      hooks: [
        {
          hookId: "auto-slug",
          hookType: "beforeChange",
          enabled: true,
          config: { sourceField: "title" },
          order: 0,
        },
      ],
      status: true,
      localized: true,
      versions: true,
      versionsMaxPerDoc: 10,
      revalidate: false,
      webhooks: false,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "code", type: "text", options: { pattern: "^\\d+$" } },
      ],
    },
  ],
  singles: [
    {
      slug: "site-settings",
      description: "Site-wide settings",
      admin: { icon: "Settings", sidebarGroup: "config" },
      status: true,
      localized: true,
      versions: true,
      revalidate: false,
      webhooks: false,
      fields: [{ name: "site_name", type: "text" }],
    },
  ],
  components: [
    {
      slug: "seo",
      labels: { singular: "SEO", plural: "SEO" },
      description: "Search metadata",
      admin: { icon: "Search", hidden: true },
      localized: true,
      fields: [{ name: "meta_title", type: "text" }],
    },
  ],
});

const collection = manifest.collections[0];
const single = manifest.singles[0];
const component = manifest.components[0];

// The same kinds with nothing optional set, pinning the omitted conditional
// columns and the NULL/false defaults of the always-written ones.
const bare = uiSchemaManifest.parse({
  collections: [{ slug: "notes", fields: [{ name: "body", type: "text" }] }],
  singles: [{ slug: "home", fields: [{ name: "hero", type: "text" }] }],
  components: [{ slug: "cta", fields: [{ name: "label", type: "text" }] }],
});

describe("full upsert SQL, pinned per dialect", () => {
  it("collection", () => {
    expect(
      buildCollectionMetadataUpsert(collection, "postgresql")
    ).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "admin", "hooks", "created_at", "updated_at", "description") VALUES ('6c40b281-8982-e16a-cbf8-25367498308f', 'blog-posts', '{"singular":"Post","plural":"Author''s Posts"}'::jsonb, 'dc_blog_posts', '[{"name":"title","type":"text","required":true},{"name":"code","type":"text","options":{"pattern":"^\\\\d+$"}}]'::jsonb, 'ui', '46eb09f492a2432c0baac950e339715a66a4f5d5d4528f4dcfccae5a3dc0947b', true, true, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":10}'::jsonb, '{"disable":true}'::jsonb, '{"record":false}'::jsonb, 'applied', '{"useAsTitle":"title","icon":"FileText","hidden":false,"order":2}'::jsonb, '[{"hookId":"auto-slug","hookType":"beforeChange","enabled":true,"config":{"sourceField":"title"},"order":0}]'::jsonb, now(), now(), 'Editorial content') ON CONFLICT ("slug") DO UPDATE SET "labels" = EXCLUDED."labels", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "admin" = EXCLUDED."admin", "hooks" = EXCLUDED."hooks", "updated_at" = EXCLUDED."updated_at", "description" = EXCLUDED."description""`
    );
    expect(
      buildCollectionMetadataUpsert(collection, "mysql")
    ).toMatchInlineSnapshot(
      `"INSERT INTO \`dynamic_collections\` (\`id\`, \`slug\`, \`labels\`, \`table_name\`, \`fields\`, \`source\`, \`schema_hash\`, \`status\`, \`localized\`, \`versions\`, \`revalidate\`, \`webhooks\`, \`migration_status\`, \`admin\`, \`hooks\`, \`created_at\`, \`updated_at\`, \`description\`) VALUES ('6c40b281-8982-e16a-cbf8-25367498308f', 'blog-posts', '{"singular":"Post","plural":"Author''s Posts"}', 'dc_blog_posts', '[{"name":"title","type":"text","required":true},{"name":"code","type":"text","options":{"pattern":"^\\\\\\\\d+$"}}]', 'ui', '46eb09f492a2432c0baac950e339715a66a4f5d5d4528f4dcfccae5a3dc0947b', true, true, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":10}', '{"disable":true}', '{"record":false}', 'applied', '{"useAsTitle":"title","icon":"FileText","hidden":false,"order":2}', '[{"hookId":"auto-slug","hookType":"beforeChange","enabled":true,"config":{"sourceField":"title"},"order":0}]', NOW(3), NOW(3), 'Editorial content') ON DUPLICATE KEY UPDATE \`labels\` = VALUES(\`labels\`), \`fields\` = VALUES(\`fields\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`status\` = VALUES(\`status\`), \`localized\` = VALUES(\`localized\`), \`versions\` = VALUES(\`versions\`), \`revalidate\` = VALUES(\`revalidate\`), \`webhooks\` = VALUES(\`webhooks\`), \`admin\` = VALUES(\`admin\`), \`hooks\` = VALUES(\`hooks\`), \`updated_at\` = VALUES(\`updated_at\`), \`description\` = VALUES(\`description\`)"`
    );
    expect(
      buildCollectionMetadataUpsert(collection, "sqlite")
    ).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "admin", "hooks", "created_at", "updated_at", "description") VALUES ('6c40b281-8982-e16a-cbf8-25367498308f', 'blog-posts', '{"singular":"Post","plural":"Author''s Posts"}', 'dc_blog_posts', '[{"name":"title","type":"text","required":true},{"name":"code","type":"text","options":{"pattern":"^\\\\d+$"}}]', 'ui', '46eb09f492a2432c0baac950e339715a66a4f5d5d4528f4dcfccae5a3dc0947b', 1, 1, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":10}', '{"disable":true}', '{"record":false}', 'applied', '{"useAsTitle":"title","icon":"FileText","hidden":false,"order":2}', '[{"hookId":"auto-slug","hookType":"beforeChange","enabled":true,"config":{"sourceField":"title"},"order":0}]', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, 'Editorial content') ON CONFLICT ("slug") DO UPDATE SET "labels" = EXCLUDED."labels", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "admin" = EXCLUDED."admin", "hooks" = EXCLUDED."hooks", "updated_at" = EXCLUDED."updated_at", "description" = EXCLUDED."description""`
    );
  });

  it("single", () => {
    expect(
      buildSingleMetadataUpsert(single, "postgresql")
    ).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at", "admin", "description") VALUES ('97551273-bba5-6cdb-e190-a09b16a53566', 'site-settings', 'Site Setting', 'single_site_settings', '[{"name":"site_name","type":"text"}]'::jsonb, 'ui', 'cd8aa5a3d3f8705531c0be276d45df513ae84fdd18c37e0bcdfaaacf92a02938', true, true, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":50}'::jsonb, '{"disable":true}'::jsonb, '{"record":false}'::jsonb, 'applied', now(), now(), '{"icon":"Settings","sidebarGroup":"config"}'::jsonb, 'Site-wide settings') ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at", "admin" = EXCLUDED."admin", "description" = EXCLUDED."description""`
    );
    expect(buildSingleMetadataUpsert(single, "mysql")).toMatchInlineSnapshot(
      `"INSERT INTO \`dynamic_singles\` (\`id\`, \`slug\`, \`label\`, \`table_name\`, \`fields\`, \`source\`, \`schema_hash\`, \`status\`, \`localized\`, \`versions\`, \`revalidate\`, \`webhooks\`, \`migration_status\`, \`created_at\`, \`updated_at\`, \`admin\`, \`description\`) VALUES ('97551273-bba5-6cdb-e190-a09b16a53566', 'site-settings', 'Site Setting', 'single_site_settings', '[{"name":"site_name","type":"text"}]', 'ui', 'cd8aa5a3d3f8705531c0be276d45df513ae84fdd18c37e0bcdfaaacf92a02938', true, true, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":50}', '{"disable":true}', '{"record":false}', 'applied', NOW(3), NOW(3), '{"icon":"Settings","sidebarGroup":"config"}', 'Site-wide settings') ON DUPLICATE KEY UPDATE \`label\` = VALUES(\`label\`), \`fields\` = VALUES(\`fields\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`status\` = VALUES(\`status\`), \`localized\` = VALUES(\`localized\`), \`versions\` = VALUES(\`versions\`), \`revalidate\` = VALUES(\`revalidate\`), \`webhooks\` = VALUES(\`webhooks\`), \`updated_at\` = VALUES(\`updated_at\`), \`admin\` = VALUES(\`admin\`), \`description\` = VALUES(\`description\`)"`
    );
    expect(buildSingleMetadataUpsert(single, "sqlite")).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at", "admin", "description") VALUES ('97551273-bba5-6cdb-e190-a09b16a53566', 'site-settings', 'Site Setting', 'single_site_settings', '[{"name":"site_name","type":"text"}]', 'ui', 'cd8aa5a3d3f8705531c0be276d45df513ae84fdd18c37e0bcdfaaacf92a02938', 1, 1, '{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":50}', '{"disable":true}', '{"record":false}', 'applied', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, '{"icon":"Settings","sidebarGroup":"config"}', 'Site-wide settings') ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at", "admin" = EXCLUDED."admin", "description" = EXCLUDED."description""`
    );
  });

  it("component", () => {
    expect(
      buildComponentMetadataUpsert(component, "postgresql")
    ).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_components" ("id", "slug", "label", "table_name", "fields", "source", "localized", "schema_hash", "migration_status", "created_at", "updated_at", "admin", "description") VALUES ('9277fdb3-f9a9-45cc-ced7-8929ff61f6b5', 'seo', 'SEO', 'comp_seo', '[{"name":"meta_title","type":"text"}]'::jsonb, 'ui', true, '0850a383641b2f06898a2e783ab920018b0b9436467f29371b4d61dfe97dd25e', 'applied', now(), now(), '{"icon":"Search","hidden":true}'::jsonb, 'Search metadata') ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "localized" = EXCLUDED."localized", "schema_hash" = EXCLUDED."schema_hash", "updated_at" = EXCLUDED."updated_at", "admin" = EXCLUDED."admin", "description" = EXCLUDED."description""`
    );
    expect(
      buildComponentMetadataUpsert(component, "mysql")
    ).toMatchInlineSnapshot(
      `"INSERT INTO \`dynamic_components\` (\`id\`, \`slug\`, \`label\`, \`table_name\`, \`fields\`, \`source\`, \`localized\`, \`schema_hash\`, \`migration_status\`, \`created_at\`, \`updated_at\`, \`admin\`, \`description\`) VALUES ('9277fdb3-f9a9-45cc-ced7-8929ff61f6b5', 'seo', 'SEO', 'comp_seo', '[{"name":"meta_title","type":"text"}]', 'ui', true, '0850a383641b2f06898a2e783ab920018b0b9436467f29371b4d61dfe97dd25e', 'applied', NOW(3), NOW(3), '{"icon":"Search","hidden":true}', 'Search metadata') ON DUPLICATE KEY UPDATE \`label\` = VALUES(\`label\`), \`fields\` = VALUES(\`fields\`), \`localized\` = VALUES(\`localized\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`updated_at\` = VALUES(\`updated_at\`), \`admin\` = VALUES(\`admin\`), \`description\` = VALUES(\`description\`)"`
    );
    expect(
      buildComponentMetadataUpsert(component, "sqlite")
    ).toMatchInlineSnapshot(
      `"INSERT INTO "dynamic_components" ("id", "slug", "label", "table_name", "fields", "source", "localized", "schema_hash", "migration_status", "created_at", "updated_at", "admin", "description") VALUES ('9277fdb3-f9a9-45cc-ced7-8929ff61f6b5', 'seo', 'SEO', 'comp_seo', '[{"name":"meta_title","type":"text"}]', 'ui', 1, '0850a383641b2f06898a2e783ab920018b0b9436467f29371b4d61dfe97dd25e', 'applied', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, '{"icon":"Search","hidden":true}', 'Search metadata') ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "localized" = EXCLUDED."localized", "schema_hash" = EXCLUDED."schema_hash", "updated_at" = EXCLUDED."updated_at", "admin" = EXCLUDED."admin", "description" = EXCLUDED."description""`
    );
  });

  it("bare entities, every kind and dialect", () => {
    const out = (["postgresql", "mysql", "sqlite"] as const).map(dialect => [
      buildCollectionMetadataUpsert(bare.collections[0], dialect),
      buildSingleMetadataUpsert(bare.singles[0], dialect),
      buildComponentMetadataUpsert(bare.components[0], dialect),
    ]);
    expect(out).toMatchInlineSnapshot(`
      [
        [
          "INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at") VALUES ('53f24013-2089-6311-d51f-d42597c2e3ad', 'notes', '{"singular":"Note","plural":"Notes"}'::jsonb, 'dc_notes', '[{"name":"body","type":"text"}]'::jsonb, 'ui', '6bdb66623a8e7cca6125c9f5bf58cbcc0293aa98ce05068cfa02f746798c987b', false, false, NULL, NULL, NULL, 'applied', now(), now()) ON CONFLICT ("slug") DO UPDATE SET "labels" = EXCLUDED."labels", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at"",
          "INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at") VALUES ('1e1d5b4a-c446-8ea0-e9cc-4bdd8333776e', 'home', 'Home', 'single_home', '[{"name":"hero","type":"text"}]'::jsonb, 'ui', 'aa895ea31e12f5da65afd1ff2be08b98377299118454f1343a701eb2a28df957', false, false, NULL, NULL, NULL, 'applied', now(), now()) ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at"",
          "INSERT INTO "dynamic_components" ("id", "slug", "label", "table_name", "fields", "source", "localized", "schema_hash", "migration_status", "created_at", "updated_at") VALUES ('f7629e5f-ae61-0000-a29d-d44b59a693d1', 'cta', 'Cta', 'comp_cta', '[{"name":"label","type":"text"}]'::jsonb, 'ui', false, '4f6ff50233192e2312354598dd0bfee77f008b3b49b2b2575973c48124bb6f3b', 'applied', now(), now()) ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "localized" = EXCLUDED."localized", "schema_hash" = EXCLUDED."schema_hash", "updated_at" = EXCLUDED."updated_at"",
        ],
        [
          "INSERT INTO \`dynamic_collections\` (\`id\`, \`slug\`, \`labels\`, \`table_name\`, \`fields\`, \`source\`, \`schema_hash\`, \`status\`, \`localized\`, \`versions\`, \`revalidate\`, \`webhooks\`, \`migration_status\`, \`created_at\`, \`updated_at\`) VALUES ('53f24013-2089-6311-d51f-d42597c2e3ad', 'notes', '{"singular":"Note","plural":"Notes"}', 'dc_notes', '[{"name":"body","type":"text"}]', 'ui', '6bdb66623a8e7cca6125c9f5bf58cbcc0293aa98ce05068cfa02f746798c987b', false, false, NULL, NULL, NULL, 'applied', NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE \`labels\` = VALUES(\`labels\`), \`fields\` = VALUES(\`fields\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`status\` = VALUES(\`status\`), \`localized\` = VALUES(\`localized\`), \`versions\` = VALUES(\`versions\`), \`revalidate\` = VALUES(\`revalidate\`), \`webhooks\` = VALUES(\`webhooks\`), \`updated_at\` = VALUES(\`updated_at\`)",
          "INSERT INTO \`dynamic_singles\` (\`id\`, \`slug\`, \`label\`, \`table_name\`, \`fields\`, \`source\`, \`schema_hash\`, \`status\`, \`localized\`, \`versions\`, \`revalidate\`, \`webhooks\`, \`migration_status\`, \`created_at\`, \`updated_at\`) VALUES ('1e1d5b4a-c446-8ea0-e9cc-4bdd8333776e', 'home', 'Home', 'single_home', '[{"name":"hero","type":"text"}]', 'ui', 'aa895ea31e12f5da65afd1ff2be08b98377299118454f1343a701eb2a28df957', false, false, NULL, NULL, NULL, 'applied', NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE \`label\` = VALUES(\`label\`), \`fields\` = VALUES(\`fields\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`status\` = VALUES(\`status\`), \`localized\` = VALUES(\`localized\`), \`versions\` = VALUES(\`versions\`), \`revalidate\` = VALUES(\`revalidate\`), \`webhooks\` = VALUES(\`webhooks\`), \`updated_at\` = VALUES(\`updated_at\`)",
          "INSERT INTO \`dynamic_components\` (\`id\`, \`slug\`, \`label\`, \`table_name\`, \`fields\`, \`source\`, \`localized\`, \`schema_hash\`, \`migration_status\`, \`created_at\`, \`updated_at\`) VALUES ('f7629e5f-ae61-0000-a29d-d44b59a693d1', 'cta', 'Cta', 'comp_cta', '[{"name":"label","type":"text"}]', 'ui', false, '4f6ff50233192e2312354598dd0bfee77f008b3b49b2b2575973c48124bb6f3b', 'applied', NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE \`label\` = VALUES(\`label\`), \`fields\` = VALUES(\`fields\`), \`localized\` = VALUES(\`localized\`), \`schema_hash\` = VALUES(\`schema_hash\`), \`updated_at\` = VALUES(\`updated_at\`)",
        ],
        [
          "INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at") VALUES ('53f24013-2089-6311-d51f-d42597c2e3ad', 'notes', '{"singular":"Note","plural":"Notes"}', 'dc_notes', '[{"name":"body","type":"text"}]', 'ui', '6bdb66623a8e7cca6125c9f5bf58cbcc0293aa98ce05068cfa02f746798c987b', 0, 0, NULL, NULL, NULL, 'applied', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000) ON CONFLICT ("slug") DO UPDATE SET "labels" = EXCLUDED."labels", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at"",
          "INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "fields", "source", "schema_hash", "status", "localized", "versions", "revalidate", "webhooks", "migration_status", "created_at", "updated_at") VALUES ('1e1d5b4a-c446-8ea0-e9cc-4bdd8333776e', 'home', 'Home', 'single_home', '[{"name":"hero","type":"text"}]', 'ui', 'aa895ea31e12f5da65afd1ff2be08b98377299118454f1343a701eb2a28df957', 0, 0, NULL, NULL, NULL, 'applied', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000) ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "schema_hash" = EXCLUDED."schema_hash", "status" = EXCLUDED."status", "localized" = EXCLUDED."localized", "versions" = EXCLUDED."versions", "revalidate" = EXCLUDED."revalidate", "webhooks" = EXCLUDED."webhooks", "updated_at" = EXCLUDED."updated_at"",
          "INSERT INTO "dynamic_components" ("id", "slug", "label", "table_name", "fields", "source", "localized", "schema_hash", "migration_status", "created_at", "updated_at") VALUES ('f7629e5f-ae61-0000-a29d-d44b59a693d1', 'cta', 'Cta', 'comp_cta', '[{"name":"label","type":"text"}]', 'ui', 0, '4f6ff50233192e2312354598dd0bfee77f008b3b49b2b2575973c48124bb6f3b', 'applied', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000) ON CONFLICT ("slug") DO UPDATE SET "label" = EXCLUDED."label", "fields" = EXCLUDED."fields", "localized" = EXCLUDED."localized", "schema_hash" = EXCLUDED."schema_hash", "updated_at" = EXCLUDED."updated_at"",
        ],
      ]
    `);
  });
});

describe("row values, before SQL rendering", () => {
  // The resolved configs the registry columns hold, as typed values rather
  // than SQL literals: retention set explicitly for the collection, the
  // default (50) for the single.
  const versionsWith = (maxPerDoc: number) => ({
    enabled: true,
    drafts: { enabled: false, autosave: { enabled: false, intervalMs: 1000 } },
    maxPerDoc,
  });

  it("collection: every column the upsert writes, with resolved configs", () => {
    // Strict equality, so a key the upsert omits must be absent rather than
    // present as undefined.
    expect(collectionRowValues(collection)).toStrictEqual({
      id: "6c40b281-8982-e16a-cbf8-25367498308f",
      slug: "blog-posts",
      labels: { singular: "Post", plural: "Author's Posts" },
      tableName: "dc_blog_posts",
      fields: collection.fields,
      source: "ui",
      schemaHash:
        "46eb09f492a2432c0baac950e339715a66a4f5d5d4528f4dcfccae5a3dc0947b",
      status: true,
      localized: true,
      versions: versionsWith(10),
      revalidate: { disable: true },
      webhooks: { record: false },
      migrationStatus: "applied",
      admin: { useAsTitle: "title", icon: "FileText", hidden: false, order: 2 },
      hooks: collection.hooks,
      description: "Editorial content",
    });
  });

  it("single: a singular label, no hooks key", () => {
    expect(singleRowValues(single)).toStrictEqual({
      id: "97551273-bba5-6cdb-e190-a09b16a53566",
      slug: "site-settings",
      label: "Site Setting",
      tableName: "single_site_settings",
      fields: single.fields,
      source: "ui",
      schemaHash:
        "cd8aa5a3d3f8705531c0be276d45df513ae84fdd18c37e0bcdfaaacf92a02938",
      status: true,
      localized: true,
      versions: versionsWith(50),
      revalidate: { disable: true },
      webhooks: { record: false },
      migrationStatus: "applied",
      admin: { icon: "Settings", sidebarGroup: "config" },
      description: "Site-wide settings",
    });
  });

  it("component: only the columns the component registry has", () => {
    expect(componentRowValues(component)).toStrictEqual({
      id: "9277fdb3-f9a9-45cc-ced7-8929ff61f6b5",
      slug: "seo",
      label: "SEO",
      tableName: "comp_seo",
      fields: component.fields,
      source: "ui",
      localized: true,
      schemaHash:
        "0850a383641b2f06898a2e783ab920018b0b9436467f29371b4d61dfe97dd25e",
      migrationStatus: "applied",
      admin: { icon: "Search", hidden: true },
      description: "Search metadata",
    });
  });

  it("bare entities: no conditional keys, null configs, false flags", () => {
    // The control for the three above: absent manifest settings leave the
    // conditional keys out entirely and the always-written ones at their
    // "no override" values, as the bare SQL above leaves those columns out.
    expect(collectionRowValues(bare.collections[0])).toStrictEqual({
      id: "53f24013-2089-6311-d51f-d42597c2e3ad",
      slug: "notes",
      labels: { singular: "Note", plural: "Notes" },
      tableName: "dc_notes",
      fields: bare.collections[0].fields,
      source: "ui",
      schemaHash:
        "6bdb66623a8e7cca6125c9f5bf58cbcc0293aa98ce05068cfa02f746798c987b",
      status: false,
      localized: false,
      versions: null,
      revalidate: null,
      webhooks: null,
      migrationStatus: "applied",
    });
    expect(singleRowValues(bare.singles[0])).not.toHaveProperty("admin");
    expect(componentRowValues(bare.components[0])).not.toHaveProperty(
      "description"
    );
  });

  it("an explicit null description is left out, as the SQL leaves it out", () => {
    const values = collectionRowValues({
      slug: "posts",
      description: null,
      fields: [],
    } as never);
    expect(values).not.toHaveProperty("description");
  });
});

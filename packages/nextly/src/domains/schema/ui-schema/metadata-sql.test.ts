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

describe("versions column", () => {
  const versioned = uiSchemaManifest.parse({
    collections: [
      { slug: "posts", versions: true, fields: [{ name: "t", type: "text" }] },
    ],
    singles: [
      { slug: "about", versions: true, fields: [{ name: "t", type: "text" }] },
    ],
    components: [],
  });

  // Every entity kind that can hold entries needs the column written, not just
  // the one the toggle was first wired for.
  const cases = [
    ["collection", buildCollectionMetadataUpsert, versioned.collections[0]],
    ["single", buildSingleMetadataUpsert, versioned.singles[0]],
  ] as const;

  for (const [kind, build, entity] of cases) {
    it(`${kind}: stores the resolved config, not the raw boolean`, () => {
      // Every runtime reader tests `versions.enabled`, so a bare `true` in the
      // column would read as unversioned.
      const sql = build(entity, "sqlite");
      expect(sql).toContain('"versions"');
      expect(sql).toContain('"enabled":true');
      expect(sql).not.toMatch(/"versions"[^,)]*\btrue\b/);
    });

    it(`${kind}: writes NULL when the entity is unversioned`, () => {
      // The column must be written even when off: an omitted column is left
      // untouched by the upsert's DO UPDATE SET, so turning the switch off
      // would never clear a previously versioned row.
      const off = { ...entity, versions: undefined };
      const sql = build(off, "sqlite");
      expect(sql).toContain('"versions"');
      expect(sql).toMatch(/NULL/);
    });

    it(`${kind}: keeps the column updatable on conflict`, () => {
      const sql = build(entity, "postgresql");
      expect(sql).toContain('"versions" = EXCLUDED."versions"');
    });
  }

  it("writes NULL for an explicit versions: false alongside status", () => {
    // The pair matters: `status: true` aliases to a versioned config in the
    // code-first resolver, so an explicit off has to win over the alias.
    const explicit = uiSchemaManifest.parse({
      collections: [
        {
          slug: "posts",
          status: true,
          versions: false,
          fields: [{ name: "t", type: "text" }],
        },
      ],
      singles: [],
      components: [],
    });

    const sql = buildCollectionMetadataUpsert(
      explicit.collections[0],
      "sqlite"
    );
    expect(sql).toContain('"versions"');
    expect(sql).not.toContain('"enabled":true');
  });

  it("rejects versions on a component", () => {
    // Components hold no entries of their own; their parent's versioning
    // covers them, so the key would persist a setting nothing reads.
    const parsed = uiSchemaManifest.safeParse({
      collections: [],
      singles: [],
      components: [
        { slug: "seo", versions: true, fields: [{ name: "t", type: "text" }] },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("stores the switch as history-only, not drafts", () => {
    // The control records saves so they can be restored and says so; the
    // code-first default of `true` would additionally turn drafts and autosave
    // on, which the help text explicitly disclaims.
    const sql = buildCollectionMetadataUpsert(
      versioned.collections[0],
      "sqlite"
    );
    expect(sql).toContain('"enabled":true');
    expect(sql).toMatch(/"drafts":\{[^}]*"enabled":false/);
  });

  it("does not enable versioning just because status is on", () => {
    // `status: true` aliases to a versioned config in the code-first resolver
    // for back-compat. Honouring that here would leave the Builder's switch
    // unable to turn versioning off on any Draft/Published entity.
    const statusOnly = uiSchemaManifest.parse({
      collections: [
        { slug: "posts", status: true, fields: [{ name: "t", type: "text" }] },
      ],
      singles: [],
      components: [],
    });

    const sql = buildCollectionMetadataUpsert(
      statusOnly.collections[0],
      "sqlite"
    );
    expect(sql).not.toContain('"enabled":true');
  });
});

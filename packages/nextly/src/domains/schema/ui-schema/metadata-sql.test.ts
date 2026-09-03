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

describe("revalidate column", () => {
  // Revalidation is on by default, so the manifest boolean is inverted from
  // versions: false persists the disable config, true/absent persists NULL.
  const off = uiSchemaManifest.parse({
    collections: [
      {
        slug: "posts",
        revalidate: false,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    singles: [
      {
        slug: "about",
        revalidate: false,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    components: [],
  });

  const on = uiSchemaManifest.parse({
    collections: [
      {
        slug: "posts",
        revalidate: true,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    singles: [
      {
        slug: "about",
        revalidate: true,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    components: [],
  });

  const cases = [
    ["collection", buildCollectionMetadataUpsert, off.collections[0]],
    ["single", buildSingleMetadataUpsert, off.singles[0]],
  ] as const;

  for (const [kind, build, entity] of cases) {
    it(`${kind}: stores the disable config when revalidation is off`, () => {
      // The write path reads `revalidate.disable`, so an off entity must land
      // the resolved config, not a bare boolean.
      const sql = build(entity, "sqlite");
      expect(sql).toContain('"revalidate"');
      expect(sql).toContain('"disable":true');
    });

    it(`${kind}: keeps the column updatable on conflict`, () => {
      const sql = build(entity, "postgresql");
      expect(sql).toContain('"revalidate" = EXCLUDED."revalidate"');
    });
  }

  const onCases = [
    ["collection", buildCollectionMetadataUpsert, on.collections[0]],
    ["single", buildSingleMetadataUpsert, on.singles[0]],
  ] as const;

  for (const [kind, build, entity] of onCases) {
    it(`${kind}: writes NULL when revalidation is on`, () => {
      // On is the default (standard tag busting), stored as NULL so no override
      // is persisted. The column must still be written, so flipping off later
      // is not left untouched by the upsert's DO UPDATE SET.
      const sql = build(entity, "sqlite");
      expect(sql).toContain('"revalidate"');
      expect(sql).not.toContain('"disable"');
      expect(sql).toMatch(/NULL/);
    });
  }

  it("rejects revalidate on a component", () => {
    // Components hold no entries and no registry row, so the key would persist
    // a setting nothing reads.
    const parsed = uiSchemaManifest.safeParse({
      collections: [],
      singles: [],
      components: [
        {
          slug: "seo",
          revalidate: false,
          fields: [{ name: "t", type: "text" }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("webhooks column", () => {
  // Recording is on by default, so the manifest boolean behaves like
  // revalidate: false persists the opt-out, true/absent persists NULL.
  const off = uiSchemaManifest.parse({
    collections: [
      {
        slug: "enquiries",
        webhooks: false,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    singles: [
      {
        slug: "contact",
        webhooks: false,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    components: [],
  });

  const on = uiSchemaManifest.parse({
    collections: [
      {
        slug: "posts",
        webhooks: true,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    singles: [
      {
        slug: "about",
        webhooks: true,
        fields: [{ name: "t", type: "text" }],
      },
    ],
    components: [],
  });

  const cases = [
    ["collection", buildCollectionMetadataUpsert, off.collections[0]],
    ["single", buildSingleMetadataUpsert, off.singles[0]],
  ] as const;

  for (const [kind, build, entity] of cases) {
    it(`${kind}: stores the opt-out when recording is off`, () => {
      // Boot reads `webhooks.record` back, so an off entity must land the
      // resolved config rather than a bare boolean.
      const sql = build(entity, "sqlite");
      expect(sql).toContain('"webhooks"');
      expect(sql).toContain('"record":false');
    });

    it(`${kind}: keeps the column updatable on conflict`, () => {
      const sql = build(entity, "postgresql");
      expect(sql).toContain('"webhooks" = EXCLUDED."webhooks"');
    });
  }

  const onCases = [
    ["collection", buildCollectionMetadataUpsert, on.collections[0]],
    ["single", buildSingleMetadataUpsert, on.singles[0]],
  ] as const;

  for (const [kind, build, entity] of onCases) {
    it(`${kind}: writes NULL when recording is on`, () => {
      // On is the default, stored as NULL so no override is persisted. The
      // column must still be written, or turning recording off later would be
      // left untouched by the upsert's DO UPDATE SET and the opt-out would be
      // silently discarded.
      const sql = build(entity, "sqlite");
      expect(sql).toContain('"webhooks"');
      expect(sql).not.toContain('"record"');
      expect(sql).toMatch(/NULL/);
    });
  }

  it("rejects webhooks on a component", () => {
    // Components emit no outbox events of their own — their writes are recorded
    // against the collection or single that embeds them — so the key would
    // persist a setting nothing reads.
    const parsed = uiSchemaManifest.safeParse({
      collections: [],
      singles: [],
      components: [
        {
          slug: "seo",
          webhooks: false,
          fields: [{ name: "t", type: "text" }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("escaping the values a Builder-authored entity can carry", () => {
  // A validation pattern is the ordinary way a backslash reaches this SQL.
  const PATTERN = "^\\d+$";
  const withPattern = {
    slug: "posts",
    fields: [{ name: "code", type: "text", options: { pattern: PATTERN } }],
  } as never;
  // What the fields column holds before any SQL quoting: JSON encodes the
  // backslash, so this already carries two characters where the pattern had one.
  const asJson = JSON.stringify([
    { name: "code", type: "text", options: { pattern: PATTERN } },
  ]);

  it("DOUBLES a backslash for MySQL, which reads one as an escape", () => {
    // 🔴 Under the default SQL mode MySQL consumes a level of backslash
    // escaping, so the JSON it stores is not the JSON that was written — or the
    // statement stops parsing. Either way it fails AFTER the table DDL in the
    // same file has already run, leaving the migration half applied.
    //
    // The expectation is COMPUTED rather than written out: an escape sequence
    // typed by hand is exactly the thing this test is about getting wrong.
    const sql = buildCollectionMetadataUpsert(withPattern, "mysql");
    expect(sql).toContain(asJson.replace(/\\/g, "\\\\"));
  });

  it("leaves it alone for PostgreSQL and SQLite, which store it verbatim", () => {
    // The control: a rule that doubled everywhere would corrupt these two, and
    // would still satisfy the assertion above.
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const sql = buildCollectionMetadataUpsert(withPattern, dialect);
      expect(sql).toContain(asJson);
      expect(sql).not.toContain(asJson.replace(/\\/g, "\\\\"));
    }
  });

  it("still doubles an apostrophe on every dialect", () => {
    // The other control: delegating must not have dropped the escaping that
    // was already right.
    for (const dialect of ["postgresql", "sqlite", "mysql"] as const) {
      const sql = buildCollectionMetadataUpsert(
        {
          slug: "posts",
          labels: { singular: "O'Reilly", plural: "x" },
          fields: [],
        } as never,
        dialect
      );
      expect(sql).toContain("O''Reilly");
    }
  });
});

/**
 * The schema fingerprint the check of every document compares: it moves when
 * anything a binding is judged against changes, a field group's fields
 * included, and stays put otherwise.
 */
import { SITE_SETTING_FIELD_SHAPES } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { schemaFingerprint, type FingerprintSources } from "./fingerprint";

const sources = (
  fieldGroupHash: string,
  overrides: Partial<FingerprintSources> = {}
): FingerprintSources => ({
  collections: async () => [{ slug: "posts", schemaHash: "c1" }],
  singles: async () => [{ slug: "site-settings", schemaHash: "s1" }],
  fieldGroups: async () => [{ slug: "seo", schemaHash: fieldGroupHash }],
  blocks: () => [{ name: "core/heading", props: { text: {} } }],
  ...overrides,
});

describe("the schema fingerprint", () => {
  it("is the same for the same schema", async () => {
    expect(await schemaFingerprint(sources("g1"))).toBe(
      await schemaFingerprint(sources("g1"))
    );
  });

  it("moves when a field group's fields change", async () => {
    // A field group renamed or retyped inside changes only its own hash; the
    // collections placing it keep theirs.
    expect(await schemaFingerprint(sources("g2"))).not.toBe(
      await schemaFingerprint(sources("g1"))
    );
  });

  it("moves when the site settings a page may bind change", async () => {
    const withSite = (names: string[]) =>
      sources("g1", {
        siteSettings: () => names.map(name => ({ name, type: "text" })),
      });
    expect(await schemaFingerprint(withSite(["applicationName"]))).not.toBe(
      await schemaFingerprint(withSite(["applicationName", "timezone"]))
    );
    // Unnamed, the settings are the engine's table, the one the save reads.
    expect(await schemaFingerprint(sources("g1"))).toBe(
      await schemaFingerprint(
        sources("g1", { siteSettings: () => SITE_SETTING_FIELD_SHAPES })
      )
    );
  });

  it("moves when a Single's fields change", async () => {
    const changed = sources("g1", {
      singles: async () => [{ slug: "site-settings", schemaHash: "s2" }],
    });
    expect(await schemaFingerprint(changed)).not.toBe(
      await schemaFingerprint(sources("g1"))
    );
  });

  it("moves when a named query's declared rows change", async () => {
    const rows = (fields: string[]) =>
      sources("g1", {
        namedQueries: () => [
          {
            name: "deals",
            rows: {
              key: "id",
              fields: fields.map(name => ({ name, type: "text" })),
            },
          },
        ],
      });
    expect(await schemaFingerprint(rows(["id", "title"]))).not.toBe(
      await schemaFingerprint(rows(["id"]))
    );
    // The control: the same rows give the same fingerprint.
    expect(await schemaFingerprint(rows(["id"]))).toBe(
      await schemaFingerprint(rows(["id"]))
    );
  });

  it("moves when the format of the index of where documents bind a Single changes", async () => {
    // A release raising the format checks every document once, which is what
    // fills the index on an upgraded site.
    const now = await schemaFingerprint(sources("g1"));
    vi.resetModules();
    vi.doMock("./uses", async importOriginal => ({
      ...(await importOriginal<typeof import("./uses")>()),
      BINDING_USES_FORMAT: 999,
    }));
    try {
      const raised = await import("./fingerprint");
      expect(await raised.schemaFingerprint(sources("g1"))).not.toBe(now);
    } finally {
      vi.doUnmock("./uses");
      vi.resetModules();
    }
  });
});

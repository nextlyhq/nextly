/**
 * @module domains/schema/ui-schema/cross-file.test
 * @since v0.0.3-alpha (Plan D2)
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";

import { validateCrossFile } from "./cross-file";

describe("validateCrossFile", () => {
  it("returns no issues for a clean config + manifest", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        {
          slug: "events",
          fields: [
            { name: "title", type: "text" },
            { name: "owner", type: "relationship", relationTo: "users" },
          ],
        },
      ],
    });
    const issues = validateCrossFile({
      codeCollectionSlugs: ["posts"],
      manifest,
    });
    expect(issues).toEqual([]);
  });

  it("flags a slug present in both code and UI", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [{ slug: "posts", fields: [{ name: "x", type: "text" }] }],
    });
    const issues = validateCrossFile({
      codeCollectionSlugs: ["posts"],
      manifest,
    });
    expect(issues.some(i => i.code === "NEXTLY_SCHEMA_SLUG_COLLISION")).toBe(
      true
    );
  });

  it("flags a relationTo that points at no known target", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        {
          slug: "events",
          fields: [
            { name: "owner", type: "relationship", relationTo: "ghosts" },
          ],
        },
      ],
    });
    const issues = validateCrossFile({
      codeCollectionSlugs: [],
      manifest,
    });
    expect(
      issues.some(i => i.code === "NEXTLY_SCHEMA_RELATION_TARGET_MISSING")
    ).toBe(true);
  });

  it("accepts relationTo pointing at a core table (users/media)", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        {
          slug: "events",
          fields: [{ name: "hero", type: "upload", relationTo: "media" }],
        },
      ],
    });
    expect(validateCrossFile({ codeCollectionSlugs: [], manifest })).toEqual(
      []
    );
  });

  it("accepts relationTo pointing at another UI collection", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        { slug: "venues", fields: [{ name: "name", type: "text" }] },
        {
          slug: "events",
          fields: [
            { name: "venue", type: "relationship", relationTo: "venues" },
          ],
        },
      ],
    });
    expect(validateCrossFile({ codeCollectionSlugs: [], manifest })).toEqual(
      []
    );
  });
});

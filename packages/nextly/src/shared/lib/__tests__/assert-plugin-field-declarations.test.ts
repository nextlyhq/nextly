/**
 * Boot runs each plugin field type's own declaration checks.
 *
 * A plugin's contributions arrive as raw configs — its type is not registered
 * when its module is evaluated, so it cannot route them through
 * `defineCollection`, which is where a code-first config is checked. Without
 * this gate a declaration the type rejects starts the app and fails per write
 * instead, which reports a schema defect to whoever is writing content.
 */
import { describe, expect, it, afterEach } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { assertPluginFieldDeclarations } from "../assert-plugin-field-declarations";

afterEach(() => {
  clearFieldTypes();
});

function registerDocument(): void {
  registerFieldType({
    type: "document",
    storage: "json",
    component: "@acme/docs/admin#DocumentInput",
    surfaces: ["entries", "singles", "components"],
    validateOptions(field) {
      const kinds = (field.policy as { kinds?: unknown } | undefined)?.kinds;
      return Array.isArray(kinds) && kinds.length === 0
        ? [{ path: "policy.kinds", message: "policy.kinds must name a kind" }]
        : true;
    },
  });
}

const badField = { name: "body", type: "document", policy: { kinds: [] } };

/** The issues a refusal carries, or `[]` when the config was accepted. */
function issuesOf(config: Parameters<typeof assertPluginFieldDeclarations>[0]) {
  try {
    assertPluginFieldDeclarations(config);
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as
      | { errors?: Array<{ path: string; message: string }> }
      | undefined;
    return data?.errors ?? [];
  }
  return [];
}

describe("plugin field declarations at boot", () => {
  it("refuses a raw contributed collection", () => {
    registerDocument();

    expect(
      issuesOf({ collections: [{ slug: "posts", fields: [badField] }] })
    ).toContainEqual(
      expect.objectContaining({
        path: "collections.posts.body.policy.kinds",
        message: "policy.kinds must name a kind.",
      })
    );
  });

  it("covers singles and components, not collections alone", () => {
    registerDocument();

    expect(
      issuesOf({ singles: [{ slug: "homepage", fields: [badField] }] })
    ).toHaveLength(1);
    expect(
      issuesOf({ components: [{ slug: "hero", fields: [badField] }] })
    ).toHaveLength(1);
  });

  it("reaches a field nested in a repeater", () => {
    registerDocument();

    expect(
      issuesOf({
        collections: [
          {
            slug: "posts",
            fields: [{ name: "rows", type: "repeater", fields: [badField] }],
          },
        ],
      })
    ).toContainEqual(
      expect.objectContaining({
        path: "collections.posts.rows.body.policy.kinds",
      })
    );
  });

  it("accepts a coherent declaration", () => {
    registerDocument();

    expect(
      issuesOf({
        collections: [
          {
            slug: "posts",
            fields: [
              { name: "body", type: "document", policy: { kinds: ["page"] } },
            ],
          },
        ],
      })
    ).toEqual([]);
  });

  it("says nothing about a schema carrying no plugin types", () => {
    // The reason this gate is safe to run at boot: only rules belonging to a
    // type registered in this same process can fire, so it cannot newly refuse
    // a schema that starts fine today.
    expect(
      issuesOf({
        collections: [
          { slug: "posts", fields: [{ name: "title", type: "text" }] },
        ],
      })
    ).toEqual([]);
  });
});

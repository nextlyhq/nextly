/**
 * The declaration checks reach every path a field can be authored through.
 *
 * A seam wired into only some of them is worse than none: a plugin would state
 * a rule, watch it refuse a code-first config, and then watch the Schema
 * Builder store the very declaration it rejects.
 */
import { describe, expect, it, afterEach } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { validateCollectionConfig } from "../../../collections/config/validate-config";
import type { CollectionConfig } from "../../../collections/config/define-collection";
import { validateComponentConfig } from "../../../components/config/validate-component";
import type { ComponentConfig } from "../../../components/config/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { uiSchemaFieldSchema } from "../../../schemas/_zod/ui-schema";
import { validateSingleConfig } from "../../../singles/config/validate-single";
import type { SingleConfig } from "../../../singles/config/types";

afterEach(() => {
  clearFieldTypes();
});

/**
 * A type that refuses an empty `kinds`, the shape of the rule core currently
 * hardcodes for blocks: a policy admitting no document at all means no value
 * could ever be stored, which is a contradiction in the declaration.
 */
function registerDocument(): void {
  registerFieldType({
    type: "document",
    storage: "json",
    component: "@acme/docs/admin#DocumentInput",
    surfaces: ["entries", "singles", "components"],
    validateOptions(field) {
      // Reads either key: `policy` is the type's own option (code-first only,
      // since the manifest strips it) and `blocks` is one the manifest
      // declares, which is the only shape reachable on the Builder path.
      const key = field.policy !== undefined ? "policy" : "blocks";
      const policy = field.policy ?? field.blocks;
      if (policy === undefined) return true;
      if (policy === null || typeof policy !== "object") {
        return [{ path: key, message: `${key} must be an object` }];
      }
      const kinds = (policy as { kinds?: unknown }).kinds;
      if (Array.isArray(kinds) && kinds.length === 0) {
        return [
          {
            path: `${key}.kinds`,
            code: "EMPTY_POLICY",
            message: `${key}.kinds must name at least one kind`,
          },
        ];
      }
      return true;
    },
  });
}

const badField = {
  name: "body",
  type: "document",
  policy: { kinds: [] },
};

describe("declaration checks reach every authoring path", () => {
  it("refuses a code-first collection field", () => {
    registerDocument();

    const result = validateCollectionConfig({
      slug: "posts",
      fields: [badField],
    } as unknown as CollectionConfig);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "fields[0].policy.kinds",
        // The canonical member, not the plugin's `EMPTY_POLICY`: this result's
        // `code` is a closed union that consumers switch on exhaustively.
        code: "FIELD_TYPE_INVALID",
        message: "policy.kinds must name at least one kind.",
      })
    );
  });

  it("refuses the declaration through defineCollection itself", () => {
    // The validator is reached through the define call, which is where a
    // code-first config is actually checked. Registration has to have happened
    // by the time the config module evaluates — the same condition the field
    // type is already under, since an unregistered type is refused outright.
    registerDocument();

    expect(() =>
      defineCollection({
        slug: "posts",
        fields: [badField],
      } as unknown as CollectionConfig)
    ).toThrow(/policy\.kinds must name at least one kind/);
  });

  it("refuses a code-first single field", () => {
    registerDocument();

    const result = validateSingleConfig({
      slug: "homepage",
      fields: [badField],
    } as unknown as SingleConfig);

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain("fields[0].policy.kinds");
  });

  it("refuses a code-first component field", () => {
    registerDocument();

    const result = validateComponentConfig({
      slug: "hero",
      fields: [badField],
    } as unknown as ComponentConfig);

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain("fields[0].policy.kinds");
  });

  it("refuses a Schema Builder save whose declared option is wrong", () => {
    registerDocument();

    // `blocks` is one of the option keys the manifest declares, so it is the
    // one shape a plugin type's check can currently see on this path.
    const parsed = uiSchemaFieldSchema.safeParse({
      name: "body",
      type: "document",
      blocks: { kinds: [] },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    // Zod reports path segments rather than a dotted string, so a returned
    // option path has to survive the split to land on the right admin control.
    // The message matters as much as the path: the manifest has its own
    // `blocks.kinds` rule reporting at exactly this path, so asserting the path
    // alone would pass with the plugin hook removed entirely.
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["blocks", "kinds"],
        message: "blocks.kinds must name at least one kind.",
      })
    );
  });

  it("cannot yet see an option key the manifest does not declare", () => {
    registerDocument();

    // The manifest object strips unknown keys, and it does so deliberately:
    // an undeclared `blocks` would be dropped and persist a field accepting
    // everything the submitted schema meant to exclude. The cost is that a
    // plugin type's OWN options never reach the stored manifest either, so
    // there is nothing for its check to read here.
    //
    // This is why the same declaration is refused code-first and accepted by
    // the Builder. Closing it needs a generic options bag in the manifest,
    // which is a change to the persisted schema format.
    const parsed = uiSchemaFieldSchema.safeParse(badField);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("policy");
  });

  it("accepts the same field once its declaration is coherent", () => {
    registerDocument();
    const good = {
      name: "body",
      type: "document",
      policy: { kinds: ["page"] },
    };

    expect(
      validateCollectionConfig({
        slug: "posts",
        fields: [good],
      } as unknown as CollectionConfig).valid
    ).toBe(true);
    // Through a declared key, so this exercises the check rather than passing
    // because the option was stripped before it ran.
    expect(
      uiSchemaFieldSchema.safeParse({
        name: "body",
        type: "document",
        blocks: { kinds: ["page"] },
      }).success
    ).toBe(true);
  });
});

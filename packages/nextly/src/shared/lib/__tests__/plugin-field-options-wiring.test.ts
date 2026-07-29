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
import type { FieldGroupConfig } from "../../../components/config/types";
import { validateFieldGroupConfig } from "../../../components/config/validate-field-group";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { assertValidFieldsPayload } from "../../../api/fields-payload";
import { NextlyError } from "../../../errors/nextly-error";
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

/** The `{path, message}` issues a validation refusal carries. */
function issuesOfPayload(
  fields: unknown
): Array<{ path: string; code: string; message: string }> {
  try {
    assertValidFieldsPayload(fields);
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as
      | { errors?: Array<{ path: string; code: string; message: string }> }
      | undefined;
    return data?.errors ?? [];
  }
  return [];
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

  it("refuses a code-first field-group field", () => {
    registerDocument();

    const result = validateFieldGroupConfig({
      slug: "hero",
      fields: [badField],
    } as unknown as FieldGroupConfig);

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain("fields[0].policy.kinds");
  });

  it("refuses a Schema Builder write, reading the payload that gets stored", () => {
    registerDocument();

    // The API validates a parsed copy but persists the ORIGINAL, so a plugin
    // type's options reach the database even though the manifest schema strips
    // them. Checking the parsed copy would approve a field with its options
    // removed and then store the ones it never saw.
    expect(issuesOfPayload([badField])).toContainEqual({
      path: "0.policy.kinds",
      code: "FIELD_TYPE_INVALID",
      message: "policy.kinds must name at least one kind.",
    });
  });

  it("locates the issue on a field nested in a repeater", () => {
    registerDocument();

    expect(
      issuesOfPayload([{ name: "rows", type: "repeater", fields: [badField] }])
    ).toContainEqual(
      expect.objectContaining({ path: "0.fields.0.policy.kinds" })
    );
  });

  it("does not descend into a plugin type's own `fields` option", () => {
    registerDocument();
    registerFieldType({
      type: "layout",
      storage: "json",
      component: "@acme/layout/admin#LayoutInput",
      surfaces: ["entries"],
    });

    // `fields` here is the layout type's private configuration, not a Nextly
    // container, so another type's rules must not be applied to its entries.
    expect(
      issuesOfPayload([{ name: "grid", type: "layout", fields: [badField] }])
    ).toEqual([]);
  });

  it("strips the option from the manifest copy, which is why the check reads the original", () => {
    registerDocument();

    // Pins the stripping this arrangement exists because of: the parsed field
    // has no `policy` at all, so a check run against it could never fire.
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
    expect(
      issuesOfPayload([
        { name: "body", type: "document", policy: { kinds: ["page"] } },
      ])
    ).toEqual([]);
  });
});

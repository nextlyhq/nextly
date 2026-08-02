import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import type { DesiredSchema } from "../../pipeline/types";
import { resolveBuilderTextWidths } from "../builder-text-width";
import { getColumnDescriptor } from "../field-column-descriptor";

/**
 * The desired schema declares its fields as `FieldConfig` while the descriptor reads them as
 * `FieldDefinition`. `build-from-fields.ts` converts at exactly this boundary for the same reason,
 * so the assertions below go through the descriptor rather than reading the marker property:
 * the column a field produces is the contract, and how the width is recorded is not.
 */
function mysqlType(field: FieldConfig): string | undefined {
  return getColumnDescriptor(
    field as unknown as Parameters<typeof getColumnDescriptor>[0],
    "mysql"
  )?.dialectType;
}

function textField(extra: Record<string, unknown> = {}): FieldConfig {
  return { name: "body", type: "text", ...extra } as unknown as FieldConfig;
}

function schemaWith(
  entity: Partial<DesiredSchema["singles"][string]>
): DesiredSchema {
  return {
    collections: {},
    singles: {
      page: {
        slug: "page",
        tableName: "single_page",
        fields: [],
        ...entity,
      },
    },
    components: {},
  };
}

describe("resolveBuilderTextWidths", () => {
  // MySQL renders the two kinds 255 characters apart, which is the whole reason this exists.
  it("leaves a builder-owned text field unbounded on MySQL", () => {
    const desired = schemaWith({ fields: [textField()] });

    resolveBuilderTextWidths(desired);

    expect(mysqlType(desired.singles.page.fields[0])).toBe("text");
  });

  // A locked entity's columns were built by the path whose default is the bounded kind, so
  // rewriting them would make every code-first table read as drift.
  it("leaves a locked entity on the bounded default", () => {
    const desired = schemaWith({ fields: [textField()], locked: true });

    resolveBuilderTextWidths(desired);

    expect(mysqlType(desired.singles.page.fields[0])).toBe("varchar(255)");
  });

  it("resolves every entity, not only the one being saved", () => {
    const desired: DesiredSchema = {
      collections: {
        posts: { slug: "posts", tableName: "dc_posts", fields: [textField()] },
      },
      singles: {},
      components: {
        hero: { slug: "hero", tableName: "comp_hero", fields: [textField()] },
      },
    };

    resolveBuilderTextWidths(desired);

    expect(mysqlType(desired.collections.posts.fields[0])).toBe("text");
    expect(mysqlType(desired.components.hero.fields[0])).toBe("text");
  });

  it.each([
    ["a stated variant", { options: { variant: "short" } }],
    ["a top-level length", { length: 80 }],
    ["a validation maxLength", { validation: { maxLength: 80 } }],
  ])("treats %s as the author's answer and leaves it bounded", (_, extra) => {
    const desired = schemaWith({ fields: [textField(extra)] });

    resolveBuilderTextWidths(desired);

    expect(mysqlType(desired.singles.page.fields[0])).toBe("varchar(255)");
  });

  // An array cannot carry a variant, and overwriting it with one would discard whatever it held.
  it("leaves a text field whose options is an array untouched", () => {
    const field = textField({ options: [{ label: "A", value: "a" }] });
    const desired = schemaWith({ fields: [field] });

    resolveBuilderTextWidths(desired);

    expect(desired.singles.page.fields[0]).toBe(field);
  });

  it("does not widen a type whose width is settled by what it holds", () => {
    const desired = schemaWith({
      fields: [
        { name: "email", type: "email" } as unknown as FieldConfig,
        { name: "password", type: "password" } as unknown as FieldConfig,
      ],
    });

    resolveBuilderTextWidths(desired);

    for (const field of desired.singles.page.fields) {
      expect(mysqlType(field)).toBe("varchar(255)");
    }
  });
});

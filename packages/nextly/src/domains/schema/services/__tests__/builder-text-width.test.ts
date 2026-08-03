import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";

import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import type { DesiredSchema } from "../../pipeline/types";
import { withResolvedBuilderTextWidths } from "../builder-text-width";

function textField(extra: Record<string, unknown> = {}) {
  return { name: "body", type: "text", ...extra };
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
        builderOwned: true,
        ...entity,
      },
    },
    components: {},
  };
}

/** What the diff would compare, for the resolved schema's one single. */
function bodyType(desired: DesiredSchema): string | undefined {
  const single = desired.singles.page;
  return buildDesiredTableFromFields(
    single.tableName,
    single.fields as unknown as Parameters<
      typeof buildDesiredTableFromFields
    >[1],
    "mysql"
  ).columns.find(c => c.name === "body")?.type;
}

afterEach(() => {
  clearFieldTypes();
});

describe("withResolvedBuilderTextWidths", () => {
  // MySQL is the only dialect where the two readings differ, and there they are 65 535 and 255.
  it("gives a builder-owned text field an unbounded column", () => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({ fields: [textField()] as never })
    );

    expect(bodyType(resolved)).toBe("text");
  });

  // Code-first columns were built by the path whose default is bounded, so rewriting them would
  // make every code-first table read as drift. Ownership is never inferred: most snapshot builders
  // state nothing, and anything other than an explicit yes has to mean code-first.
  it.each([
    ["states code ownership", { builderOwned: false }],
    ["states nothing at all", { builderOwned: undefined }],
  ])("leaves an entity that %s on the bounded default", (_, ownership) => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({ fields: [textField()] as never, ...ownership })
    );

    expect(bodyType(resolved)).toBe("varchar(255)");
  });

  it("keeps a stated short variant bounded", () => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({
        fields: [textField({ options: { variant: "short" } })] as never,
      })
    );

    expect(bodyType(resolved)).toBe("varchar(255)");
  });

  // A width the descriptor cannot render must not be read as a decision to stay bounded: doing so
  // left a field declaring 500 characters in a varchar(255) column that rejects values its own
  // stored validation limit accepts.
  it.each([
    ["a validation maxLength", { validation: { maxLength: 500 } }],
    ["a top-level length", { length: 500 }],
  ])("does not treat %s as a reason to stay bounded", (_, extra) => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({ fields: [textField(extra)] as never })
    );

    expect(bodyType(resolved)).toBe("text");
  });

  it("resolves every entity kind, not only the one being saved", () => {
    const resolved = withResolvedBuilderTextWidths({
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [textField()] as never,
          builderOwned: true,
        },
      },
      singles: {},
      components: {
        hero: {
          slug: "hero",
          tableName: "comp_hero",
          fields: [textField()] as never,
          builderOwned: true,
        },
      },
    });

    for (const entity of [
      resolved.collections.posts,
      resolved.components.hero,
    ]) {
      expect(entity.fields[0]).toMatchObject({ options: { variant: "long" } });
    }
  });

  // The caller's schema is often the registry's own objects, and a preview must leave nothing
  // changed behind it.
  it("does not mutate the schema it is given", () => {
    const original = schemaWith({ fields: [textField()] as never });

    withResolvedBuilderTextWidths(original);

    expect(original.singles.page.fields[0]).not.toHaveProperty(
      "options.variant"
    );
  });

  it("returns the same entity object when nothing needed resolving", () => {
    const original = schemaWith({
      fields: [{ name: "n", type: "number" }] as never,
    });

    const resolved = withResolvedBuilderTextWidths(original);

    expect(resolved.singles.page).toBe(original.singles.page);
  });

  // An array cannot carry a variant, and overwriting it with one would discard whatever it held.
  it("leaves a text field whose options is an array untouched", () => {
    const choices = [{ label: "A", value: "a" }];
    const original = schemaWith({
      fields: [textField({ options: choices })] as never,
    });

    const resolved = withResolvedBuilderTextWidths(original);

    expect(resolved.singles.page.fields[0]).toHaveProperty("options", choices);
  });

  // A contributed type declaring `storage: "text"` reaches the database through the same column as
  // a plain text field — both generators resolve it that way before rendering — so matching the
  // declared token alone left it bounded while the table held an unbounded column.
  it("resolves a contributed type to what it stores", () => {
    registerFieldType({
      type: "color-swatch",
      storage: "text",
      component: "@acme/swatch/admin#ColorSwatch",
    });

    const resolved = withResolvedBuilderTextWidths(
      schemaWith({
        fields: [{ name: "swatch", type: "color-swatch" }] as never,
      })
    );

    expect(
      buildDesiredTableFromFields(
        "single_page",
        resolved.singles.page.fields as unknown as Parameters<
          typeof buildDesiredTableFromFields
        >[1],
        "mysql"
      ).columns.find(c => c.name === "swatch")?.type
    ).toBe("text");
  });

  // The two generators read a declared width from different places, so this must too. A field
  // group's generator bounds a column on a top-level maxLength; a collection's does not, and would
  // leave the same field unbounded.
  it("leaves a field group's declared maxLength bounded", () => {
    const resolved = withResolvedBuilderTextWidths({
      collections: {},
      singles: {},
      components: {
        hero: {
          slug: "hero",
          tableName: "comp_hero",
          fields: [{ name: "body", type: "text", maxLength: 120 }] as never,
          builderOwned: true,
        },
      },
    });

    expect(resolved.components.hero.fields[0]).not.toMatchObject({
      options: { variant: "long" },
    });
  });

  it("still widens a collection field carrying only a maxLength", () => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({
        fields: [{ name: "body", type: "text", maxLength: 120 }] as never,
      })
    );

    expect(bodyType(resolved)).toBe("text");
  });

  it("does not widen a type whose width is settled by what it holds", () => {
    const resolved = withResolvedBuilderTextWidths(
      schemaWith({
        fields: [
          { name: "email", type: "email" },
          { name: "choice", type: "select" },
        ] as never,
      })
    );

    const table = buildDesiredTableFromFields(
      "single_page",
      resolved.singles.page.fields as unknown as Parameters<
        typeof buildDesiredTableFromFields
      >[1],
      "mysql"
    );

    for (const name of ["email", "choice"]) {
      expect(table.columns.find(c => c.name === name)?.type).toBe(
        "varchar(255)"
      );
    }
  });
});

import { describe, expect, it } from "vitest";

import type { DesiredSchema } from "../../pipeline/types";
import { resolveBuilderTextWidths } from "../builder-text-width";
import { getColumnDescriptor } from "../field-column-descriptor";

function schemaWith(entity: Partial<DesiredSchema["singles"][string]>) {
  const desired: DesiredSchema = {
    collections: {},
    singles: {},
    components: {},
  };
  desired.singles.page = {
    slug: "page",
    tableName: "single_page",
    fields: [],
    ...entity,
  } as DesiredSchema["singles"][string];
  return desired;
}

function textField(extra: Record<string, unknown> = {}) {
  return { name: "body", type: "text", ...extra };
}

describe("resolveBuilderTextWidths", () => {
  it("states long for a builder-owned text field that declares no width", () => {
    const desired = schemaWith({ fields: [textField()] });

    resolveBuilderTextWidths(desired);

    expect(desired.singles.page.fields[0]).toMatchObject({
      options: { variant: "long" },
    });
  });

  // The reason this exists: a locked entity's columns were built by the path whose default is the
  // bounded kind, so rewriting them would make every code-first table read as drift.
  it("leaves a locked entity alone", () => {
    const desired = schemaWith({ fields: [textField()], locked: true });

    resolveBuilderTextWidths(desired);

    expect(desired.singles.page.fields[0]).not.toHaveProperty(
      "options.variant"
    );
  });

  it("resolves every entity, not only the one being saved", () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [textField()],
        } as DesiredSchema["collections"][string],
      },
      singles: {},
      components: {
        hero: {
          slug: "hero",
          tableName: "comp_hero",
          fields: [textField()],
        } as DesiredSchema["components"][string],
      },
    };

    resolveBuilderTextWidths(desired);

    expect(desired.collections.posts.fields[0]).toMatchObject({
      options: { variant: "long" },
    });
    expect(desired.components.hero.fields[0]).toMatchObject({
      options: { variant: "long" },
    });
  });

  it.each([
    ["a stated variant", { options: { variant: "short" } }],
    ["a top-level length", { length: 80 }],
    ["a validation maxLength", { validation: { maxLength: 80 } }],
  ])("treats %s as the author's answer and leaves it", (_, extra) => {
    const desired = schemaWith({ fields: [textField(extra)] });

    resolveBuilderTextWidths(desired);

    expect(desired.singles.page.fields[0]).not.toMatchObject({
      options: { variant: "long" },
    });
  });

  // An array cannot carry a variant, and overwriting it with one would discard whatever it held.
  it("leaves a text field whose options is an array untouched", () => {
    const choices = [{ label: "A", value: "a" }];
    const desired = schemaWith({
      fields: [
        { name: "body", type: "text", options: choices },
      ] as DesiredSchema["singles"][string]["fields"],
    });

    resolveBuilderTextWidths(desired);

    expect(desired.singles.page.fields[0].options).toBe(choices);
  });

  // `options` is the choice array on a select, so a variant can only ever live on an object.
  it("does not turn a select's options array into an object", () => {
    const desired = schemaWith({
      fields: [
        {
          name: "choice",
          type: "select",
          options: [{ label: "A", value: "a" }],
        },
      ] as DesiredSchema["singles"][string]["fields"],
    });

    resolveBuilderTextWidths(desired);

    expect(Array.isArray(desired.singles.page.fields[0].options)).toBe(true);
  });

  it("does not widen a type whose width is settled by what it holds", () => {
    const desired = schemaWith({
      fields: [
        { name: "email", type: "email" },
        { name: "password", type: "password" },
      ] as DesiredSchema["singles"][string]["fields"],
    });

    resolveBuilderTextWidths(desired);

    for (const field of desired.singles.page.fields) {
      expect(field).not.toMatchObject({ options: { variant: "long" } });
    }
  });

  // Why any of this matters: MySQL renders the two kinds 255 characters apart.
  it("keeps a builder text column unbounded on MySQL", () => {
    expect(
      getColumnDescriptor({ name: "body", type: "text" }, "mysql")?.dialectType
    ).toBe("varchar(255)");

    const desired = schemaWith({ fields: [textField()] });
    resolveBuilderTextWidths(desired);

    expect(
      getColumnDescriptor(
        desired.singles.page.fields[0] as Parameters<
          typeof getColumnDescriptor
        >[0],
        "mysql"
      )?.dialectType
    ).toBe("text");
  });
});

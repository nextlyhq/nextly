import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { TypeGenerator } from "../../../domains/schema/services/type-generator";
/**
 * The generated `Config` map and the types that read it form a contract split
 * across two files, and TypeScript cannot enforce it: `FieldGroupSlug` is a
 * conditional on `GeneratedTypes extends { fieldGroups: infer C }`, so if the
 * generator emits a different key the conditional quietly takes its fallback
 * branch and every slug widens to `string`. Nothing fails to compile — the
 * type safety is simply gone.
 *
 * This file pins the half that can be checked at runtime: the key and interface
 * names the generator actually writes. The compile-time half — that the exported
 * aliases read that same key — lives in `../field-group-slug.test-d.ts`, because
 * tsconfig excludes `*.test.ts` and type assertions here would never be checked.
 */

const fieldGroup = (slug: string) =>
  ({ slug, label: slug, fields: [] }) as never;

const collection = (slug: string) =>
  ({
    slug,
    labels: { singular: slug, plural: slug },
    fields: [],
  }) as never;

/** A field as the generator reads it: a name and a type are all it consults. */
type Field = { name: string; type: string };

const datedCollection = (slug: string, fields: Field[]) =>
  ({
    slug,
    labels: { singular: slug, plural: slug },
    fields,
    timestamps: true,
  }) as never;

const untimestampedCollection = (slug: string, fields: Field[]) =>
  ({
    slug,
    labels: { singular: slug, plural: slug },
    fields,
    timestamps: false,
  }) as never;

const single = (slug: string, fields: Field[]) =>
  ({ slug, label: slug, fields }) as never;

describe("generated Config contract", () => {
  it("emits the key the Direct API slug types read", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [],
      [],
      [fieldGroup("seo"), fieldGroup("hero")]
    );

    // The literal key, not a paraphrase: `FieldGroupSlug` matches on it exactly.
    expect(code).toContain("fieldGroups: {");
    expect(code).toContain('"seo": SeoFieldGroup;');
    expect(code).toContain('"hero": HeroFieldGroup;');
  });

  it("names generated interfaces with the FieldGroup suffix", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [],
      [],
      [fieldGroup("seo")]
    );

    expect(code).toContain("export interface SeoFieldGroup");
    expect(code).not.toContain("SeoComponent");
  });

  it("fails when a field group and an entity generate the same interface", () => {
    // Distinct slugs, identical generated name: the `FieldGroup` suffix this
    // appends is itself a legal part of a collection slug. TypeScript would
    // merge the two declarations instead of rejecting them, so each Config
    // entry would silently acquire the other's fields.

    expect(() =>
      new TypeGenerator().generateTypesFile(
        [collection("seo-field-group")],
        [],
        [fieldGroup("seo")]
      )
    ).toThrow(NextlyError);
  });

  it("names both sides of a collision in the failure detail", () => {
    try {
      new TypeGenerator().generateTypesFile(
        [collection("seo-field-group")],
        [],
        [fieldGroup("seo")]
      );
      expect.unreachable("expected a generated-name collision");
    } catch (error) {
      const detail = JSON.stringify(error);
      expect(detail).toContain("SeoFieldGroup");
      expect(detail).toContain("GENERATED_TYPE_NAME_COLLISION");
    }
  });

  it("allows names that do not collide", () => {
    expect(() =>
      new TypeGenerator().generateTypesFile(
        [collection("pages")],
        [],
        [fieldGroup("seo")]
      )
    ).not.toThrow();
  });
});

/**
 * The other half of the same split contract: `RowFromCollectionSlug` is a
 * conditional on `GeneratedTypes extends { collectionDateFields: infer D }`, so
 * a renamed key silently takes the fallback branch and every row loses the
 * fields codegen knows about. Nothing fails to compile.
 *
 * The compile-time half lives in `../in-process-row.test-d.ts`.
 */
describe("generated date-field contract", () => {
  it("emits the key the in-process row types read, with the built-in timestamps", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [datedCollection("posts", [])],
      [single("settings", [])]
    );

    // The literal keys, not a paraphrase: the conditionals match on them exactly.
    expect(code).toContain("collectionDateFields: {");
    expect(code).toContain('"posts": "createdAt" | "updatedAt";');
    expect(code).toContain("singleDateFields: {");
    // Empty, and deliberately so. A single is read through a deserializer that
    // normalizes its system timestamps to ISO strings, so `updatedAt` is a
    // string in process and naming it would type every single wrongly.
    expect(code).toContain('"settings": never;');
  });

  it("names a date field alongside the built-in timestamps", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      datedCollection("posts", [
        { name: "title", type: "text" },
        { name: "publishedAt", type: "date" },
      ]),
    ]);

    expect(code).toContain(
      '"posts": "createdAt" | "updatedAt" | "publishedAt";'
    );
    // The field a date field is NOT: a text column comes back as text.
    expect(code).not.toContain('"title"');
  });

  it("names a single's own date field, which the deserializer leaves decoded", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [],
      [single("site-config", [{ name: "launchedAt", type: "date" }])]
    );

    expect(code).toContain('"site-config": "launchedAt";');
  });

  it("says never for a collection with no date-backed field at all", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      // `timestamps: false` removes the built-ins too, which is the only way to
      // reach an empty set.
      untimestampedCollection("events", [{ name: "label", type: "text" }]),
    ]);

    // `never` leaves the row type equal to the wire type, rather than mapping
    // every key through the date branch.
    expect(code).toContain('"events": never;');
  });

  it("leaves the wire interface describing a timestamp as a string", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      datedCollection("posts", [{ name: "publishedAt", type: "date" }]),
    ]);

    // The REST response is formatted text, so a timestamp is spelled as a
    // string there and must not follow the row type to `Date`. This pins the
    // REPRESENTATION only: how the emission spells nullability is a separate
    // question about every optional field, not about timestamps.
    expect(code).toContain("  createdAt: string;");
    // The nullability spelling is deliberately not pinned here, per the note
    // above: a nullable column earns `| null` on every optional field, which is
    // a claim about optionality rather than about how a timestamp is spelled.
    // What must not drift is `string` rather than `Date`, so that is asserted
    // in both directions.
    expect(code).toMatch(/ {2}publishedAt\?: string( \| null)?;/);
    expect(code).not.toContain("publishedAt?: Date");
    expect(code).not.toContain("createdAt: Date");
  });
});

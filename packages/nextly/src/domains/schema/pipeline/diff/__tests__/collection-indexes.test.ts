/**
 * Compound indexes a collection's config declared.
 *
 * `CollectionConfig.indexes` has been validated and then thrown away since it
 * was introduced, so an app that declared one has been running without it.
 * These cover the emission and, as importantly, the refusals: an index that
 * silently does not exist is discovered on the first duplicate row.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../../errors/nextly-error";
import { buildDesiredTableFromFields } from "../build-from-fields";

const FIELDS = [
  { name: "country", type: "text" },
  { name: "city", type: "text" },
  { name: "bio", type: "textarea" },
  { name: "meta", type: "json" },
  { name: "author", type: "relationship", relationTo: "authors" },
] as never;

function build(indexes: unknown, extra: Record<string, unknown> = {}) {
  return buildDesiredTableFromFields("dc_places", FIELDS, "postgresql", {
    builtBy: "codeFirst",
    ...(indexes !== undefined ? { indexes } : {}),
    ...extra,
  } as never);
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

describe("declared compound indexes", () => {
  it("emits one unique index over the ordered columns", () => {
    const table = build([{ fields: ["country", "city"], unique: true }]);
    const declared = (table.indexes ?? []).find(i => i.columns.length === 2);
    // Order preserved: only (country, city) serves a left-prefix lookup on
    // country, so the pair is not interchangeable.
    expect(declared?.columns).toEqual(["country", "city"]);
    expect(declared?.unique).toBe(true);
  });

  it("gives (a,b) and (b,a) different names", () => {
    const forwards = build([{ fields: ["country", "city"] }]);
    const backwards = build([{ fields: ["city", "country"] }]);
    const nameOf = (t: ReturnType<typeof build>) =>
      (t.indexes ?? []).find(i => i.columns.length === 2)?.name;
    expect(nameOf(backwards)).not.toBe(nameOf(forwards));
  });

  it("honours an explicit name with a managed prefix", () => {
    const table = build([
      { fields: ["country", "city"], name: "idx_places_where" },
    ]);
    expect((table.indexes ?? []).map(i => i.name)).toContain(
      "idx_places_where"
    );
  });

  it("emits nothing extra when no indexes are declared", () => {
    // The control: whatever the declared-index path does, it must not change
    // the indexes a collection already got.
    const withNone = build(undefined);
    const withEmpty = build([]);
    expect((withEmpty.indexes ?? []).map(i => i.name).sort()).toEqual(
      (withNone.indexes ?? []).map(i => i.name).sort()
    );
  });
});

describe("refusals", () => {
  it("refuses a field the entity does not declare", () => {
    expect(refusal(() => build([{ fields: ["ghost"] }]))).toMatch(
      /does not declare/
    );
  });

  it("refuses a localized field, whose column lives in the companion", () => {
    expect(
      refusal(() =>
        build([{ fields: ["country"] }], {
          localized: true,
        })
      )
    ).toMatch(/_locales/);
  });

  it("refuses a JSON column, which MySQL cannot index", () => {
    // Applied for ALL dialects even though this build is Postgres: an index
    // that works only where its author develops is a deployment failure with
    // no local reproduction.
    expect(refusal(() => build([{ fields: ["meta"] }]))).toMatch(
      /mysql cannot index a "json" column \("meta"\)/
    );
  });

  it("refuses an unbounded text column", () => {
    expect(refusal(() => build([{ fields: ["bio"] }]))).toMatch(
      /mysql cannot key a "longText" column \("bio"\)/
    );
  });

  it("refuses a compound key wider than MySQL allows, and accepts one that fits", () => {
    // Each text field is keyable alone — varchar(255) on MySQL, 1,020 bytes
    // under utf8mb4 — and four of them are 4,080 bytes, past InnoDB's 3,072.
    const wide = [
      { name: "a", type: "text" },
      { name: "b", type: "text" },
      { name: "c", type: "text" },
      { name: "d", type: "text" },
    ] as never;
    const declare = (fields: string[]) =>
      buildDesiredTableFromFields("dc_wide", wide, "postgresql", {
        builtBy: "codeFirst",
        indexes: [{ fields }],
      } as never);
    expect(refusal(() => declare(["a", "b", "c", "d"]))).toMatch(
      /mysql limits an index key to 3072 bytes; this index declares 4080/
    );
    // Three are 3,060 bytes, inside the limit.
    expect(
      (declare(["a", "b", "c"]).indexes ?? []).some(
        index => index.columns.length === 3
      )
    ).toBe(true);
  });

  it("weighs a short text field at the width it declares", () => {
    // `maxLength: 1000` makes the column varchar(1000) on MySQL: 4,000 bytes
    // of key, past the limit on its own. 700 is 2,800 bytes, inside it.
    const declare = (maxLength: number) =>
      buildDesiredTableFromFields(
        "dc_codes",
        [
          {
            name: "code",
            type: "text",
            options: { variant: "short" },
            validation: { maxLength },
          },
        ] as never,
        "postgresql",
        { builtBy: "codeFirst", indexes: [{ fields: ["code"] }] } as never
      );
    expect(refusal(() => declare(1000))).toMatch(/this index declares 4000/);
    expect(() => declare(700)).not.toThrow();
  });

  it("weighs a single relationship by the id it holds", () => {
    // `author` is varchar(36) on MySQL, 144 bytes: beside three text fields
    // the key is 3,204 bytes, past the limit; beside two, 2,184.
    const mixed = [
      { name: "a", type: "text" },
      { name: "b", type: "text" },
      { name: "c", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
    ] as never;
    const declare = (fields: string[]) =>
      buildDesiredTableFromFields("dc_mixed", mixed, "postgresql", {
        builtBy: "codeFirst",
        indexes: [{ fields }],
      } as never);
    expect(refusal(() => declare(["a", "b", "c", "author"]))).toMatch(
      /this index declares 3204/
    );
    expect(() => declare(["a", "b", "author"])).not.toThrow();
  });

  it("refuses an index over no fields", () => {
    expect(refusal(() => build([{ fields: [] }]))).toMatch(
      /at least one field/
    );
  });

  it("refuses a name past 63 characters, which PostgreSQL would cut short", () => {
    const at = `idx_${"n".repeat(59)}`;
    expect(() => build([{ fields: ["country"], name: at }])).not.toThrow();
    expect(
      refusal(() => build([{ fields: ["country"], name: `${at}n` }]))
    ).toMatch(/at most 63/);
  });

  it("refuses a name the diff engine would never reconcile", () => {
    expect(
      refusal(() => build([{ fields: ["country"], name: "places_where" }]))
    ).toMatch(/idx_/);
  });
});

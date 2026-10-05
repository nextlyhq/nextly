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
      /cannot be keyed on every dialect/
    );
  });

  it("refuses an unbounded text column", () => {
    expect(refusal(() => build([{ fields: ["bio"] }]))).toMatch(
      /cannot be keyed on every dialect/
    );
  });

  it("refuses an index over no fields", () => {
    expect(refusal(() => build([{ fields: [] }]))).toMatch(
      /at least one field/
    );
  });

  it("refuses a name the diff engine would never reconcile", () => {
    expect(
      refusal(() => build([{ fields: ["country"], name: "places_where" }]))
    ).toMatch(/idx_/);
  });
});

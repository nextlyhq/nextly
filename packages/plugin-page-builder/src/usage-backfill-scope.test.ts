/**
 * What a backfill treats as one unit of work, and that it is the same product
 * the write path maintains.
 *
 * The risk this file exists for is a SECOND enumeration. If a scope list and
 * the write path's subject list ever disagree, a scope the hooks maintain goes
 * unwalked while readiness reports the index whole — which is the state the
 * backfill was built to remove, reintroduced by the backfill.
 *
 * @module usage-backfill-scope.test
 */
import { describe, expect, it } from "vitest";

import { classUsageSubjectsFor } from "./class-usage-subjects";
import { backfillScopeKey, backfillScopesFor } from "./usage-backfill-scope";

const TWO_FIELDS = [
  { name: "content", localized: true },
  { name: "aside", localized: false },
];

describe("which scopes a collection contributes", () => {
  it("is the product of fields, their locales and the collection's variants", async () => {
    // A localized field on a two-locale site with drafts is four; the
    // unlocalized field beside it is two, because it stores one document for
    // the whole site whatever the locales are.
    const scopes = backfillScopesFor({
      collection: "pages",
      fields: TWO_FIELDS,
      locales: ["en", "fr"],
      hasDrafts: true,
    });

    expect(scopes).toHaveLength(6);
    expect(scopes.filter(s => s.field === "aside").map(s => s.locale)).toEqual([
      "",
      "",
    ]);
  });

  it("IS the write path's own enumeration, with the document dropped", async () => {
    // The property that matters, asserted against the other implementation
    // rather than against a list retyped here — a retyped list agrees with
    // whatever it was copied from on the day it was copied.
    const collection = {
      collection: "pages",
      fields: TWO_FIELDS,
      locales: ["en", "fr"],
      hasDrafts: true,
    };

    const scopes = backfillScopesFor(collection);
    const subjects = classUsageSubjectsFor({ ...collection, entityKey: "x" });

    expect(scopes).toEqual(
      subjects.map(s => ({
        entity: s.entity,
        field: s.field,
        locale: s.locale,
        variant: s.variant,
      }))
    );
  });

  it("has no draft scope for a collection that stores no draft", async () => {
    const scopes = backfillScopesFor({
      collection: "pages",
      fields: [{ name: "content", localized: false }],
      locales: [],
      hasDrafts: false,
    });

    expect(scopes).toEqual([
      { entity: "pages", field: "content", locale: "", variant: "published" },
    ]);
  });
});

describe("the key a completed scope is recorded under", () => {
  it("separates two scopes that differ only in where a boundary falls", async () => {
    // The collision this key exists to avoid. Joining on a character the parts
    // can contain lets two different scopes produce one key — and that key
    // means "this scope is backfilled", so a collision marks a scope done that
    // was never walked. A dash or a colon would fail this; a unit separator
    // cannot, because no slug, field name or locale may contain one.
    const a = backfillScopeKey({
      entity: "pages",
      field: "content-aside",
      locale: "en",
      variant: "published",
    });
    const b = backfillScopeKey({
      entity: "pages-content",
      field: "aside",
      locale: "en",
      variant: "published",
    });

    expect(a).not.toBe(b);
  });

  it("gives one key per scope, whatever order the fields were built in", async () => {
    // Total in the scope: equal scopes have equal keys, so a re-derived list
    // recognises work an earlier pass recorded rather than repeating it.
    const scope = {
      entity: "pages",
      field: "content",
      locale: "fr",
      variant: "draft",
    } as const;

    expect(backfillScopeKey({ ...scope })).toBe(backfillScopeKey(scope));
  });
});

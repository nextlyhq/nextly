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
import {
  backfillGeneration,
  backfillScopeKey,
  backfillScopesFor,
} from "./usage-backfill-scope";

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

describe("which derivation a recorded scope belongs to", () => {
  const INDEXES = {
    classIndex: "nx_pb_class_usage",
    componentIndex: "nx_pb_component_usage",
  } as const;
  const LIMITS = { maxDepth: 10, maxNodes: 500, maxBytes: 1000 };
  const base = { limits: LIMITS, ...INDEXES };

  it("changes when any bound the index is derived under changes", async () => {
    // A scope records WHICH documents were walked; the generation records what
    // they were read as. The index is derived under the same bounds the
    // renderer draws with, so moving them makes every recorded scope stale.
    expect(
      backfillGeneration({ ...base, limits: { ...LIMITS, maxNodes: 400 } })
    ).not.toBe(backfillGeneration(base));
    expect(
      backfillGeneration({ ...base, limits: { ...LIMITS, maxDepth: 9 } })
    ).not.toBe(backfillGeneration(base));
    expect(
      backfillGeneration({ ...base, limits: { ...LIMITS, maxBytes: 999 } })
    ).not.toBe(backfillGeneration(base));
  });

  it("changes when either index collection is remapped", async () => {
    /*
     * A host may `.rename()` either index. Core then registers the new slug as
     * a new, EMPTY collection and keeps the old one as an orphan — so progress
     * recorded against the old one certifies rows nothing reads. Unchanged, the
     * generation would accept those rows for the empty index and health would
     * report its zero counts as exact, which is what permits deleting a
     * component every existing document still uses.
     */
    expect(
      backfillGeneration({ ...base, classIndex: "site_class_usage" })
    ).not.toBe(backfillGeneration(base));
    expect(
      backfillGeneration({ ...base, componentIndex: "site_component_usage" })
    ).not.toBe(backfillGeneration(base));
  });

  it("cannot be forged by a slug that looks like another derivation", async () => {
    // The separator has to be one a slug cannot contain. A slug matches
    // /^[a-z][a-z0-9_-]*$/, so it may contain the `x` this once joined on —
    // and two different derivations serialising to one string is a fence that
    // fails in the direction that accepts stale progress.
    // These two collide EXACTLY under an `x` join — "…xaxxb" both ways — and
    // differ under one a slug cannot contain. Picking any two unequal slugs
    // would pass either way and prove nothing about the separator.
    expect(
      backfillGeneration({ ...base, classIndex: "ax", componentIndex: "b" })
    ).not.toBe(
      backfillGeneration({ ...base, classIndex: "a", componentIndex: "xb" })
    );
  });

  it("is the same for the same derivation, so steady configuration keeps its progress", async () => {
    // The control. A generation that differed every call would invalidate all
    // progress on every pass — the backfill would never finish, and it would
    // look like a site too large to walk rather than like a broken key.
    expect(backfillGeneration({ ...base })).toBe(backfillGeneration(base));
  });

  it("leaves the scope KEY alone, so a re-walk reconciles rather than orphans", async () => {
    // Why the generation sits beside the key rather than inside it. Folding the
    // bounds into the identity would make two records of one scope compare
    // unequal — "this is different work" rather than "redo this work" — and the
    // old row would have nothing that ever reconciles it.
    const scope = {
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    } as const;

    const key = backfillScopeKey(scope);
    expect(key).not.toContain(backfillGeneration(base));
  });
});

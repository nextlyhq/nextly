/**
 * Whether a written document enumerates the subjects it actually owns.
 *
 * Each case names a way the enumeration can be wrong in a direction that is
 * invisible afterwards: a subject that is never enumerated is never
 * reconciled, so its rows stay as they were and a class it dropped goes on
 * counting for ever; and a subject enumerated that cannot exist writes rows no
 * query built from a real document can reach.
 *
 * @module class-usage-subjects.test
 */
import { describe, expect, it } from "vitest";

import { classUsageSubjectsFor } from "./class-usage-subjects";

const base = {
  collection: "pages",
  entityKey: "page-1",
  locales: [] as string[],
  hasDrafts: false,
};

const localized = { name: "content", localized: true };
const plain = { name: "content", localized: false };

describe("a document with one unlocalized field and no drafts", () => {
  it("owns exactly one subject", () => {
    expect(classUsageSubjectsFor({ ...base, fields: [plain] })).toEqual([
      {
        scope: "collection",
        entity: "pages",
        entityKey: "page-1",
        field: "content",
        locale: "",
        variant: "published",
      },
    ]);
  });
});

describe("the locale dimension", () => {
  it("gives a localized field one subject PER configured locale", () => {
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [localized],
      locales: ["en", "fr", "de"],
    });

    expect(subjects.map(s => s.locale)).toEqual(["en", "fr", "de"]);
  });

  it("gives an UNLOCALIZED field one subject even on a localized site", () => {
    // The field decides this, not the collection. A collection can be localized
    // while a given blocks field is not, and then one document serves the whole
    // site. Enumerating per locale would file identical rows under every
    // language and leave the `""` subject — the one a read actually resolves —
    // holding none, so the document's classes would be invisible to the count
    // that matters.
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [plain],
      locales: ["en", "fr", "de"],
    });

    expect(subjects).toHaveLength(1);
    expect(subjects[0].locale).toBe("");
  });

  it("falls back to the sentinel when a localized field has no configured locales", () => {
    // Localization off, or configured with none. There is one document, and it
    // is the one a read with no locale resolves to — so the subject is the same
    // one an unlocalized field gets, reached by a different route.
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [localized],
      locales: [],
    });

    expect(subjects).toHaveLength(1);
    expect(subjects[0].locale).toBe("");
  });
});

describe("the variant dimension", () => {
  it("gives a drafting collection BOTH variants", () => {
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [plain],
      hasDrafts: true,
    });

    expect(subjects.map(s => s.variant)).toEqual(["published", "draft"]);
  });

  it("gives a collection WITHOUT drafts no draft subject", () => {
    // A draft subject on a collection that keeps none describes a document that
    // cannot exist. Its rows would be unreachable by every query built from a
    // real document — reconciled by nothing and swept by nothing — which is the
    // permanently-stranded state the index has no mechanism to repair.
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [plain],
      hasDrafts: false,
    });

    expect(subjects.map(s => s.variant)).toEqual(["published"]);
  });
});

describe("the full product", () => {
  it("enumerates every field, locale and variant together", () => {
    // The dimensions multiply rather than compose in sequence, which is the
    // property a nested loop can get wrong by reusing the inner list. Two
    // fields with different localization on a two-locale drafting site is the
    // smallest fixture where a wrong nesting produces a wrong COUNT rather than
    // a wrong order.
    const subjects = classUsageSubjectsFor({
      ...base,
      fields: [localized, { name: "sidebar", localized: false }],
      locales: ["en", "fr"],
      hasDrafts: true,
    });

    // content: 2 locales x 2 variants = 4. sidebar: 1 locale x 2 variants = 2.
    expect(subjects).toHaveLength(6);

    const keys = subjects.map(s => `${s.field}:${s.locale}:${s.variant}`);
    expect(keys).toEqual([
      "content:en:published",
      "content:en:draft",
      "content:fr:published",
      "content:fr:draft",
      "sidebar::published",
      "sidebar::draft",
    ]);
  });

  it("carries the collection and document id onto every subject", () => {
    // A subject missing either is not merely incomplete: `entity` and
    // `entityKey` are what scope every query the reconciler makes, so a blank
    // one reconciles against another document's rows and deletes them.
    const subjects = classUsageSubjectsFor({
      ...base,
      collection: "articles",
      entityKey: "a-9",
      fields: [localized],
      locales: ["en", "fr"],
      hasDrafts: true,
    });

    expect(subjects).toHaveLength(4);
    for (const subject of subjects) {
      expect(subject.entity).toBe("articles");
      expect(subject.entityKey).toBe("a-9");
      expect(subject.scope).toBe("collection");
    }
  });

  it("owns nothing when the collection declares no blocks field", () => {
    // The wildcard hook fires for EVERY collection, so most calls reach here
    // with nothing to do. Returning an empty list rather than throwing is what
    // makes the filter a property of this function instead of a branch every
    // caller has to remember.
    expect(
      classUsageSubjectsFor({
        ...base,
        fields: [],
        locales: ["en", "fr"],
        hasDrafts: true,
      })
    ).toEqual([]);
  });
});

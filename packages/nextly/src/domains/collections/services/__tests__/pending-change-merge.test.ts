/**
 * The rule that folds every language's pending change into one write.
 *
 * @module domains/collections/services/__tests__/pending-change-merge.test
 */
import { describe, expect, it } from "vitest";

import {
  changedKeys,
  languageTarget,
  pendingChangesToApply,
  sameContent,
  withTranslationsFrom,
  withoutTranslations,
  type ComponentValueShape,
} from "../pending-change-merge";

const FLAT: ComponentValueShape = {
  translatableKeys: () => new Set(["heading"]),
  nested: () => undefined,
};

describe("pendingChangesToApply", () => {
  it("applies the oldest save first and skips languages the app does not configure", () => {
    const out = pendingChangesToApply(
      [
        { locale: "de", snapshot: {}, updatedAt: "2026-01-02T00:00:00.000Z" },
        { locale: "fr", snapshot: {}, updatedAt: "2026-01-01T00:00:00.000Z" },
        { locale: null, snapshot: {}, updatedAt: "2026-01-01T00:00:00.000Z" },
        {
          locale: "en",
          snapshot: {},
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      new Set(["en", "de"])
    );
    expect(out.map(change => change.locale)).toEqual(["en", "de"]);
  });

  it("orders two saves at the same instant by language, so the result never depends on the database", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const out = pendingChangesToApply(
      [
        { locale: "en", snapshot: {}, updatedAt: at },
        { locale: "de", snapshot: {}, updatedAt: at },
      ],
      new Set(["en", "de"])
    );
    expect(out.map(change => change.locale)).toEqual(["de", "en"]);
  });
});

describe("sameContent", () => {
  it("treats an instant and its ISO string as the same value", () => {
    expect(
      sameContent(
        new Date("2026-01-02T03:04:05.000Z"),
        "2026-01-02T03:04:05.000Z"
      )
    ).toBe(true);
  });

  it("counts a declared field named like a row timestamp as content", () => {
    // Both sides arrive schema-shaped, so a key left in them is a field the
    // author declared, and an edit to it must not read as unchanged.
    expect(
      sameContent(
        { meta: { updatedAt: "edited" } },
        { meta: { updatedAt: "live" } }
      )
    ).toBe(false);
  });

  it("still tells two instance ids apart", () => {
    expect(sameContent([{ id: "r1" }], [{ id: "r2" }])).toBe(false);
  });
});

describe("withoutTranslations and withTranslationsFrom", () => {
  it("drops translatable keys and keeps the structure", () => {
    expect(
      withoutTranslations(
        [{ id: "r1", heading: "Hallo", variant: "wide" }],
        FLAT
      )
    ).toEqual([{ id: "r1", variant: "wide" }]);
  });

  it("takes one language's translations onto the current instances by id", () => {
    const out = withTranslationsFrom({
      current: [
        { id: "r1", heading: "old", variant: "wide" },
        { id: "r2", heading: "added elsewhere", variant: "narrow" },
      ],
      pending: [{ id: "r1", heading: "Hallo", variant: "stale" }],
      shape: FLAT,
    });
    expect(out).toEqual([
      { id: "r1", heading: "Hallo", variant: "wide" },
      { id: "r2", heading: "added elsewhere", variant: "narrow" },
    ]);
  });
});

describe("languageTarget", () => {
  const base = {
    localizedFieldNames: new Set(["title"]),
    componentFields: new Map<string, ComponentValueShape>([["blocks", FLAT]]),
  };

  it("keeps a shared edit made earlier in the write when this change never touched it", () => {
    const out = languageTarget({
      ...base,
      live: { title: "DE", note: "live note" },
      current: { title: "DE", note: "EN edited note" },
      pending: { title: "DE v2", note: "live note" },
    });
    expect(out).toEqual({ title: "DE v2", note: "EN edited note" });
  });

  it("takes a shared value this change edited", () => {
    const out = languageTarget({
      ...base,
      live: { note: "live note" },
      current: { note: "live note" },
      pending: { note: "DE edited note" },
    });
    expect(out.note).toBe("DE edited note");
  });

  it("keeps a field the pending change does not hold", () => {
    const out = languageTarget({
      ...base,
      live: { note: "live", added: "x" },
      current: { note: "live", added: "x" },
      pending: { note: "live" },
    });
    expect(out.added).toBe("x");
  });

  it("keeps a block another language added when this change only translated", () => {
    const out = languageTarget({
      ...base,
      live: { blocks: [{ id: "r1", heading: "EN", variant: "wide" }] },
      current: {
        blocks: [
          { id: "r1", heading: "EN", variant: "wide" },
          { id: "r2", heading: "EN new", variant: "narrow" },
        ],
      },
      pending: { blocks: [{ id: "r1", heading: "DE", variant: "wide" }] },
    });
    expect(out.blocks).toEqual([
      { id: "r1", heading: "DE", variant: "wide" },
      { id: "r2", heading: "EN new", variant: "narrow" },
    ]);
  });

  it("takes this change's blocks when it changed their structure", () => {
    const pendingBlocks = [{ id: "r1", heading: "DE", variant: "narrow" }];
    const out = languageTarget({
      ...base,
      live: { blocks: [{ id: "r1", heading: "EN", variant: "wide" }] },
      current: { blocks: [{ id: "r1", heading: "EN", variant: "wide" }] },
      pending: { blocks: pendingBlocks },
    });
    expect(out.blocks).toEqual(pendingBlocks);
  });
});

describe("changedKeys", () => {
  it("names only what differs from the document as it stands", () => {
    expect([
      ...changedKeys(
        { a: 1, b: "2026-01-01T00:00:00.000Z" },
        { a: 1, b: new Date("2026-01-01T00:00:00.000Z") }
      ),
    ]).toEqual([]);
    expect([...changedKeys({ a: 2 }, { a: 1 })]).toEqual(["a"]);
  });
});

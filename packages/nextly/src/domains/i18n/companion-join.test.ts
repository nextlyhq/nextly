import { describe, it, expect } from "vitest";

import {
  populateTranslationStatus,
  resolveLocalizedValue,
} from "./companion-join";

describe("resolveLocalizedValue (fallback chain, blank = untranslated)", () => {
  it("returns the requested locale's value when present", () => {
    expect(
      resolveLocalizedValue({ de: "Hallo", en: "Hello" }, ["de", "en"])
    ).toBe("Hallo");
  });

  it("falls back to the next chain locale when the requested value is blank (empty string)", () => {
    expect(resolveLocalizedValue({ de: "", en: "Hello" }, ["de", "en"])).toBe(
      "Hello"
    );
  });

  it("falls back when the requested value is null/undefined (no row)", () => {
    expect(resolveLocalizedValue({ en: "Hello" }, ["de", "en"])).toBe("Hello");
    expect(resolveLocalizedValue({ de: null, en: "Hello" }, ["de", "en"])).toBe(
      "Hello"
    );
  });

  it("walks a multi-locale chain to the first non-blank value", () => {
    expect(
      resolveLocalizedValue({ "de-CH": "", de: "", en: "Hi" }, [
        "de-CH",
        "de",
        "en",
      ])
    ).toBe("Hi");
    expect(
      resolveLocalizedValue({ "de-CH": "", de: "Hallo", en: "Hi" }, [
        "de-CH",
        "de",
        "en",
      ])
    ).toBe("Hallo");
  });

  it("returns null when nothing along the chain has a value", () => {
    expect(resolveLocalizedValue({ de: "", en: "" }, ["de", "en"])).toBeNull();
    expect(resolveLocalizedValue({}, ["de", "en"])).toBeNull();
  });

  it("with a single-element chain (fallback=none) does NOT fall back — returns the raw value", () => {
    expect(resolveLocalizedValue({ de: "", en: "Hello" }, ["de"])).toBeNull();
    expect(resolveLocalizedValue({ de: "Hallo", en: "Hello" }, ["de"])).toBe(
      "Hallo"
    );
  });

  it("treats 0 and false as real values (only null/undefined/'' are blank)", () => {
    expect(resolveLocalizedValue({ de: 0, en: 5 }, ["de", "en"])).toBe(0);
    expect(resolveLocalizedValue({ de: false, en: true }, ["de", "en"])).toBe(
      false
    );
  });
});

describe("populateTranslationStatus (read failures)", () => {
  /** A db whose query rejects the way a permission or schema fault would. */
  function failingDb(message: string) {
    const rejection = () => {
      throw new Error(message);
    };
    return {
      select: () => ({ from: () => ({ where: rejection }) }),
    } as never;
  }

  const args = (
    readiness: "ready" | "pre-migration" | undefined,
    message: string
  ) => ({
    db: failingDb(message),
    companionTable: { _parent: "p", _locale: "l" },
    localizedFields: [],
    rows: [{ id: "doc1" } as Record<string, unknown>],
    locales: ["en", "de"],
    defaultLocale: "en",
    hasStatus: true,
    readiness,
  });

  it("surfaces every failure once the companion is ready", async () => {
    // A rule reading `_translations` cannot tell an untranslated Single from one whose overview
    // simply failed to load, so the failure has to reach it. There is no tolerated class left:
    // the missing-table case is decided before the query rather than caught after it.
    for (const message of [
      "permission denied for relation",
      "no such table: single_branding_locales",
    ]) {
      await expect(
        populateTranslationStatus(args("ready", message))
      ).rejects.toThrow(message);
    }
  });

  it("issues no query at all before the companion migration has run", async () => {
    // A Single before its migration is not a fault, and it is also not something to find out by
    // failing: on PostgreSQL a failed statement aborts the caller's whole transaction.
    await expect(
      populateTranslationStatus(args("pre-migration", "must not be issued"))
    ).resolves.toBeUndefined();
    await expect(
      populateTranslationStatus(args(undefined, "must not be issued"))
    ).resolves.toBeUndefined();
  });
});

describe("populateTranslationStatus — staleness (i18n B2)", () => {
  /** A db returning fixed companion rows, so the assertion is about the derivation. */
  function dbReturning(rows: Record<string, unknown>[]) {
    return {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    } as never;
  }

  const SOURCE = "en";
  const TARGET = "fr";

  /** One companion row. `updatedAt` of `null` is a row written before the column existed. */
  function companionRow(
    locale: string,
    title: string | null,
    updatedAt: Date | null
  ): Record<string, unknown> {
    return {
      _parent: "doc1",
      _locale: locale,
      _status: "published",
      _updated_at: updatedAt,
      title,
    };
  }

  async function metaFor(
    rows: Record<string, unknown>[]
  ): Promise<
    Record<string, { translated: boolean; status?: string; stale?: boolean }>
  > {
    const row: Record<string, unknown> = { id: "doc1" };
    await populateTranslationStatus({
      db: dbReturning(rows),
      companionTable: { _parent: "p", _locale: "l" },
      localizedFields: [{ name: "title", column: "title" }],
      rows: [row],
      locales: [SOURCE, TARGET],
      defaultLocale: SOURCE,
      hasStatus: true,
      readiness: "ready",
    });
    return row._translations as never;
  }

  it("flags a translation whose source was written afterwards", async () => {
    const meta = await metaFor([
      companionRow(SOURCE, "Hello again", new Date(2000)),
      companionRow(TARGET, "Bonjour", new Date(1000)),
    ]);

    expect(meta[TARGET].stale).toBe(true);
    // 🔴 And it keeps the state it was in. This pair is the assertion: `stale`
    // is a SECOND fact about the language, so a reader that renders it as a
    // replacement takes a live translation out of "published" on every screen.
    expect(meta[TARGET].translated).toBe(true);
    expect(meta[TARGET].status).toBe("published");
  });

  it("does not flag one written after its source", async () => {
    const meta = await metaFor([
      companionRow(SOURCE, "Hello", new Date(1000)),
      companionRow(TARGET, "Bonjour", new Date(2000)),
    ]);

    // The control. Without it, "always stale" passes the case above.
    expect(meta[TARGET].stale).toBeUndefined();
  });

  it("leaves staleness ABSENT when either timestamp is unknown", async () => {
    // Absent rather than `false`, and the difference carries weight: a consumer
    // reading `stale === false` should be reading a real "not stale", not an
    // unknown wearing its clothes. A row written before `_updated_at` existed
    // cannot answer, and must never be rendered as up to date.
    const unstampedTarget = await metaFor([
      companionRow(SOURCE, "Hello again", new Date(2000)),
      companionRow(TARGET, "Bonjour", null),
    ]);
    expect(unstampedTarget[TARGET].stale).toBeUndefined();
    expect(unstampedTarget[TARGET].translated).toBe(true);

    const unstampedSource = await metaFor([
      companionRow(SOURCE, "Hello", null),
      companionRow(TARGET, "Bonjour", new Date(1000)),
    ]);
    expect(unstampedSource[TARGET].stale).toBeUndefined();
  });

  it("does not flag a language that has no content", async () => {
    const meta = await metaFor([
      companionRow(SOURCE, "Hello again", new Date(2000)),
      companionRow(TARGET, "", new Date(1000)),
    ]);

    // Blank means untranslated, so there is nothing to review — the instruction
    // for this language is to write it, not to check it. Reporting both would
    // put one document under two contradictory calls to action.
    expect(meta[TARGET].translated).toBe(false);
    expect(meta[TARGET].stale).toBeUndefined();
  });

  it("never flags the source language against itself", async () => {
    const meta = await metaFor([
      companionRow(SOURCE, "Hello", new Date(2000)),
      companionRow(TARGET, "Bonjour", new Date(1000)),
    ]);

    // The default locale IS the source of the comparison.
    //
    // 🔴 This green holds by TWO independent mechanisms and cannot tell them
    // apart: the explicit `code !== defaultLocale` guard, and the fact that the
    // source row compared against itself is equal rather than greater.
    // Break-verified and recorded as such — removing the guard leaves this
    // passing. It is kept as an assertion of intent, not because this test
    // proves it runs.
    expect(meta[SOURCE].stale).toBeUndefined();
  });
});

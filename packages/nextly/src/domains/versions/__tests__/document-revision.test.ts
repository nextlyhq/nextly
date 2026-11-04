/**
 * The published document version: one string a client hands back unchanged,
 * which names every counter it covers.
 *
 * The format is a contract with the code that will judge a save against it,
 * so a state must have exactly one spelling: two spellings of one state would
 * read as a change that never happened.
 */
import { describe, expect, it } from "vitest";

import {
  attachDocumentVersions,
  DOCUMENT_VERSION_KEY,
  DOCUMENT_REVISION_COLUMN,
  encodeDocumentVersion,
  withoutDocumentVersionKeys,
} from "../document-revision";
import { documentSystemKeys } from "../snapshot-system-keys";

describe("encodeDocumentVersion", () => {
  it("is the main counter alone for a document with no languages", () => {
    expect(encodeDocumentVersion(7)).toBe("7");
  });

  it("names the one language a read in that language covers", () => {
    expect(encodeDocumentVersion(7, { es: 3 })).toBe("7.es:3");
  });

  it("names every language in code order, whatever order they arrive in", () => {
    expect(encodeDocumentVersion(7, { es: 3, en: 2 })).toBe("7.en:2,es:3");
    expect(encodeDocumentVersion(7, { en: 2, es: 3 })).toBe("7.en:2,es:3");
  });

  it("keeps a language with no translation as 0 rather than leaving it out", () => {
    // Leaving it out would give "no translation yet" and "a translation was
    // added and removed" the same spelling as a document without the language.
    expect(encodeDocumentVersion(7, { "pt-BR": 4, en: 0 })).toBe(
      "7.en:0,pt-BR:4"
    );
  });

  it("is a string, so a client cannot do arithmetic on it", () => {
    expect(typeof encodeDocumentVersion(1)).toBe("string");
  });
});

describe("withoutDocumentVersionKeys", () => {
  it("drops the published key and every column the server alone writes, leaving the caller's object as it was", () => {
    const body: Record<string, unknown> = {
      title: "kept",
      [DOCUMENT_VERSION_KEY]: "999",
      [DOCUMENT_REVISION_COLUMN]: 999,
      _changed_by_kind: "person",
      _changed_by_id: "someone-else",
      _changed_by_principal_kind: "x",
      _changed_at: "2026-01-01T00:00:00Z",
    };
    expect(withoutDocumentVersionKeys(body)).toEqual({ title: "kept" });
    expect(body[DOCUMENT_VERSION_KEY]).toBe("999");
  });

  it("is never content a version comparison counts", () => {
    // A restored snapshot holding a stored version must not write it back,
    // and two versions must not differ by it alone.
    for (const entity of ["collection", "single"] as const) {
      expect(documentSystemKeys(entity).has(DOCUMENT_VERSION_KEY)).toBe(true);
    }
  });

  it("names the published key `_rev`", () => {
    expect(DOCUMENT_VERSION_KEY).toBe("_rev");
    expect(DOCUMENT_REVISION_COLUMN).toBe("_revision");
  });
});

describe("attachDocumentVersions", () => {
  const localization = {
    locales: [{ code: "en" }, { code: "es" }],
    defaultLocale: "en",
  } as never;

  it("names the languages the read brought counters for", () => {
    const rows: Record<string, unknown>[] = [{ id: "a" }];
    attachDocumentVersions(rows, {
      stored: new Map([["a", 3]]),
      localization,
      locale: "*",
      known: {
        revisions: new Map([["a", new Map([["es", 2]])]]),
        locales: ["en", "es"],
      },
    });
    expect(rows[0]._rev).toBe("3.en:0,es:2");
  });

  it("refuses counters taken for fewer languages than the version names", () => {
    // Zeros for the languages not read would publish a version no save made.
    expect(() =>
      attachDocumentVersions([{ id: "a" }], {
        stored: new Map([["a", 3]]),
        localization,
        locale: "*",
        known: { revisions: new Map(), locales: ["en"] },
      })
    ).toThrow();
  });

  it("leaves no version a hook set on a row that matches no stored document", () => {
    const rows: Record<string, unknown>[] = [
      { id: "rewritten", _rev: "99" },
      { _rev: "98" },
    ];
    attachDocumentVersions(rows, {
      stored: new Map([["a", 3]]),
      localization: undefined,
      locale: undefined,
    });
    expect(rows).toEqual([{ id: "rewritten" }, {}]);
  });
});

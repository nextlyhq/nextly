/**
 * Keeping a container as it is marks the texts the person was shown, beside the source they were
 * shown, and no other: not a held draft they may not see, not a text made from another language,
 * and nothing of a container written in its own language.
 */
import type {
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { reviewTexts } from "../container-review";
import type { WriteSources } from "../source-text";
import type { ReviewDb } from "../translation-review";

const DOCUMENT = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};
const PATH = "sections#r1.caption";

interface Row {
  id: string;
  locale: string;
  partState: "live" | "draft";
  fieldPath: string;
  origin: string;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** A Spanish text's record, made from an English one that has changed since. */
function spanish(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    locale: "es",
    partState: "live",
    fieldPath: PATH,
    origin: "person",
    valueFingerprint: "es-live",
    sourceLocale: "en",
    sourceFingerprint: "en-old",
    ...over,
  };
}

/** The source's own record, as it is now. */
const english: Row = {
  id: "en",
  locale: "en",
  partState: "live",
  fieldPath: PATH,
  origin: "original",
  valueFingerprint: "en-now",
  sourceLocale: null,
  sourceFingerprint: null,
};

/** Reviews a container whose records are `rows`, and answers each one's source fingerprint. */
async function reviewed(
  rows: Row[],
  shown: { heldDraft: boolean; sourceLocale: string | undefined }
): Promise<Record<string, string | null>> {
  const holds = (row: Row, where: WhereClause | undefined) =>
    (where?.and ?? []).every(each => {
      const { column, op, value } = each as WhereCondition;
      const own = row[column as keyof Row];
      // The document's own columns are the same on every row here.
      if (!(column in row)) return true;
      return op === "IN" && Array.isArray(value)
        ? value.includes(own as string)
        : own === value;
    });
  const db = {
    select: async (_table: string, options?: { where?: WhereClause }) =>
      rows.filter(row => holds(row, options?.where)),
    updateCount: async (
      _table: string,
      data: Partial<Row>,
      where: WhereClause
    ) => {
      const found = rows.filter(row => holds(row, where));
      for (const row of found) Object.assign(row, data);
      return found.length;
    },
  } as unknown as ReviewDb;
  // Where no source text is kept, nothing else is written.
  const sources = { db, kept: false } as unknown as WriteSources;
  await reviewTexts(
    db,
    { document: DOCUMENT, locale: "es", fieldPath: "sections", ...shown },
    sources,
    new Date()
  );
  return Object.fromEntries(rows.map(row => [row.id, row.sourceFingerprint]));
}

const FROM_ENGLISH = { heldDraft: false, sourceLocale: "en" };

describe("a container kept as it is", () => {
  it("has its texts marked right against their source as it is now", async () => {
    expect(
      await reviewed([spanish("live"), { ...english }], FROM_ENGLISH)
    ).toEqual({ live: "en-now", en: null });
  });

  it("has its live text marked, and not a draft the person was not shown", async () => {
    const rows = () => [
      spanish("live"),
      spanish("draft", { partState: "draft", valueFingerprint: "es-draft" }),
      { ...english },
    ];
    expect(await reviewed(rows(), FROM_ENGLISH)).toEqual({
      live: "en-now",
      draft: "en-old",
      en: null,
    });
    // Shown the draft, it is the draft that was found right.
    expect(
      await reviewed(rows(), { heldDraft: true, sourceLocale: "en" })
    ).toEqual({ live: "en-old", draft: "en-now", en: null });
  });

  it("has both parts marked where they hold the same text", async () => {
    const rows = [
      spanish("live"),
      spanish("draft", { partState: "draft" }),
      { ...english },
    ];
    expect(await reviewed(rows, FROM_ENGLISH)).toEqual({
      live: "en-now",
      draft: "en-now",
      en: null,
    });
  });

  it("leaves a text made from another language than the one shown", async () => {
    const rows = [
      spanish("french", { sourceLocale: "fr", sourceFingerprint: "fr-old" }),
      { ...english },
    ];
    expect(await reviewed(rows, FROM_ENGLISH)).toEqual({
      french: "fr-old",
      en: null,
    });
  });

  it("leaves every text where it was written in its own language", async () => {
    expect(
      await reviewed([spanish("live"), { ...english }], {
        heldDraft: false,
        sourceLocale: undefined,
      })
    ).toEqual({ live: "en-old", en: null });
  });

  it("leaves another field's text, and a row's own record", async () => {
    const rows = [
      spanish("other", { fieldPath: "parts#r1.caption" }),
      spanish("row", { fieldPath: "sections#r1" }),
      { ...english },
      { ...english, id: "en-other", fieldPath: "parts#r1.caption" },
    ];
    expect(await reviewed(rows, FROM_ENGLISH)).toMatchObject({
      other: "en-old",
      row: "en-old",
    });
  });
});

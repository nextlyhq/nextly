/**
 * The case fold SQLite connections apply as `nextly_fold_case`, held to what PostgreSQL's and
 * MySQL's `lower()` give, letter by letter.
 *
 * Each case below is one a plain `text.toLowerCase()` gets differently: it writes a final sigma
 * at the end of a word and "i" plus a combining dot for "İ", either of which would make SQLite
 * alone miss a match the other two dialects find.
 */
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  caseFolded,
  foldCase,
  registerSqliteFoldCase,
  SQLITE_FOLD_CASE_FUNCTION,
} from "../text-match";

describe("foldCase", () => {
  it("folds capitals outside ASCII, as the other dialects' lower() does", () => {
    expect(foldCase("CRÈME BRÛLÉE")).toBe("crème brûlée");
    expect(foldCase("ÄRGER")).toBe("ärger");
    expect(foldCase("ΑΘΉΝΑ")).toBe("αθήνα");
  });

  it("folds a capital sigma to σ wherever it stands, never to the final ς", () => {
    // The word ends in the sigma, where `toLowerCase()` on the whole string writes "ς".
    expect(foldCase("ΟΔΟΣ")).toBe("οδοσ");
    expect(foldCase("ΟΔΟΣ")).not.toBe("ΟΔΟΣ".toLowerCase());
  });

  it("folds the Turkish dotted capital İ to a plain i, and leaves the dotless ı as it is", () => {
    expect(foldCase("İSTANBUL")).toBe("istanbul");
    expect(foldCase("İ")).toHaveLength(1);
    expect(foldCase("ılık")).toBe("ılık");
  });

  it("leaves a letter with no single capital, and ASCII punctuation, as it is", () => {
    expect(foldCase("STRAßE")).toBe("straße");
    expect(foldCase("50% A_B!")).toBe("50% a_b!");
  });
});

describe("a final sigma", () => {
  it("folds to the sigma its capital folds to, so a typed final sigma meets the stored capital", () => {
    expect(foldCase("ΟΣ")).toBe("οσ");
    expect(foldCase("ος")).toBe("οσ");
  });
});

describe("registerSqliteFoldCase", () => {
  it("registers the fold, deterministic, under the name the SQLite statements call", () => {
    const registered: {
      name: string;
      deterministic: boolean;
      fold: (v: unknown) => unknown;
    }[] = [];
    registerSqliteFoldCase({
      function: (name, options, implementation) => {
        registered.push({
          name,
          deterministic: options.deterministic,
          fold: implementation,
        });
      },
    });

    expect(registered.map(entry => [entry.name, entry.deterministic])).toEqual([
      [SQLITE_FOLD_CASE_FUNCTION, true],
    ]);
    expect(registered[0]?.fold("ΟΔΟΣ")).toBe("οδοσ");
    expect(registered[0]?.fold(null)).toBeNull();
  });
});

describe("caseFolded", () => {
  // PostgreSQL has no lower() for json or jsonb, the type a hasMany relationship's ids are
  // stored as there, so it folds the value as text; MySQL lowers the serialized JSON as it is.
  it("folds the value as text on PostgreSQL, so a json column is matched by its serialized text", () => {
    expect(
      new PgDialect().sqlToQuery(
        caseFolded("postgresql", sql.identifier("topics"))
      ).sql
    ).toBe(`replace(lower(("topics")::text), $1, $2)`);
  });

  it("lowers the value as it is on MySQL", () => {
    expect(
      new MySqlDialect().sqlToQuery(
        caseFolded("mysql", sql.identifier("topics"))
      ).sql
    ).toBe("replace(lower(`topics`), ?, ?)");
  });
});

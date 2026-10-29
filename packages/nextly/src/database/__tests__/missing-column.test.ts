import { TABLE_NOT_REGISTERED_CODE as ADAPTER_TABLE_NOT_REGISTERED_CODE } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { isIdempotencyError } from "../../domains/schema/pipeline/sql-statement-utils";
import {
  firstIdentifierNamed,
  isMissingColumnError,
  isMissingNamedColumnError,
  missingColumnKind,
  missingSchemaObject,
  TABLE_NOT_REGISTERED_CODE,
} from "../missing-column";

describe("isMissingColumnError", () => {
  it("recognises the message each dialect uses", () => {
    expect(isMissingColumnError(new Error("no such column: draft_key"))).toBe(
      true
    );
    expect(
      isMissingColumnError(
        new Error("Key column 'draft_key' doesn't exist in table")
      )
    ).toBe(true);
    expect(
      isMissingColumnError(new Error('column "draft_key" does not exist'))
    ).toBe(true);
  });

  it("reads the cause, which is where the driver error lands", () => {
    const wrapped = new Error("Failed query: CREATE UNIQUE INDEX ...", {
      cause: new Error("no such column: draft_key"),
    });
    expect(isMissingColumnError(wrapped)).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    // The whole value of this predicate is that it stays narrow: an index that
    // fails for any other reason must still stop the reconcile.
    expect(isMissingColumnError(new Error("disk I/O error"))).toBe(false);
    expect(
      isMissingColumnError(new Error("UNIQUE constraint failed: t.c"))
    ).toBe(false);
    expect(isMissingColumnError(new Error("syntax error near INDEX"))).toBe(
      false
    );
  });

  it("is a different question from idempotency", () => {
    // Idempotency means the work is already done; this means its precondition
    // is not done yet. Conflating them would let a genuinely absent column pass
    // as an already-applied change.
    const missing = new Error("no such column: draft_key");
    expect(isIdempotencyError(missing)).toBe(false);

    const existing = new Error("index already exists");
    expect(isMissingColumnError(existing)).toBe(false);
  });
});

/** A driver error as thrown: a code, and a message in the server's configured language. */
function driverError(message: string, code: string | number): Error {
  return Object.assign(
    new Error(message),
    typeof code === "number" ? { errno: code } : { code }
  );
}

/** A mysql2 error as thrown: the string code AND the numeric errno, as the driver sets both. */
function mysqlError(message: string, code: string, errno: number): Error {
  return Object.assign(new Error(message), { code, errno });
}

describe("missingColumnKind", () => {
  it("classifies from the code when the message is not English", () => {
    // The reason this module matches codes at all. MySQL's `lc_messages` selects among
    // roughly twenty translations and has session scope, so a wording match is not a
    // property of the server being wrong — it is a property of it being configured.
    // Neither message below matches any pattern in WORDINGS.
    expect(
      missingColumnKind(
        driverError("Unbekannte Spalte '_updated_at'", "ER_BAD_FIELD_ERROR")
      )
    ).toBe("statement");
    expect(
      missingColumnKind(driverError("Champ inconnu '_updated_at'", 1054))
    ).toBe("statement");
    expect(
      missingColumnKind(
        driverError("Spalte »draft_key« existiert nicht", "42703")
      )
    ).toBe("statement");
  });

  it("separates an index's missing column from a statement's", () => {
    // MySQL is the only dialect that distinguishes them, and the degraded index push
    // depends on the distinction: 1072 is the precondition a later pass will satisfy.
    expect(
      missingColumnKind(driverError("Schlüsselspalte existiert nicht", 1072))
    ).toBe("index");
    expect(missingColumnKind(driverError("Unbekannte Spalte", 1054))).toBe(
      "statement"
    );
  });

  it("reads a code from a nested cause, where drivers actually put it", () => {
    const wrapped = new Error("Failed query: CREATE UNIQUE INDEX ...", {
      cause: driverError("Schlüsselspalte existiert nicht", 1072),
    });
    expect(missingColumnKind(wrapped)).toBe("index");
  });

  it("does not classify an unrelated error that carries a code", () => {
    expect(
      missingColumnKind(driverError("Deadlock found", 1213))
    ).toBeUndefined();
    expect(
      missingColumnKind(driverError("duplicate key value", "23505"))
    ).toBeUndefined();
  });
});

describe("isMissingNamedColumnError", () => {
  it("accepts the column it was asked about", () => {
    // The name is readable even when the wording is not: MySQL translates the message
    // TEMPLATE and substitutes the identifier into it untranslated.
    expect(
      isMissingNamedColumnError(
        driverError("Unbekannte Spalte '_updated_at' in 'field list'", 1054),
        "_updated_at"
      )
    ).toBe(true);
  });

  it("refuses a DIFFERENT column's absence", () => {
    // A caller tolerating a schema that predates one column must not also swallow a
    // broken query naming another, and report the site as simply having no data.
    expect(
      isMissingNamedColumnError(
        driverError("Unbekannte Spalte '_status' in 'field list'", 1054),
        "_updated_at"
      )
    ).toBe(false);
  });

  it("does not attribute a nested code to the wrapper that quotes the column", () => {
    // The trap the own-code read exists to close, and it needs a nested code to spring:
    // the wrapper's message quotes the statement, so it CONTAINS `_updated_at`, while the
    // driver error underneath is a missing-column error about a DIFFERENT column. A
    // classifier that reached into `.cause` for a code the way `safeCode` does would read
    // the shape from the inner level and the name from the outer one, and report that
    // `_updated_at` is absent on the strength of an error about `_status`.
    const wrapped = new Error(
      "Failed query: select `_updated_at` from dc_pages_locales",
      {
        cause: mysqlError(
          "Unbekannte Spalte '_status' in 'field list'",
          "ER_BAD_FIELD_ERROR",
          1054
        ),
      }
    );
    expect(isMissingNamedColumnError(wrapped, "_updated_at")).toBe(false);
    // The same error read for the column it is actually about still resolves.
    expect(isMissingNamedColumnError(wrapped, "_status")).toBe(true);
  });

  it("does not fire on an unrelated failure under a wrapper naming the column", () => {
    // The trap this module's own-code read exists to close. The wrapper's message quotes
    // the statement, so it CONTAINS the column; the failure underneath is unrelated. A
    // classifier that reached through to a nested code, or that took the name from one
    // level and the shape from another, would call this a missing column.
    const wrapped = new Error(
      "Failed query: select `_updated_at` from dc_pages_locales",
      {
        cause: new Error("disk I/O error"),
      }
    );
    expect(isMissingNamedColumnError(wrapped, "_updated_at")).toBe(false);
  });

  it("survives a cause chain that loops", () => {
    const a = new Error("outer");
    const b = new Error("inner", { cause: a });
    Object.defineProperty(a, "cause", { value: b });
    expect(isMissingNamedColumnError(a, "_updated_at")).toBe(false);
  });
});

describe("missingSchemaObject", () => {
  it("reads the code the adapters give an unregistered table", () => {
    // Core keeps its own copy so it imports no database package; this holds
    // the copy to the adapters' constant.
    expect(TABLE_NOT_REGISTERED_CODE).toBe(ADAPTER_TABLE_NOT_REGISTERED_CODE);
  });

  it("reads a missing table from each dialect's code, in any language", () => {
    // PostgreSQL undefined_table, and MySQL ER_NO_SUCH_TABLE in German: the code
    // classifies, so the translated wording never has to.
    expect(
      missingSchemaObject(
        driverError('relation "dc_posts" does not exist', "42P01")
      )?.object
    ).toBe("table");
    expect(
      missingSchemaObject(
        mysqlError(
          "Tabelle 'site.dc_posts' existiert nicht",
          "ER_NO_SUCH_TABLE",
          1146
        )
      )?.object
    ).toBe("table");
    // SQLite has no code for it, only its wording.
    expect(
      missingSchemaObject(
        driverError("no such table: dc_posts", "SQLITE_ERROR")
      )?.object
    ).toBe("table");
  });

  it("reads a missing column, SQLite's insert wording included", () => {
    expect(
      missingSchemaObject(
        driverError('column "subtitle" does not exist', "42703")
      )?.object
    ).toBe("column");
    expect(
      missingSchemaObject(
        mysqlError(
          "Unbekannte Spalte 'subtitle' in 'field list'",
          "ER_BAD_FIELD_ERROR",
          1054
        )
      )?.object
    ).toBe("column");
    // An INSERT naming an absent column says so differently from a SELECT.
    expect(
      missingSchemaObject(
        driverError(
          "table dc_posts has no column named subtitle",
          "SQLITE_ERROR"
        )
      )?.object
    ).toBe("column");
    expect(
      isMissingColumnError(
        new Error("table dc_posts has no column named subtitle")
      )
    ).toBe(true);
  });

  it("reads a table this instance has not registered from the adapters' code", () => {
    const refusal = driverError(
      'Table "dc_posts" not found in schema registry: this running instance has not registered it.',
      TABLE_NOT_REGISTERED_CODE
    );
    expect(missingSchemaObject(refusal)).toEqual({
      object: "unregistered",
      text: refusal.message,
    });
  });

  it("does not take a missing table for a missing column, or the reverse", () => {
    // PostgreSQL words both "... does not exist"; the code tells them apart.
    expect(
      missingSchemaObject(
        driverError('relation "subtitle" does not exist', "42P01")
      )?.object
    ).toBe("table");
    expect(
      missingSchemaObject(
        driverError('column "dc_posts" does not exist', "42703")
      )?.object
    ).toBe("column");
  });

  it("reads PostgreSQL's write wording for a column as a column, without a code", () => {
    // It names the relation too, so a level whose code a wrapper dropped must
    // not be read as a missing table.
    expect(
      missingSchemaObject(
        new Error('column "title" of relation "dc_posts" does not exist')
      )?.object
    ).toBe("column");
  });

  it("answers with the text of the deepest level that reports it", () => {
    // The wrapper's message is the statement, which names every column it
    // touches; only the driver's own message says which one is missing.
    // The adapter copies the driver's code onto its own error, so both levels
    // classify.
    const wrapped = Object.assign(
      new Error("Failed query: select title, subtitle from dc_posts", {
        cause: driverError('column "subtitle" does not exist', "42703"),
      }),
      { code: "42703" }
    );
    expect(missingSchemaObject(wrapped)).toEqual({
      object: "column",
      text: 'column "subtitle" does not exist',
    });
  });

  it("does not fire on an unrelated failure, however it is wrapped", () => {
    expect(missingSchemaObject(new Error("disk I/O error"))).toBeUndefined();
    expect(
      missingSchemaObject(
        new Error("Failed query: select * from dc_posts", {
          cause: driverError("duplicate key value", "23505"),
        })
      )
    ).toBeUndefined();
  });

  it("survives a cause chain that loops", () => {
    const a = new Error("outer");
    const b = new Error("inner", { cause: a });
    Object.defineProperty(a, "cause", { value: b });
    expect(missingSchemaObject(a)).toBeUndefined();
  });
});

describe("firstIdentifierNamed", () => {
  it("reads only identifiers, never the words of the sentence", () => {
    expect(
      firstIdentifierNamed("table dc_posts has no column named title", [
        "table",
        "column",
        "title",
      ])
    ).toBe("title");
    expect(
      firstIdentifierNamed('column "title" does not exist', ["column", "title"])
    ).toBe("title");
  });

  it("matches a whole identifier, never part of a longer one", () => {
    // `title` is inside `subtitle`, and a missing companion table's name
    // begins with its parent's.
    expect(
      firstIdentifierNamed("Unknown column 'subtitle' in 'field list'", [
        "title",
        "subtitle",
      ])
    ).toBe("subtitle");
    expect(
      firstIdentifierNamed('relation "dc_posts_locales" does not exist', [
        "dc_posts",
      ])
    ).toBeUndefined();
  });

  it("reads a qualified name and a schema-qualified table", () => {
    expect(
      firstIdentifierNamed("column dc_posts.subtitle does not exist", [
        "subtitle",
      ])
    ).toBe("subtitle");
    expect(
      firstIdentifierNamed("Table 'site.dc_posts' doesn't exist", ["dc_posts"])
    ).toBe("dc_posts");
  });

  it("answers the candidate named first when several are named", () => {
    expect(
      firstIdentifierNamed(
        'column "subtitle" of relation "dc_posts" does not exist',
        ["dc_posts", "subtitle"]
      )
    ).toBe("subtitle");
  });
});

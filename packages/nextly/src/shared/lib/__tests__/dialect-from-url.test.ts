// Why: the three adapter READMEs tell an operator that DB_DIALECT is only
// "recommended (auto-detected from URL)". It was not detected. DB_DIALECT
// carried a Zod default of "postgresql", so it was never absent, and the
// factory's URL fallback behind it could not run. An operator who set only
// DATABASE_URL=mysql://... got a PostgreSQL adapter, PostgreSQL identifier
// quoting and the PostgreSQL schema tables, because every one of those reads
// the same env value.
//
// Approach: assert through validateEnvObject, the schema's own entry point,
// rather than against the resolver in isolation, so the test covers the path
// the application actually takes.
import { describe, expect, it } from "vitest";

import { detectDialectFromUrl } from "../../../cli/utils/adapter";
import { dialectFromUrl, validateEnvObject } from "../env";

const base = { NODE_ENV: "development" } as const;

describe("the dialect an operator did not state", () => {
  it("follows a mysql URL", () => {
    expect(
      validateEnvObject({
        ...base,
        DATABASE_URL: "mysql://u:p@localhost:3306/app",
      }).DB_DIALECT
    ).toBe("mysql");
  });

  it("follows a postgres URL, spelled either way", () => {
    expect(
      validateEnvObject({
        ...base,
        DATABASE_URL: "postgres://u:p@localhost:5432/app",
      }).DB_DIALECT
    ).toBe("postgresql");
    expect(
      validateEnvObject({
        ...base,
        DATABASE_URL: "postgresql://u:p@localhost:5432/app",
      }).DB_DIALECT
    ).toBe("postgresql");
  });

  it("follows a sqlite URL, by scheme or by extension", () => {
    // Only values that are also valid URLs can reach the resolver: the schema
    // rejects anything `new URL()` will not take, so a bare `./data/app.db`
    // fails validation before the dialect is ever considered.
    for (const url of [
      "file:./data/nextly.db",
      "sqlite:./app.db",
      "sqlite://./app.sqlite",
    ]) {
      expect(validateEnvObject({ ...base, DATABASE_URL: url }).DB_DIALECT).toBe(
        "sqlite"
      );
    }
  });

  it("rejects a bare filesystem path before any of this matters", () => {
    // Recorded because the factory's suffix rules read as though a plain path
    // works. It does not, and never did: this is a URL field.
    expect(() =>
      validateEnvObject({ ...base, DATABASE_URL: "./data/app.db" })
    ).toThrow();
  });
});

describe("what the operator states wins", () => {
  it("keeps an explicit dialect even when the URL says otherwise", () => {
    // Someone pointing a MySQL-compatible proxy at a postgres:// URL, or
    // testing one dialect against another's URL, has said what they meant.
    expect(
      validateEnvObject({
        ...base,
        DB_DIALECT: "mysql",
        DATABASE_URL: "postgres://u:p@localhost:5432/app",
      }).DB_DIALECT
    ).toBe("mysql");
  });

  it("treats an empty DB_DIALECT as unstated rather than rejecting it", () => {
    expect(
      validateEnvObject({
        ...base,
        DB_DIALECT: "",
        DATABASE_URL: "mysql://u:p@localhost:3306/app",
      }).DB_DIALECT
    ).toBe("mysql");
  });
});

describe("a URL that implies nothing", () => {
  it("still defaults to postgres", () => {
    // The default is unchanged; what changed is that it is now the last
    // answer rather than the only one.
    expect(
      validateEnvObject({
        ...base,
        DATABASE_URL: "mssql://u:p@localhost:1433/app",
      }).DB_DIALECT
    ).toBe("postgresql");
  });
});

describe("the CLI and the schema answer the same question", () => {
  // They used to hold separate copies of these rules, and the copies had
  // drifted: the CLI accepted `.sqlite3` and the schema did not, so the same
  // URL produced one dialect for `nextly migrate` and another for the runtime
  // reading env.DB_DIALECT. This is the test that fails if a copy comes back.
  const urls = [
    "postgres://u:p@h:5432/d",
    "postgresql://u:p@h:5432/d",
    "mysql://u:p@h:3306/d",
    "file:./data/nextly.db",
    "sqlite:./app.db",
    "sqlite://./app.sqlite",
    "sqlite:./app.sqlite3",
    "mssql://u:p@h:1433/d",
    "",
  ];

  it("agrees on every form either of them accepted", () => {
    for (const url of urls) {
      expect(detectDialectFromUrl(url)).toBe(dialectFromUrl(url));
    }
  });

  it("keeps the .sqlite3 form the CLI accepted", () => {
    // Losing it would have been a silent narrowing: a narrower rule is only
    // better if it is also complete.
    expect(dialectFromUrl("sqlite:./app.sqlite3")).toBe("sqlite");
    expect(
      validateEnvObject({ ...base, DATABASE_URL: "sqlite:./app.sqlite3" })
        .DB_DIALECT
    ).toBe("sqlite");
  });
});

describe("an empty dialect never reaches the enum", () => {
  it("takes the default when the URL implies nothing", () => {
    // `DB_DIALECT=""` left in place was rejected by the enum instead of
    // reading as unstated, which contradicted the rule stated one line above it.
    expect(
      validateEnvObject({
        ...base,
        DB_DIALECT: "",
        DATABASE_URL: "mssql://u:p@h:1433/d",
      }).DB_DIALECT
    ).toBe("postgresql");
  });
});

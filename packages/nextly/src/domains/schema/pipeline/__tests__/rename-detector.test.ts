import { describe, expect, it } from "vitest";

import { RegexRenameDetector } from "../rename-detector.js";

const detector = new RegexRenameDetector();

function emptyTypes(): Map<string, Map<string, string>> {
  return new Map();
}

function typesFor(
  table: string,
  cols: Record<string, string>
): Map<string, Map<string, string>> {
  return new Map([[table, new Map(Object.entries(cols))]]);
}

describe("RegexRenameDetector - empty / edge inputs", () => {
  it("returns [] for empty statements", () => {
    expect(detector.detect([], "postgresql", emptyTypes())).toEqual([]);
  });

  it("returns [] when only DROPs (no ADDs to pair with)", () => {
    const stmts = [`ALTER TABLE "dc_posts" DROP COLUMN "title";`];
    expect(detector.detect(stmts, "postgresql", emptyTypes())).toEqual([]);
  });

  it("returns [] when only ADDs (no DROPs to pair with)", () => {
    const stmts = [`ALTER TABLE "dc_posts" ADD COLUMN "name" text;`];
    expect(detector.detect(stmts, "postgresql", emptyTypes())).toEqual([]);
  });

  it("ignores non-DROP/non-ADD statements (e.g., ALTER TYPE, CREATE TABLE)", () => {
    const stmts = [
      `CREATE TABLE "dc_posts" ("id" serial);`,
      `ALTER TABLE "dc_posts" ALTER COLUMN "bio" SET DATA TYPE varchar(255);`,
    ];
    expect(detector.detect(stmts, "postgresql", emptyTypes())).toEqual([]);
  });
});

describe("RegexRenameDetector - spec acceptance criteria", () => {
  it("simple PG: text -> text yields 1 candidate, typesCompatible:true", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "name" text;`,
    ];
    const types = typesFor("dc_posts", { title: "text" });
    const result = detector.detect(stmts, "postgresql", types);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "title",
      toColumn: "name",
      fromType: "text",
      toType: "text",
      typesCompatible: true,
      defaultSuggestion: "rename",
    });
  });

  it("MySQL combined statement yields same result as separate statements", () => {
    const stmts = [
      "ALTER TABLE `dc_posts` DROP COLUMN `title`, ADD COLUMN `name` text",
    ];
    const types = typesFor("dc_posts", { title: "text" });
    const result = detector.detect(stmts, "mysql", types);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tableName: "dc_posts",
      fromColumn: "title",
      toColumn: "name",
      typesCompatible: true,
      defaultSuggestion: "rename",
    });
  });

  it('PG schema-qualified: "public"."dc_posts" -> tableName \'dc_posts\'', () => {
    const stmts = [
      `ALTER TABLE "public"."dc_posts" DROP COLUMN "title";`,
      `ALTER TABLE "public"."dc_posts" ADD COLUMN "name" text;`,
    ];
    const types = typesFor("dc_posts", { title: "text" });
    const result = detector.detect(stmts, "postgresql", types);
    expect(result).toHaveLength(1);
    expect(result[0].tableName).toBe("dc_posts");
  });

  it("SQLite recreate-pattern produces ZERO candidates", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer, "title" text);`,
      `INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";`,
    ];
    expect(detector.detect(stmts, "sqlite", emptyTypes())).toEqual([]);
  });

  it("type incompatibility: int -> date yields typesCompatible:false, defaultSuggestion:drop_and_add", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "age";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "dob" date;`,
    ];
    const types = typesFor("dc_posts", { age: "int4" });
    const result = detector.detect(stmts, "postgresql", types);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "age",
      toColumn: "dob",
      fromType: "int4",
      toType: "date",
      typesCompatible: false,
      defaultSuggestion: "drop_and_add",
    });
  });

  it("multi-table: DROPs on table A and ADDs on table B do NOT cross-pair", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
      `ALTER TABLE "dc_users" ADD COLUMN "name" text;`,
    ];
    const types = new Map([["dc_posts", new Map([["title", "text"]])]]);
    const result = detector.detect(stmts, "postgresql", types);
    expect(result).toEqual([]);
  });

  it("multi-rename within table: 3 DROPs + 3 ADDs yields 9 raw candidates", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "a";`,
      `ALTER TABLE "dc_posts" DROP COLUMN "b";`,
      `ALTER TABLE "dc_posts" DROP COLUMN "c";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "x" text;`,
      `ALTER TABLE "dc_posts" ADD COLUMN "y" text;`,
      `ALTER TABLE "dc_posts" ADD COLUMN "z" text;`,
    ];
    const types = typesFor("dc_posts", { a: "text", b: "text", c: "text" });
    const result = detector.detect(stmts, "postgresql", types);
    expect(result).toHaveLength(9);
    expect(result.every(c => c.typesCompatible === true)).toBe(true);
    expect(result.every(c => c.defaultSuggestion === "rename")).toBe(true);
  });

  it("defensive: missing fromType (col not in map) yields fromType:'', typesCompatible:false", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "mystery";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "name" text;`,
    ];
    const result = detector.detect(stmts, "postgresql", emptyTypes());
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "mystery",
      toColumn: "name",
      fromType: "",
      toType: "text",
      typesCompatible: false,
      defaultSuggestion: "drop_and_add",
    });
  });
});

describe("RegexRenameDetector - deterministic ordering", () => {
  it("sorts output by (tableName, fromColumn, toColumn)", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "z";`,
      `ALTER TABLE "dc_posts" DROP COLUMN "a";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "y" text;`,
      `ALTER TABLE "dc_posts" ADD COLUMN "b" text;`,
    ];
    const types = typesFor("dc_posts", { a: "text", z: "text" });
    const result = detector.detect(stmts, "postgresql", types);
    expect(result.map(r => [r.fromColumn, r.toColumn])).toEqual([
      ["a", "b"],
      ["a", "y"],
      ["z", "b"],
      ["z", "y"],
    ]);
  });
});

describe("RegexRenameDetector - plan-v3 Appendix D worked example (10-field rename)", () => {
  it("produces 49 raw candidates with correct type-compatibility flags", () => {
    // Before columns: name(text), phone(text), email(text), age(int4),
    //                 state(text), country(text), zip(text)
    // After columns:  mobile_number(text), full_name(text), email_address(text),
    //                 dob(date), state_initials(text), zip_code(text),
    //                 country_code(text)
    const stmts = [
      // 7 drops
      `ALTER TABLE "dc_user" DROP COLUMN "name";`,
      `ALTER TABLE "dc_user" DROP COLUMN "phone";`,
      `ALTER TABLE "dc_user" DROP COLUMN "email";`,
      `ALTER TABLE "dc_user" DROP COLUMN "age";`,
      `ALTER TABLE "dc_user" DROP COLUMN "state";`,
      `ALTER TABLE "dc_user" DROP COLUMN "country";`,
      `ALTER TABLE "dc_user" DROP COLUMN "zip";`,
      // 7 adds
      `ALTER TABLE "dc_user" ADD COLUMN "mobile_number" text;`,
      `ALTER TABLE "dc_user" ADD COLUMN "full_name" text;`,
      `ALTER TABLE "dc_user" ADD COLUMN "email_address" text;`,
      `ALTER TABLE "dc_user" ADD COLUMN "dob" date;`,
      `ALTER TABLE "dc_user" ADD COLUMN "state_initials" text;`,
      `ALTER TABLE "dc_user" ADD COLUMN "zip_code" text;`,
      `ALTER TABLE "dc_user" ADD COLUMN "country_code" text;`,
    ];
    const types = typesFor("dc_user", {
      name: "text",
      phone: "text",
      email: "text",
      age: "int4",
      state: "text",
      country: "text",
      zip: "text",
    });
    const result = detector.detect(stmts, "postgresql", types);

    // Cartesian: 7 drops x 7 adds = 49 raw candidates.
    expect(result).toHaveLength(49);

    // Compat math:
    //   6 text-source columns (name, phone, email, state, country, zip)
    //     each can match 6 text-target columns (mobile_number, full_name,
    //     email_address, state_initials, zip_code, country_code) = 36 compat
    //   age (int4) cannot match any of the 7 targets = 0 compat
    //   each of the 6 text-source columns -> dob (date) = 6 incompat
    // Total compat = 36; incompat = 49 - 36 = 13.
    const compatCount = result.filter(c => c.typesCompatible).length;
    const incompatCount = result.filter(c => !c.typesCompatible).length;
    expect(compatCount).toBe(36);
    expect(incompatCount).toBe(13);

    // Spot-check: name -> full_name (text -> text) is compatible.
    const nameToFullName = result.find(
      c => c.fromColumn === "name" && c.toColumn === "full_name"
    );
    expect(nameToFullName?.typesCompatible).toBe(true);
    expect(nameToFullName?.defaultSuggestion).toBe("rename");

    // Spot-check: age -> mobile_number (int -> text) is incompatible.
    const ageToMobile = result.find(
      c => c.fromColumn === "age" && c.toColumn === "mobile_number"
    );
    expect(ageToMobile?.typesCompatible).toBe(false);
    expect(ageToMobile?.defaultSuggestion).toBe("drop_and_add");

    // Spot-check: age -> dob (int -> date) is also incompatible.
    const ageToDob = result.find(
      c => c.fromColumn === "age" && c.toColumn === "dob"
    );
    expect(ageToDob?.typesCompatible).toBe(false);
  });
});

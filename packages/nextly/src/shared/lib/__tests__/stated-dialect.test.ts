/**
 * The dialect `withNextly` reads the migrations folder as, from the
 * environment, by the rules the environment's schema parses with: a stated
 * `DB_DIALECT` wins, else the one `DATABASE_URL` implies, else PostgreSQL.
 */
import { describe, expect, it } from "vitest";

import { statedDialect } from "../stated-dialect";

describe("statedDialect", () => {
  it("is DB_DIALECT where it names one, whatever the URL implies", () => {
    expect(
      statedDialect({ DB_DIALECT: "mysql", DATABASE_URL: "file:./app.db" })
    ).toBe("mysql");
  });

  it("is the dialect the URL implies where DB_DIALECT is unstated or names none", () => {
    expect(statedDialect({ DATABASE_URL: "file:./app.db" })).toBe("sqlite");
    expect(
      statedDialect({ DB_DIALECT: "", DATABASE_URL: "mysql://u:p@h/db" })
    ).toBe("mysql");
  });

  it("is PostgreSQL where neither says", () => {
    expect(statedDialect({})).toBe("postgresql");
  });
});

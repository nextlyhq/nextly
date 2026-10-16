/**
 * The env generator decides which database a file is set up for by the same
 * rule Nextly applies at start-up when DB_DIALECT is unset. The two packages
 * cannot share the code (the generator does not depend on nextly), so this
 * holds the copies together: a change to either that the other lacks fails
 * here.
 */
import { describe, expect, it } from "vitest";

import { dialectFromUrl } from "../../../nextly/src/shared/lib/env";
import { dialectOfUrl } from "../generators/env";

describe("the dialect a database URL implies", () => {
  it.each([
    "postgres://localhost/app",
    "postgresql://u:p@db:5432/app",
    "mysql://root@localhost:3306/app",
    "file:./data/nextly.db",
    "./data/nextly.db",
    "app.sqlite",
    "app.sqlite3",
    "sqlite://app",
    "mysql2://localhost/app",
    "https://example.com",
    "",
  ])("is the same for the generator and Nextly: %s", url => {
    expect(dialectOfUrl(url)).toBe(dialectFromUrl(url));
  });
});

/**
 * The row lock each use takes on each server.
 *
 * The strength is the whole contract: a lock the server rejects fails every
 * statement that asks for it, and an exclusive lock where a shared one would
 * do makes every write naming one account queue on its row.
 */
import { describe, expect, it } from "vitest";

import { rowLockStrength, type RowLockServer } from "../row-lock";

const MYSQL_8: RowLockServer = { dialect: "mysql", sharedRowLock: true };
const MARIADB: RowLockServer = { dialect: "mysql", sharedRowLock: false };
const MYSQL_UNKNOWN: RowLockServer = { dialect: "mysql" };

describe("rowLockStrength", () => {
  it.each([
    ["PostgreSQL", "share", { dialect: "postgresql" } as RowLockServer],
    ["MySQL 8", "share", MYSQL_8],
    ["MariaDB or TiDB", "update", MARIADB],
    ["a MySQL server not yet known", "update", MYSQL_UNKNOWN],
    ["SQLite", null, { dialect: "sqlite" } as RowLockServer],
  ] as const)("an existence check on %s takes %s", (_, strength, server) => {
    expect(rowLockStrength(server, "existence-check")).toBe(strength);
  });

  it.each([
    ["PostgreSQL", "share", { dialect: "postgresql" } as RowLockServer],
    ["MySQL 8", "update", MYSQL_8],
    ["MariaDB or TiDB", "update", MARIADB],
    ["a MySQL server not yet known", "update", MYSQL_UNKNOWN],
    ["SQLite", null, { dialect: "sqlite" } as RowLockServer],
  ] as const)("a session-row write on %s takes %s", (_, strength, server) => {
    // Exclusive on every MySQL server, even one that accepts a shared lock:
    // it only orders concurrent sign-ins of one account.
    expect(rowLockStrength(server, "session")).toBe(strength);
  });
});

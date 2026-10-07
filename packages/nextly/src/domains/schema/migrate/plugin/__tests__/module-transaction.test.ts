/**
 * A module's `transaction` field in its checksum.
 *
 * A module that runs in a transaction, marked `true` or not marked at all,
 * must hash exactly as a module sealed before the field existed: its
 * checksum is in shipped plugins and in installations' ledgers, and a moved
 * hash refuses a module nobody touched. The values pinned here were taken
 * from the implementation before the field was added.
 */
import { describe, expect, it } from "vitest";

import type { ContributedElements } from "../../../pipeline/diff/types";
import { migrationChecksum, type MigrationContent } from "../plugin-migration";

const table = {
  name: "fx__notes",
  columns: [{ name: "id", type: "text", nullable: false }],
};
const sides = {
  postgresql: { tables: [table] },
  mysql: { tables: [table] },
  sqlite: { tables: [table] },
};
const empty = {
  postgresql: { tables: [] },
  mysql: { tables: [] },
  sqlite: { tables: [] },
};
const content = {
  name: "0001_init",
  schemaVersion: 1,
  dialects: {
    postgresql: {
      up: ['CREATE TABLE "fx__notes" ("id" text PRIMARY KEY)'],
      down: ['DROP TABLE "fx__notes"'],
    },
    mysql: {
      up: ["CREATE TABLE `fx__notes` (`id` varchar(36) PRIMARY KEY)"],
      down: ["DROP TABLE `fx__notes`"],
    },
    sqlite: {
      up: ['CREATE TABLE "fx__notes" ("id" text PRIMARY KEY)'],
      down: ['DROP TABLE "fx__notes"'],
    },
  },
  snapshot: sides,
  before: empty,
} as MigrationContent;
const contributions: Record<string, ContributedElements> = {
  users: { columns: ["nickname"], indexes: [], foreignKeys: [], checks: [] },
};
const withContributions: MigrationContent = {
  ...content,
  contributions: { postgresql: contributions },
};

const SEALED =
  "5ce2be114858c142377bef1e4681882756d49e9ad9cfb3161138725482272ddf";
const SEALED_WITH_CONTRIBUTIONS =
  "ec1a64d6ae474600d2b336355a3c47a89ff60f05f5e40608cccedac3fb47e238";

describe("a module's transaction field in its checksum", () => {
  it("leaves the checksum of a module that runs in a transaction as it was", () => {
    expect(migrationChecksum(content)).toBe(SEALED);
    expect(migrationChecksum({ ...content, transaction: true })).toBe(SEALED);
    expect(migrationChecksum(withContributions)).toBe(
      SEALED_WITH_CONTRIBUTIONS
    );
    expect(migrationChecksum({ ...withContributions, transaction: true })).toBe(
      SEALED_WITH_CONTRIBUTIONS
    );
  });

  it("seals `transaction: false`, so it cannot be added or removed unnoticed", () => {
    const marked = migrationChecksum({ ...content, transaction: false });
    const markedWithContributions = migrationChecksum({
      ...withContributions,
      transaction: false,
    });
    expect(marked).not.toBe(SEALED);
    expect(markedWithContributions).not.toBe(SEALED_WITH_CONTRIBUTIONS);
    // Distinct from each other too: the marker is not read as contributions.
    expect(marked).not.toBe(markedWithContributions);
  });
});

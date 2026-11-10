// Every reader of the migrations folder, compared with the list of readers
// that leave old Schema Builder files out. A file that starts listing the
// folder fails here until it is added below with how it leaves them out, so
// a reader added later cannot read an old Builder file as a migration.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A product file listing the folder: through the shared reading, or by its own `readdir`. */
const READS_THE_FOLDER =
  /\b(?:discoverMigrationGroups|readMigrationFolder|migrationFilesInRunOrder|readableMigrationFiles)\(|readdir\(\s*migrationsDir\b/;

/** Each reader, with how it leaves old Builder files out. */
const READERS: Record<string, string> = {
  "cli/utils/migration-discovery.ts":
    "the shared reading: `readMigrationFolder` takes them out, `discoverMigrationGroups`, `migrationFilesInRunOrder` and `readableMigrationFiles` derive from it",
  "cli/commands/migrate.ts":
    "`nextly migrate`, the boot step and the dry run read through `migrationFilesInRunOrder` and name them",
  "cli/commands/migrate-check.ts":
    "drops them from its own listing by `readMigrationFolder`, and names them",
  "cli/commands/migrate-status.ts":
    "reads through `readableMigrationFiles`, lists them in `ignoredOldBuilderFiles`",
  "cli/commands/migrate-baseline.ts":
    "drops them from its own listing by `readMigrationFolder`; their rows are no history",
  "cli/commands/migrate-resolve.ts":
    "finds the file it records through `discoverMigrationGroups`",
  "cli/commands/build.ts": "reads through `readableMigrationFiles`",
  "cli/commands/migrate-fresh.ts":
    "its dry run lists the files through `discoverMigrationGroups` with the dialect and declared names `nextly migrate` reads them with",
  "domains/schema/migrate/pending-entities.ts":
    "reads through `discoverMigrationGroups`",
  "domains/schema/migrate/old-builder-ledger.ts":
    "reads `readMigrationFolder` to judge their ledger rows",
  "domains/dynamic-collections/services/removed-from-code-state.ts":
    "reads through `discoverMigrationGroups`, so an old drop file names no removal",
  "domains/i18n/migration/companion-history.ts":
    "replays only files carrying the localization intent header or marker; an old Builder file carries neither, so it reads as `other`",
};

/**
 * How each reader stands to the ledger's old Builder marks, under which a file
 * as its mark recorded keeps that identity whatever is declared since. A
 * reader that has the database names the call it reads them through, which
 * the scan finds in it; one that has none says why it reads without them.
 */
const MARKS: Record<string, { reads: string } | { without: string }> = {
  "cli/utils/migration-discovery.ts": {
    without:
      "the shared reading applies the marks its caller passes in `DeclaredNames.marks`",
  },
  "cli/commands/migrate.ts": {
    reads: "withOldBuilderMarks(",
  },
  "cli/commands/migrate-check.ts": {
    without: "it runs offline, in CI, with no database to read a ledger from",
  },
  "cli/commands/migrate-status.ts": { reads: "withOldBuilderMarks(" },
  "cli/commands/migrate-baseline.ts": { reads: "withOldBuilderMarks(" },
  "cli/commands/migrate-resolve.ts": { reads: "withOldBuilderMarks(" },
  "cli/commands/build.ts": {
    without:
      "it bundles the files with no database; the boot reads them under the marks",
  },
  "cli/commands/migrate-fresh.ts": {
    without:
      "it empties the ledger before its run, so its dry run lists the files as a run on an empty ledger reads them",
  },
  "domains/schema/migrate/pending-entities.ts": {
    without:
      "it reads under the declared names `migrateCore` hands it, the marks among them",
  },
  "domains/schema/migrate/old-builder-ledger.ts": {
    reads: "currentOldBuilderMarks()",
  },
  "domains/dynamic-collections/services/removed-from-code-state.ts": {
    without:
      "it describes a removed entity for a request, reading no ledger and declaring nothing",
  },
  "domains/i18n/migration/companion-history.ts": {
    without: "it reads only files a header marks, which no old Builder file is",
  },
};

function productFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productFiles(path);
    }
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("the readers of the migrations folder", () => {
  it("are exactly the readers that leave old Builder files out", () => {
    const readers = productFiles(SRC)
      .filter(file => READS_THE_FOLDER.test(readFileSync(file, "utf8")))
      .map(file => relative(SRC, file).split("\\").join("/"))
      .sort();
    // Read, not assumed: the scan finds the command every reader leads to.
    expect(readers).toContain("cli/commands/migrate.ts");
    expect(readers).toEqual(Object.keys(READERS).sort());
  });

  it("each say how they stand to the ledger's marks, and read them where they say so", () => {
    expect(Object.keys(MARKS).sort()).toEqual(Object.keys(READERS).sort());
    for (const [file, stance] of Object.entries(MARKS)) {
      if (!("reads" in stance)) continue;
      const text = readFileSync(join(SRC, file), "utf8");
      expect(text.includes(stance.reads), `${file} reads the marks`).toBe(true);
    }
  });
});

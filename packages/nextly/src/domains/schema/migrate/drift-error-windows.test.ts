/**
 * The recovery an unadopted database's drift error prints, as Windows prints it.
 *
 * `node:path` here is Windows' own, on whatever machine runs the suite, so the
 * commands are the ones a Windows terminal shows. Windows reads both
 * separators, and each command keeps the one its migration's path is written
 * with: a pasted line that mixes them names the right files, but reads as two
 * different folders.
 *
 * @module domains/schema/migrate/drift-error-windows.test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:path", async () => {
  const { win32 } =
    await vi.importActual<typeof import("node:path")>("node:path");
  return { ...win32, default: win32 };
});

import { migrationDriftError } from "./drift-error";

/** The `mv` and `rm` lines of the recovery for the migration at `file`. */
function cleanupFor(file: string): { mv?: string; rm?: string } {
  const { publicMessage } = migrationDriftError({
    migration: "20261020_120000_000_initial",
    file,
    driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
    unadoptedDatabase: true,
  });
  const command = (verb: string) =>
    publicMessage
      .split("\n")
      .map(line => line.trim())
      .find(line => line.startsWith(`${verb} `));
  return { mv: command("mv"), rm: command("rm") };
}

describe("the drift error's cleanup commands on Windows", () => {
  it("keeps the backslashes of a path Windows resolved", () => {
    expect(
      cleanupFor(
        "C:\\Users\\a b\\app\\migrations\\20261020_120000_000_initial.sql"
      )
    ).toEqual({
      mv: "mv 'C:\\Users\\a b\\app\\migrations' 'C:\\Users\\a b\\app\\migrations.pre-baseline'",
      rm: "rm 'C:\\Users\\a b\\app\\migrations\\20261020_120000_000_initial'*.sql 'C:\\Users\\a b\\app\\migrations\\meta\\20261020_120000_000_initial.snapshot.json'",
    });
  });

  it("keeps the forward slashes of a path written with them", () => {
    expect(
      cleanupFor("/home/you/app/migrations/20261020_120000_000_initial.sql")
    ).toEqual({
      mv: "mv '/home/you/app/migrations' '/home/you/app/migrations.pre-baseline'",
      rm: "rm '/home/you/app/migrations/20261020_120000_000_initial'*.sql '/home/you/app/migrations/meta/20261020_120000_000_initial.snapshot.json'",
    });
  });
});

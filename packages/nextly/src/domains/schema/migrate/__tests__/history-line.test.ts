/**
 * A project's migration history read as a line: each snapshot names the
 * migration it was written from. Migrations written without each other are
 * refused, with the files named, until a migration written after them
 * records the merge. Snapshots that name no parent of their own are never
 * refused.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HISTORY_FORKED_REASON,
  forkedHistoryError,
  mergedBy,
  nothingToRecordNotice,
  refuseForkedHistory,
  unrecordedMerges,
} from "../history-line";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-history-line-"));
  mkdirSync(join(dir, "meta"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A written migration: its file and its snapshot, recording `parent` where
 * one is given, and the branch ends it `merges`. `"none"` writes a snapshot
 * from before parents were recorded; `copiedFrom` one copied by hand from
 * that migration's.
 */
function migration(
  base: string,
  parent: string | null | "none",
  copiedFrom?: string,
  merges: string[] = []
): void {
  writeFileSync(join(dir, `${base}.sql`), "");
  writeFileSync(
    join(dir, "meta", `${base}.snapshot.json`),
    JSON.stringify({
      version: 1,
      snapshot: { tables: [] },
      ...(parent === "none"
        ? {}
        : {
            parent,
            migration: copiedFrom ?? base,
            ...(merges.length > 0 ? { merges } : {}),
          }),
    })
  );
}

describe("the merges a migration history does not record", () => {
  it("finds none in a line, each migration written from the one before", async () => {
    migration("0001_a", null);
    migration("0002_b", "0001_a");
    migration("0003_c", "0002_b");

    expect(await unrecordedMerges(dir)).toEqual([]);
    expect(await mergedBy(dir, "0003_c")).toEqual([]);
    await refuseForkedHistory(dir);
  });

  it("finds two migrations written from one parent, in file order", async () => {
    migration("0001_a", null);
    migration("0003_c", "0001_a");
    migration("0002_b", "0001_a");

    expect(await unrecordedMerges(dir)).toEqual([
      {
        parent: "0001_a",
        migrations: ["0002_b", "0003_c"],
        members: ["0002_b", "0003_c"],
        newest: ["0003_c"],
      },
    ]);
  });

  it("finds two written each as the project's first, and three from one parent", async () => {
    migration("0001_a", null);
    migration("0002_b", null);
    expect((await unrecordedMerges(dir))[0]).toMatchObject({
      parent: null,
      migrations: ["0001_a", "0002_b"],
    });

    migration("0002_b", "0001_a");
    migration("0003_c", "0001_a");
    migration("0004_d", "0001_a");
    expect((await unrecordedMerges(dir))[0]).toMatchObject({
      parent: "0001_a",
      migrations: ["0002_b", "0003_c", "0004_d"],
      newest: ["0004_d"],
    });
  });

  it("is not settled by a migration that only follows one of the branches", async () => {
    migration("0001_p", null);
    migration("0002_a", "0001_p");
    migration("0003_b", "0001_p");
    // Written on `b`'s branch, without `a`: it follows `b` and records no merge.
    migration("0004_c", "0003_b");

    expect(await unrecordedMerges(dir)).toEqual([
      {
        parent: "0001_p",
        migrations: ["0002_a", "0003_b"],
        members: ["0002_a", "0003_b", "0004_c"],
        newest: ["0003_b", "0004_c"],
      },
    ]);
  });

  it("finds none once a migration written with both in the folder records the merge", async () => {
    migration("0001_p", null);
    migration("0002_a", "0001_p");
    migration("0003_b", "0001_p");
    // What `migrate:create` records, written from the newest with the other there.
    expect(await mergedBy(dir, "0003_b")).toEqual(["0002_a"]);
    migration("0004_record_merge", "0003_b", undefined, ["0002_a"]);

    expect(await unrecordedMerges(dir)).toEqual([]);

    // And one written after it from `b`, without the record or what it
    // merged, is found against both.
    migration("0005_e", "0003_b");
    expect((await unrecordedMerges(dir))[0]).toMatchObject({
      members: ["0002_a", "0004_record_merge", "0005_e"],
      newest: ["0005_e"],
    });
  });

  it("trusts snapshots written before parents were recorded, in their file order", async () => {
    migration("0001_a", "none");
    migration("0002_b", "none");
    migration("0003_c", "none");
    // The first written since: it starts the chain.
    migration("0004_d", "0003_c");

    expect(await unrecordedMerges(dir)).toEqual([]);
  });

  it("trusts a snapshot copied by hand for a hand-written migration", async () => {
    migration("0001_a", null);
    migration("0002_b", "0001_a");
    // `0002_b`'s snapshot under another name: it says nothing of this one's parent.
    migration("0003_data_only", "0001_a", "0002_b");
    migration("0004_c", "0003_data_only");

    expect(await unrecordedMerges(dir)).toEqual([]);
  });

  it("does not count a migration against the one it was written from, though it is named before it", async () => {
    migration("0001_a", null);
    migration("0003_c", "0001_a");
    // Written from `0003_c`, on a machine whose clock was behind.
    migration("0002_b", "0003_c");

    expect(await unrecordedMerges(dir)).toEqual([]);
    // The next migration is written from the newest by name, and records
    // the one named before it.
    expect(await mergedBy(dir, "0003_c")).toEqual(["0002_b"]);
  });

  it("refuses nothing over a parent that is no longer in the folder", async () => {
    migration("0001_a", null);
    migration("0003_c", "0002_removed");

    expect(await unrecordedMerges(dir)).toEqual([]);
  });

  it("counts no snapshot whose migration file was never written, and none in an empty folder", async () => {
    migration("0001_a", null);
    migration("0002_b", "0001_a");
    // A snapshot alone, as a writer stopped between its two files leaves it.
    writeFileSync(
      join(dir, "meta", "0003_c.snapshot.json"),
      JSON.stringify({
        version: 1,
        snapshot: { tables: [] },
        parent: "0001_a",
        migration: "0003_c",
      })
    );
    expect(await unrecordedMerges(dir)).toEqual([]);

    rmSync(join(dir, "meta"), { recursive: true });
    expect(await unrecordedMerges(dir)).toEqual([]);
    expect(await mergedBy(dir, null)).toEqual([]);
  });
});

describe("the refusal of a merge nothing records", () => {
  const merge = {
    parent: "0001_a",
    migrations: ["0002_b", "0003_c"],
    members: ["0002_b", "0003_c"],
    newest: ["0003_c"],
  };

  it("names both files and how to record the merge, where no database says which is applied", () => {
    const refusal = forkedHistoryError([merge]);

    expect(refusal?.logContext?.reason).toBe(HISTORY_FORKED_REASON);
    expect(refusal?.publicMessage).toBe(
      "Two migrations were written from 0001_a.sql: 0002_b.sql and 0003_c.sql. " +
        "Each was written without the others' changes, so none of them was applied: " +
        "nothing yet records them together. " +
        "Run `nextly migrate:create --name record_merge` to record the merge; if they make " +
        "the same change, delete all but one of them, with their snapshots, instead."
    );
  });

  it("names the one not applied, where the other is applied on the database read", () => {
    const refusal = forkedHistoryError([merge], new Set(["0001_a", "0003_c"]));

    expect(refusal?.publicMessage).toBe(
      "Two migrations were written from 0001_a.sql: 0002_b.sql and 0003_c.sql. " +
        "0003_c.sql is applied on this database, and 0002_b.sql was written without its " +
        "changes, so it was not applied. " +
        "Run `nextly migrate:create --name record_merge` to record the merge; if 0002_b.sql " +
        "makes the same change, delete it and its snapshot instead."
    );
  });

  it("refuses while a later migration of a branch is not applied, though each first one is", () => {
    const refusal = forkedHistoryError(
      [{ ...merge, members: ["0002_b", "0003_c", "0004_d"] }],
      new Set(["0002_b", "0003_c"])
    );

    expect(refusal?.publicMessage).toContain(
      "0002_b.sql and 0003_c.sql are applied on this database, and 0004_d.sql was written without their changes"
    );
  });

  it("refuses nothing where every one of them is already applied, or where there is none", () => {
    expect(
      forkedHistoryError([merge], new Set(["0001_a", "0002_b", "0003_c"]))
    ).toBeUndefined();
    expect(forkedHistoryError([])).toBeUndefined();
  });

  it("says they were written without each other where they do not share a parent", () => {
    expect(
      forkedHistoryError([{ ...merge, parent: undefined }])?.publicMessage
    ).toMatch(/^0002_b\.sql and 0003_c\.sql were written without each other\./);
  });
});

describe("what migrate:create says where it finds nothing to record", () => {
  it("names the migrations written without the newest, and when to delete them", async () => {
    migration("0001_a", null);
    migration("0002_b", "0001_a");
    migration("0003_c", "0001_a");

    expect(await nothingToRecordNotice(dir)).toBe(
      "Two migrations were written from 0001_a.sql: 0002_b.sql and 0003_c.sql. " +
        "The configuration is what 0003_c.sql records, so there is no merge to write. " +
        "0002_b.sql was written without it: if its change is the same, or no longer wanted, " +
        "delete it and its snapshot; if it is wanted, make the change in the configuration " +
        "and run `nextly migrate:create` again."
    );
  });

  it("says nothing where the history is one line", async () => {
    migration("0001_a", null);
    migration("0002_b", "0001_a");

    expect(await nothingToRecordNotice(dir)).toBeUndefined();
  });
});

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
  blankLineHeader,
  blankLineIn,
  forkedHistoryError,
  mergedBy,
  nothingToRecordNotice,
  refuseForkedHistory,
  refuseUnrecordableMerge,
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
  merges: string[] = [],
  tables: Record<string, string[]> = {}
): void {
  writeFileSync(join(dir, `${base}.sql`), "");
  writeFileSync(
    join(dir, "meta", `${base}.snapshot.json`),
    JSON.stringify({
      version: 1,
      snapshot: {
        tables: Object.entries(tables).map(([name, columns]) => ({
          name,
          columns: columns.map(column => ({ name: column, type: "text" })),
        })),
      },
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

/** A blank migration: a `.sql` file alone, stating its place in its header. */
function blank(
  base: string,
  parent: string | null,
  merges: string[] = []
): void {
  writeFileSync(
    join(dir, `${base}.sql`),
    `-- Migration: ${base}\n${blankLineHeader({ parent, merges })}--\n-- UP\n`
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
        overlap: [],
        blank: false,
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
        overlap: [],
        blank: false,
      },
    ]);
  });

  it("names what both branches change: a column each touched, or a table each added", async () => {
    const posts = (...columns: string[]) => ({ dc_posts: ["id", ...columns] });
    migration("0001_p", null, undefined, [], posts("x"));
    // One branch renames `x` to `title`; the other drops `x`.
    migration("0002_a", "0001_p", undefined, [], posts("title"));
    migration("0003_b", "0001_p", undefined, [], posts());
    expect((await unrecordedMerges(dir))[0].overlap).toEqual(["dc_posts.x"]);

    // Each adds a column of its own: nothing both change.
    migration("0002_a", "0001_p", undefined, [], posts("x", "color"));
    migration("0003_b", "0001_p", undefined, [], posts("x", "size"));
    expect((await unrecordedMerges(dir))[0].overlap).toEqual([]);

    // Each adds the same table: the same change, written twice.
    migration("0002_a", "0001_p", undefined, [], {
      ...posts("x"),
      dc_tags: ["id"],
    });
    migration("0003_b", "0001_p", undefined, [], {
      ...posts("x"),
      dc_tags: ["id"],
    });
    expect((await unrecordedMerges(dir))[0].overlap).toEqual(["dc_tags"]);
  });

  it("counts an index on a column as a change to that column", async () => {
    const posts = (columns: string[], indexed: string[]) => ({
      version: 1,
      snapshot: {
        tables: [
          {
            name: "dc_posts",
            columns: columns.map(name => ({ name, type: "text" })),
            indexes: indexed.map(column => ({
              name: `idx_${column}`,
              columns: [column],
            })),
          },
        ],
      },
    });
    const write = (base: string, parent: string | null, file: object) => {
      writeFileSync(join(dir, `${base}.sql`), "");
      writeFileSync(
        join(dir, "meta", `${base}.snapshot.json`),
        JSON.stringify({ ...file, parent, migration: base })
      );
    };
    write("0001_p", null, posts(["id", "x"], []));
    // One branch drops `x`; the other adds an index on it.
    write("0002_a", "0001_p", posts(["id"], []));
    write("0003_b", "0001_p", posts(["id", "x"], ["x"]));

    expect((await unrecordedMerges(dir))[0].overlap).toEqual(["dc_posts.x"]);

    // An index on another column is no change to `x`.
    write("0003_b", "0001_p", posts(["id", "x"], ["id"]));
    expect((await unrecordedMerges(dir))[0].overlap).toEqual([]);
  });

  it("keeps two migrations written from the same parent apart where that parent was removed", async () => {
    migration("0001_a", null);
    migration("0003_b", "0002_removed");
    migration("0004_c", "0002_removed");

    expect((await unrecordedMerges(dir))[0]).toMatchObject({
      parent: "0002_removed",
      migrations: ["0003_b", "0004_c"],
      // Nothing to compare them from: the parent's snapshot is gone.
      overlap: undefined,
    });
  });

  it("places a blank migration by its header: two written from the same history are a fork, and a blank written with both records them", async () => {
    migration("0001_a", null);
    expect(await blankLineIn(dir)).toEqual({ parent: "0001_a", merges: [] });
    blank("0002_seed", "0001_a");
    blank("0003_backfill", "0001_a");

    const [merge] = await unrecordedMerges(dir);
    expect(merge).toMatchObject({
      parent: "0001_a",
      migrations: ["0002_seed", "0003_backfill"],
      blank: true,
      overlap: undefined,
    });
    expect(forkedHistoryError([merge])?.publicMessage).toContain(
      "Run `nextly migrate:create --blank --name record_merge` to record that they apply in this order; if they change the same thing, delete all but one of them"
    );

    // Written now, a blank migration stands after the newest and names the other end.
    expect(await blankLineIn(dir)).toEqual({
      parent: "0003_backfill",
      merges: ["0002_seed"],
    });
    blank("0004_record_merge", "0003_backfill", ["0002_seed"]);
    expect(await unrecordedMerges(dir)).toEqual([]);
  });

  it("counts a blank migration that states no place as no part of the line, and one after a migration as accounted for by the next", async () => {
    migration("0001_a", null);
    writeFileSync(join(dir, "0002_old_blank.sql"), "-- Migration: old\n");
    blank("0003_seed", "0001_a");
    // The next generated migration is written from the newest snapshot and
    // names the blank one as the other end it was written with.
    expect(await mergedBy(dir, "0001_a")).toEqual(["0003_seed"]);
    migration("0004_b", "0001_a", undefined, ["0003_seed"]);

    expect(await unrecordedMerges(dir)).toEqual([]);
  });

  it("takes the branch of the folder's newest snapshot as the newest, whichever end sorts last", async () => {
    migration("0001_p", null);
    migration("0005_a", "0001_p");
    // Written from `0005_a` on a machine whose clock was behind.
    migration("0002_c", "0005_a");
    migration("0004_b", "0001_p");

    expect((await unrecordedMerges(dir))[0]).toMatchObject({
      members: ["0002_c", "0004_b", "0005_a"],
      newest: ["0002_c", "0005_a"],
    });
    expect(await nothingToRecordNotice(dir)).toContain(
      "The configuration is what 0005_a.sql records, so there is no merge to write. 0004_b.sql was written without it"
    );
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
    overlap: [] as string[] | undefined,
    blank: false,
  };

  it("names both files and how to record the merge, where no database says which is applied", () => {
    const refusal = forkedHistoryError([merge]);

    expect(refusal?.logContext?.reason).toBe(HISTORY_FORKED_REASON);
    expect(refusal?.publicMessage).toBe(
      "Two migrations were written from 0001_a.sql: 0002_b.sql and 0003_c.sql. " +
        "Each was written without the others' changes, so none of them was applied: " +
        "nothing yet records them together. " +
        "Run `nextly migrate:create --name record_merge` to record the merge."
    );
  });

  it("says to delete one and write it again where both change the same thing, and never to record that", () => {
    const refusal = forkedHistoryError([{ ...merge, overlap: ["dc_posts.x"] }]);

    expect(refusal?.publicMessage).toContain(
      "They both change dc_posts.x, so they cannot be applied one after the other: " +
        "delete all but one of them, with their snapshots, then run `nextly migrate:create` " +
        "again so its change is written after the other."
    );
    expect(refusal?.publicMessage).not.toContain("record_merge");

    // With one applied on the database read, the other is the one to delete.
    expect(
      forkedHistoryError(
        [{ ...merge, overlap: ["dc_posts.x"] }],
        new Set(["0003_c"])
      )?.publicMessage
    ).toContain("delete 0002_b.sql, with its snapshot, then run");
  });

  it("offers both where the branches share no parent to compare them from", () => {
    expect(
      forkedHistoryError([{ ...merge, parent: undefined, overlap: undefined }])
        ?.publicMessage
    ).toContain(
      "to record the merge; if they change the same thing, delete all but one of them, with their snapshots, instead, then run"
    );
  });

  it("names the one not applied, where the other is applied on the database read", () => {
    const refusal = forkedHistoryError([merge], new Set(["0001_a", "0003_c"]));

    expect(refusal?.publicMessage).toBe(
      "Two migrations were written from 0001_a.sql: 0002_b.sql and 0003_c.sql. " +
        "0003_c.sql is applied on this database, and 0002_b.sql was written without its " +
        "changes, so it was not applied. " +
        "Run `nextly migrate:create --name record_merge` to record the merge."
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

describe("what migrate:create refuses to record", () => {
  it("refuses branches that change the same thing, and lets through ones that do not", async () => {
    const posts = (...columns: string[]) => ({ dc_posts: ["id", ...columns] });
    migration("0001_p", null, undefined, [], posts("x"));
    migration("0002_a", "0001_p", undefined, [], posts("x", "color"));
    migration("0003_b", "0001_p", undefined, [], posts("x", "size"));
    await refuseUnrecordableMerge(dir);

    migration("0003_b", "0001_p", undefined, [], posts());
    migration("0002_a", "0001_p", undefined, [], posts("title"));
    await expect(refuseUnrecordableMerge(dir)).rejects.toMatchObject({
      publicMessage: expect.stringContaining(
        "They both change dc_posts.x"
      ) as unknown,
    });
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

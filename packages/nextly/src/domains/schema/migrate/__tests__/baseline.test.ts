/**
 * Adopting a database that already exists.
 *
 * The decisions are tested without a database on purpose: each one is a
 * judgement about two snapshots, and the refusals are the part that has to be
 * right. Baselining twice would give a history two starting points, and
 * baselining nothing would record an origin that describes no schema.
 */
import { describe, expect, it } from "vitest";

import type { SchemaEventRow } from "../../events/schema-events-repository";
import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";
import {
  appliedAppMigrations,
  historyRefusalLines,
  isUnadoptedDatabase,
  openAttempts,
  planBaseline,
  undoneAttemptRefusal,
  type LedgerRow,
} from "../baseline";
import { migrationDriftError } from "../drift-error";

const table = (name: string): NextlySchemaSnapshot["tables"][number] =>
  ({
    name,
    columns: [{ name: "id", type: "text", notNull: true, primaryKey: true }],
    indexes: [],
  }) as unknown as NextlySchemaSnapshot["tables"][number];

const snapshot = (...names: string[]): NextlySchemaSnapshot => ({
  tables: names.map(table),
});

describe("planBaseline", () => {
  it("plans the live schema as the starting point", () => {
    const live = snapshot("dc_posts", "dc_tags");

    const plan = planBaseline({ live });

    expect(plan.kind).toBe("baseline");
    if (plan.kind !== "baseline") throw new Error("expected a baseline plan");
    // The recorded snapshot IS the live one: later diffs are measured from
    // what the database has, not from what the config happens to say today.
    expect(plan.snapshot).toEqual(live);
    // And the body builds that schema from nothing, which is what lets a
    // different database be built from this history.
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations.every(op => op.type === "add_table")).toBe(true);
  });

  it("refuses when a history already has a starting point", () => {
    // Not an error the operator has to recover from, but not a no-op either:
    // writing a second baseline would leave two origins in one history, and
    // every later diff would depend on which one it read.
    const plan = planBaseline({
      live: snapshot("dc_posts"),
      latestSnapshotName: "20260101000000_init.snapshot.json",
    });

    expect(plan).toEqual({
      kind: "already-baselined",
      snapshotName: "20260101000000_init.snapshot.json",
    });
  });

  it("refuses an empty database rather than recording an empty origin", () => {
    // A project with no tables has nothing to adopt; its first migration is a
    // normal one. Recording an empty baseline would be indistinguishable from
    // having no baseline at all, while silently consuming the one chance to
    // take a real one.
    expect(planBaseline({ live: snapshot() })).toEqual({
      kind: "empty-database",
    });
  });

  it("refuses a history whose files carry no snapshot", () => {
    // `migrate:create --blank` writes hand-authored SQL with no snapshot
    // beside it, so the snapshot check alone reads such a project as never
    // baselined. Appending an origin after those files means a fresh database
    // replays them against tables the baseline has not created yet.
    expect(
      planBaseline({
        live: snapshot("dc_posts"),
        migrationFiles: ["20260101000000_custom.sql"],
      })
    ).toEqual({
      kind: "history-not-empty",
      history: [
        {
          filename: "20260101000000_custom.sql",
          inFolder: true,
          applied: false,
        },
      ],
    });
  });

  it("refuses a database the ledger says has migrated, with no files on disk", () => {
    // The damaging disagreement: a project whose migration files were deleted
    // still has its applied rows, and the disk alone reads as no history at
    // all. An origin written there leaves the database with two, and the old
    // rows become applied migrations whose files are gone.
    expect(
      planBaseline({
        live: snapshot("dc_posts"),
        appliedMigrations: ["20260101000000_init.sql"],
      })
    ).toEqual({
      kind: "history-not-empty",
      history: [
        { filename: "20260101000000_init.sql", inFolder: false, applied: true },
      ],
    });
  });

  it("carries every file and every applied migration, once each, in order", () => {
    // The refusal names each with the step that clears it, so all of them
    // are carried, not only the first: one run shows the whole history.
    const plan = planBaseline({
      live: snapshot("dc_posts"),
      migrationFiles: ["20260103_tags.sql", "20260101_init.sql"],
      appliedMigrations: ["20260102_posts.sql", "20260101_init.sql"],
    });

    expect(plan).toEqual({
      kind: "history-not-empty",
      history: [
        { filename: "20260101_init.sql", inFolder: true, applied: true },
        { filename: "20260102_posts.sql", inFolder: false, applied: true },
        { filename: "20260103_tags.sql", inFolder: true, applied: false },
      ],
    });
  });

  it("names the origin rather than the files when both are present", () => {
    // An ordinary migrated project has both. The snapshot is the more useful
    // thing to name, because it is what the operator can point at to see the
    // history really does have a starting point.
    const plan = planBaseline({
      live: snapshot("dc_posts"),
      latestSnapshotName: "20260101000000_init.snapshot.json",
      migrationFiles: ["20260101000000_init.sql"],
    });

    expect(plan.kind).toBe("already-baselined");
  });

  it("refuses a snapshot-less history even on an empty database", () => {
    // Both refusals apply; the files are the damaging one. Reporting "nothing
    // to adopt" would send the operator to `migrate:create`, appending yet
    // another file to a history that still has no origin.
    expect(
      planBaseline({
        live: snapshot(),
        migrationFiles: ["20260101000000_custom.sql"],
      }).kind
    ).toBe("history-not-empty");
  });

  it("prefers the already-baselined answer over the empty one", () => {
    // Both conditions can hold at once — a migrated project whose database has
    // been dropped. The history is the fact that matters: writing a second
    // origin is the damaging outcome, and it is the one to refuse.
    const plan = planBaseline({
      live: snapshot(),
      latestSnapshotName: "20260101000000_init.snapshot.json",
    });

    expect(plan.kind).toBe("already-baselined");
  });
});

/** Ledger rows in the order written, each a second after the one before. */
function ledger() {
  let at = 0;
  return (
    filename: string,
    eventType: SchemaEventRow["eventType"],
    status: SchemaEventRow["status"],
    supersededEventIds: string[] | null = null
  ): LedgerRow => ({
    filename,
    eventType,
    status,
    supersededEventIds,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++at)),
  });
}

describe("appliedAppMigrations", () => {
  it("counts an app migration whose latest outcome is applied", () => {
    const row = ledger();
    expect(
      appliedAppMigrations([row("1_init.sql", "file_apply", "applied")])
    ).toEqual(["1_init.sql"]);
  });

  it("does not count one whose latest outcome is rolled back, file present or not", () => {
    // A migration rolled back, whose file was then deleted, blocked the
    // baseline for good, since every row of any kind counted.
    const row = ledger();
    expect(
      appliedAppMigrations([
        row("1_init.sql", "file_apply", "applied"),
        row("1_init.sql", "file_apply", "rolled_back", ["1"]),
      ])
    ).toEqual([]);
  });

  it("does not count a plugin's rows, applied or not", () => {
    const row = ledger();
    expect(
      appliedAppMigrations([
        row(
          "plugin:@acme/nextly-plugin-auth/0001_init",
          "file_apply",
          "applied"
        ),
      ])
    ).toEqual([]);
  });

  it("does not count a migration that was only attempted", () => {
    // Pending by its latest outcome: an attempt that failed or recorded no outcome is no
    // outcome. Its unresolved attempt is refused on its own (`openAttempts`).
    const row = ledger();
    expect(
      appliedAppMigrations([
        row("1_init.sql", "file_apply", "failed"),
        row("2_posts.sql", "file_apply", "in_progress"),
      ])
    ).toEqual([]);
  });

  it("keeps counting an applied migration whatever non-outcome records follow it", () => {
    // A removal recorded, a down section's failed attempt, and an attempt
    // cleared by `migrate:resolve --failed-cleanup` are no outcomes, so the
    // migration stays applied.
    const row = ledger();
    expect(
      appliedAppMigrations([
        row("1_init.sql", "file_apply", "applied"),
        row("1_init.sql", "file_removed", "recorded"),
        row("2_posts.sql", "file_apply", "applied"),
        row("2_posts.sql", "file_rollback", "failed"),
        row("3_tags.sql", "file_apply", "applied"),
        row("3_tags.sql", "file_apply", "rolled_back", []),
      ])
    ).toEqual(["1_init.sql", "2_posts.sql", "3_tags.sql"]);
  });

  it("counts a migration applied again after a rollback once", () => {
    const row = ledger();
    expect(
      appliedAppMigrations([
        row("1_init.sql", "file_apply", "applied"),
        row("1_init.sql", "file_apply", "rolled_back", ["1"]),
        row("1_init.sql", "file_apply", "applied"),
      ])
    ).toEqual(["1_init.sql"]);
  });
});

describe("openAttempts", () => {
  it("finds an app migration's failed attempt and one that recorded no outcome", () => {
    const row = ledger();
    expect(
      openAttempts([
        row("1_init.sql", "file_apply", "failed"),
        row("2_posts.sql", "file_apply", "in_progress"),
      ])
    ).toEqual([
      { filename: "1_init.sql", direction: "up", failed: true },
      { filename: "2_posts.sql", direction: "up", failed: false },
    ]);
  });

  it("finds a down section's failed attempt", () => {
    const row = ledger();
    expect(
      openAttempts([
        row("1_init.sql", "file_apply", "applied"),
        row("1_init.sql", "file_rollback", "failed"),
      ])
    ).toEqual([{ filename: "1_init.sql", direction: "down", failed: true }]);
  });

  it("passes over an attempt an outcome or a cleanup resolved, and a plugin's", () => {
    const row = ledger();
    expect(
      openAttempts([
        row("1_init.sql", "file_apply", "failed"),
        row("1_init.sql", "file_apply", "applied"),
        row("2_posts.sql", "file_apply", "rolled_back", []),
        row("plugin:acme/0001_init", "file_apply", "failed"),
      ])
    ).toEqual([]);
  });

  it("keeps an attempt a removal record follows open", () => {
    const row = ledger();
    expect(
      openAttempts([
        row("1_init.sql", "file_apply", "failed"),
        row("1_init.sql", "file_removed", "recorded"),
      ])
    ).toEqual([{ filename: "1_init.sql", direction: "up", failed: true }]);
  });
});

describe("the refusal over an attempt a transaction undid", () => {
  const refusal = (attempts: Parameters<typeof undoneAttemptRefusal>[1]) =>
    undoneAttemptRefusal("nextly migrate:baseline", attempts);

  it("names the migration, says none of it stayed, and gives the resolve step", () => {
    const error = refusal([
      { filename: "1_init.sql", direction: "up", failed: true },
    ]);

    expect(error.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    expect(error.logContext).toMatchObject({
      reason: "partially-applied",
      source: "1_init.sql",
    });
    const message = error.publicMessage;
    expect(message).toMatch(
      /^nextly migrate:baseline stops before changing anything: 1_init\.sql has an unresolved attempt at its UP\. /
    );
    expect(message).toContain("failed inside a transaction");
    expect(message).toContain("none of it stayed");
    // Never told the database may hold part of it: here it cannot.
    expect(message).not.toContain("may hold part");
    // The CLI splits the message where this sentence ends (`unfinishedAttemptParts`).
    expect(message).toContain("so it is not run again.");
    expect(message.split("so it is not run again.")[1]).toContain(
      "`nextly migrate:resolve --failed-cleanup 1_init.sql`"
    );
  });

  it("says a down section's migration stays applied once the attempt is cleared", () => {
    const message = refusal([
      { filename: "1_init.sql", direction: "down", failed: true },
    ]).publicMessage;

    expect(message).toContain("at its down section");
    expect(message).toContain("the migration stays applied");
  });

  it("says when an attempt recorded no outcome", () => {
    expect(
      refusal([{ filename: "1_init.sql", direction: "up", failed: false }])
        .publicMessage
    ).toContain("recorded no outcome");
  });

  it("names every migration when there are several", () => {
    const message = refusal([
      { filename: "1_init.sql", direction: "up", failed: true },
      { filename: "2_posts.sql", direction: "up", failed: true },
    ]).publicMessage;

    expect(message).toContain(
      "2 migrations have an unresolved attempt (1_init.sql, 2_posts.sql)."
    );
    expect(message).toContain("--failed-cleanup 1_init.sql");
    expect(message).toContain("--failed-cleanup 2_posts.sql");
  });
});

describe("the refusal over a history with no starting point", () => {
  it("names each counted migration with the step that clears it", () => {
    const text = historyRefusalLines([
      { filename: "1_init.sql", inFolder: true, applied: false },
      { filename: "2_posts.sql", inFolder: false, applied: true },
      { filename: "3_tags.sql", inFolder: true, applied: true },
    ]).join("\n");

    expect(text).toContain("Nothing was written.");
    // A file not applied: out of the folder, and written again after.
    expect(text).toMatch(
      /1_init\.sql\s+in the migrations folder, not applied: move it out of the folder/
    );
    // A ledger row whose file is gone: recorded rolled back, said explicitly.
    expect(text).toMatch(
      /2_posts\.sql\s+recorded applied, its file gone: nextly migrate:resolve --rolled-back 2_posts\.sql --file-missing/
    );
    // Both: the file moved first, then the same record.
    expect(text).toMatch(
      /3_tags\.sql\s+in the migrations folder and recorded applied: move it out of the folder, then\s+nextly migrate:resolve --rolled-back 3_tags\.sql --file-missing/
    );
    // Never `migrate:down`, which would drop the tables a baseline adopts.
    expect(text).not.toContain("migrate:down");
    expect(text).toContain("real history");
  });
});

describe("isUnadoptedDatabase", () => {
  it("recognises tables standing before the history started", () => {
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "+", "+"],
      })
    ).toBe(true);
  });

  it("does not claim a migrated project is unadopted", () => {
    // Drift against a real baseline is ordinary drift, whichever direction it
    // runs in. Sending that operator to baseline would be sending them at a
    // command that refuses.
    expect(
      isUnadoptedDatabase({
        before: snapshot("dc_posts"),
        driftKinds: ["+"],
      })
    ).toBe(false);
  });

  it("does not claim a retried failed migration is unadopted", () => {
    // The signature is identical to a genuinely unadopted database, and only
    // the ledger separates them. MySQL commits each DDL statement as it runs,
    // so a first migration that failed partway leaves its tables behind; the
    // retry starts from an empty baseline and sees nothing but tables that
    // already exist. Sending that operator to `migrate:baseline` is sending
    // them past the failed-cleanup path they actually need.
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "+"],
        hasPriorAttempt: true,
      })
    ).toBe(false);
    // Same drift, no recorded attempt: still an adoption.
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "+"],
        hasPriorAttempt: false,
      })
    ).toBe(true);
  });

  it("does not claim a half-applied migration is unadopted", () => {
    // A failed run leaves differences in BOTH directions. Only a database that
    // is entirely ahead of an empty baseline has never been adopted.
    expect(
      isUnadoptedDatabase({
        before: snapshot(),
        driftKinds: ["+", "-"],
      })
    ).toBe(false);
  });

  it("needs at least one difference to call anything unadopted", () => {
    // No drift means this function was never reached in practice; answering
    // true on an empty list would make the guidance appear for a state that
    // does not exist.
    expect(isUnadoptedDatabase({ before: snapshot(), driftKinds: [] })).toBe(
      false
    );
  });
});

describe("the drift error an unadopted database produces", () => {
  it("names the cause and offers the one command that works", () => {
    // The three generic recoveries all fail here: `db:sync` reports no
    // changes, `migrate:resolve --applied` refuses because live does not equal
    // the target, and `migrate:create` detects nothing. Offering them costs
    // three attempts before the real answer.
    const error = migrationDriftError({
      migration: "20260805120000_add_localization",
      file: "migrations/20260805120000_add_localization.sql",
      driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
      unadoptedDatabase: true,
    });

    expect(error.publicMessage).toContain("migrate:baseline");
    expect(error.publicMessage).toContain("already has tables");
    // The menu is gone, not merely reordered.
    expect(error.publicMessage).not.toContain("[A]");
    expect(error.publicMessage).not.toContain("migrate:resolve --applied");
    // The recovery names BOTH files, and removes them BEFORE baselining.
    // This migration was written with a snapshot beside it, and
    // `migrate:baseline` refuses a project that has one — so baselining first
    // reports "already baselined" and the documented recovery cannot work.
    // Deleting only the `.sql` leaves the snapshot to do the same thing.
    expect(error.publicMessage).toContain(
      "migrations/20260805120000_add_localization.sql"
    );
    expect(error.publicMessage).toContain(
      "'migrations/meta/20260805120000_add_localization.snapshot.json'"
    );
    // The removal covers every per-dialect variant of the migration, which are
    // one migration: deleting only the selected file leaves its siblings and
    // `migrate:baseline` refuses the project as `history-not-empty`.
    expect(error.publicMessage).toContain(
      "'migrations/20260805120000_add_localization'*.sql"
    );
    // Clearing the WHOLE history is offered first: `migrate:baseline` refuses
    // a project with any migration or snapshot left, so a db:sync project that
    // generated more than one file before running `migrate` is not unblocked
    // by removing only the one that hit drift.
    expect(error.publicMessage).toContain(`mv '${"migrations"}'`);
    const clearAt = error.publicMessage.indexOf("mv ");
    // The COMMAND, not the prose: the explanation above it names
    // `migrate:baseline` too, and matching that would compare the wrong pair.
    const baselineAt = error.publicMessage.indexOf(
      "pnpm nextly migrate:baseline"
    );
    expect(clearAt).toBeGreaterThanOrEqual(0);
    expect(clearAt).toBeLessThan(baselineAt);
  });

  it("prints paths a shell can actually take", () => {
    // These commands are pasted by an operator. A migrations directory with a
    // space in it is ordinary on macOS and Windows, and unquoted it splits
    // into two arguments — so the cleanup fails before the recovery starts.
    const error = migrationDriftError({
      migration: "20260805_120000_123_add_subtitle",
      file: "/Users/a b/site/migrations/20260805_120000_123_add_subtitle.sql",
      driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
      unadoptedDatabase: true,
    });

    // The literal part is quoted; the `*` stays outside so the glob still
    // expands. Quoting the whole thing would hand `*.sql` to `rm` verbatim.
    expect(error.publicMessage).toContain(
      "'/Users/a b/site/migrations/20260805_120000_123_add_subtitle'*.sql"
    );
    expect(error.publicMessage).toContain(
      "'/Users/a b/site/migrations/meta/20260805_120000_123_add_subtitle.snapshot.json'"
    );
  });

  it("suggests the original name, not a fragment of the timestamp", () => {
    // `formatTimestamp` writes three underscore-separated groups
    // (`YYYYMMDD_HHMMSS_mmm_`). Stripping only the first leaves
    // `120000_123_add_subtitle`, which works but bakes a piece of the old
    // timestamp into the new file's name.
    const error = migrationDriftError({
      migration: "20260805_120000_123_add_subtitle",
      file: "migrations/20260805_120000_123_add_subtitle.sql",
      driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
      unadoptedDatabase: true,
    });

    expect(error.publicMessage).toContain("--name add_subtitle");
    expect(error.publicMessage).not.toContain("--name 120000_123_add_subtitle");
  });

  it("carries a status the error registry knows", () => {
    // An unregistered code falls back to 500 and skips the canonical
    // code/status tests, so the lock refusal would report a server fault for
    // what is a conflict.
    const error = migrationDriftError({
      migration: "m",
      file: "migrations/m.sql",
      driftItems: [{ kind: "+", detail: "x" }],
      unadoptedDatabase: true,
    });
    expect(error.statusCode).toBe(409);
  });

  it("keeps the generic recoveries for real drift", () => {
    const error = migrationDriftError({
      migration: "20260805120000_add_field",
      file: "migrations/20260805120000_add_field.sql",
      driftItems: [{ kind: "-", detail: "table 'dc_posts' absent from DB" }],
    });

    expect(error.publicMessage).toContain("[A]");
    expect(error.publicMessage).toContain("[C]");
    // Sending an operator whose migration half-applied to `baseline` would be
    // sending them at a command that refuses.
    expect(error.publicMessage).not.toContain("migrate:baseline");
  });
});

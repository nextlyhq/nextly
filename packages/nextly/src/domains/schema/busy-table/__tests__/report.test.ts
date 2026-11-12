/**
 * What an operator reads about a change that waited for a busy table: the holder as the database
 * names it, the line printed at each try after the first, and the error a stopped change ends
 * with, for each outcome, each kind of holder, an interrupted run and SQLite's lease. Never the
 * text of a query another session runs, even when something hands one along.
 */
import { describe, expect, it } from "vitest";

import { describeTableHolder, tableBusyError, tryNotice } from "../report";
import type { BusyTableStop, HolderReport, HolderSession } from "../types";

const SESSION: HolderSession = {
  id: "4242",
  user: "app",
  clientAddress: "10.0.0.5",
  applicationName: "worker",
  transactionOpenSeconds: 180,
};

const NAMED: HolderReport = {
  kind: "named",
  sessions: [SESSION],
  unreadable: [],
};

const SQLITE: HolderReport = {
  kind: "unnamed",
  reason: "SQLite does not say which connection holds the database",
};

/** A stop with the defaults of a run that waited out every try on PostgreSQL. */
function stopWith(overrides: Partial<BusyTableStop> = {}): BusyTableStop {
  return {
    change: "0007_add_keys.sql",
    ended: { table: "posts", holder: NAMED },
    tries: 7,
    elapsedMs: 89_600,
    appliedBefore: ["0005_add_tags.sql", "0006_add_authors.sql"],
    outcome: { kind: "nothing-changed" },
    cause: "table-busy",
    endedAtLease: false,
    ...overrides,
  };
}

describe("describeTableHolder", () => {
  it("names a session with every detail the database gave", () => {
    expect(describeTableHolder(NAMED)).toBe(
      'session 4242 (user app, from 10.0.0.5, application "worker", transaction open 3 min)'
    );
  });

  it("leaves out each detail that could not be read", () => {
    const report: HolderReport = {
      kind: "named",
      sessions: [
        {
          id: "17",
          user: null,
          clientAddress: null,
          applicationName: null,
          transactionOpenSeconds: 45,
        },
        {
          id: "18",
          user: null,
          clientAddress: null,
          applicationName: null,
          transactionOpenSeconds: null,
        },
      ],
      unreadable: [],
    };
    expect(describeTableHolder(report)).toBe(
      "session 17 (transaction open 45 s), session 18"
    );
  });

  it("names what could not be read, after the sessions", () => {
    const report: HolderReport = {
      kind: "named",
      sessions: [SESSION],
      unreadable: [
        "the client address, as the database user may not see other sessions' details",
        "metadata locks, as MySQL's metadata-lock reporting is turned off",
      ],
    };
    expect(describeTableHolder(report)).toBe(
      'session 4242 (user app, from 10.0.0.5, application "worker", transaction open 3 min); ' +
        "not read: the client address, as the database user may not see other sessions' details; " +
        "not read: metadata locks, as MySQL's metadata-lock reporting is turned off"
    );
  });

  it("says no session was named where the database named none", () => {
    const report: HolderReport = {
      kind: "named",
      sessions: [],
      unreadable: ["the sessions, as the database user may not see them"],
    };
    expect(describeTableHolder(report)).toBe(
      "a session the database did not name; not read: the sessions, as the database user may not see them"
    );
  });

  it("gives an unnamed holder's reason", () => {
    expect(describeTableHolder(SQLITE)).toBe(
      "SQLite does not say which connection holds the database"
    );
  });
});

describe("tryNotice", () => {
  it("names the change, the table, the holder and which try this is", () => {
    expect(
      tryNotice({
        change: "0007_add_keys.sql",
        table: "posts",
        holder: NAMED,
        tryNumber: 2,
        plannedTries: 7,
      })
    ).toBe(
      '0007_add_keys.sql: table "posts" is busy, held by session 4242 (user app, from 10.0.0.5, ' +
        'application "worker", transaction open 3 min); try 2 of up to 7.'
    );
  });

  it('says "a table" where the database names none, and an unnamed holder\'s reason', () => {
    expect(
      tryNotice({
        change: "0007_add_keys.sql",
        table: null,
        holder: SQLITE,
        tryNumber: 3,
        plannedTries: 7,
      })
    ).toBe(
      "0007_add_keys.sql: a table is busy, and its holder is not named: SQLite does not say " +
        "which connection holds the database; try 3 of up to 7."
    );
  });

  it("says when the try starts, where the caller knows", () => {
    expect(
      tryNotice({
        change: "0007_add_keys.sql",
        table: "posts",
        holder: NAMED,
        tryNumber: 4,
        plannedTries: 7,
        nextInMs: 3_600,
      })
    ).toMatch(/; try 4 of up to 7, starting in 4 s\.$/);
  });
});

describe("tableBusyError", () => {
  it("reports a change that left nothing behind, with how to get past the holder", () => {
    const error = tableBusyError(stopWith());
    expect(error.code).toBe("NEXTLY_TABLE_BUSY");
    expect(error.statusCode).toBe(409);
    expect(error.logContext?.reason).toBe("table busy");
    expect(error.publicMessage).toBe(
      [
        "`0007_add_keys.sql` stopped: table busy, nothing changed.",
        'It waited for table "posts" through 7 tries over 90 s, held by session 4242 (user app, ' +
          'from 10.0.0.5, application "worker", transaction open 3 min).',
        "Applied before it in this run: `0005_add_tags.sql`, `0006_add_authors.sql`.",
        "Run it again once the holder ends, end the holding session, or raise `--lock-timeout` / " +
          "`--lock-timeout-total` (or `NEXTLY_LOCK_TIMEOUT` / `NEXTLY_LOCK_TIMEOUT_TOTAL`).",
      ].join("\n")
    );
  });

  it("names the statements that committed before a part-way stop, and resolving the file", () => {
    const error = tableBusyError(
      stopWith({
        appliedBefore: [],
        tries: 1,
        elapsedMs: 5_200,
        outcome: {
          kind: "part-way",
          committed: [
            'ALTER TABLE "posts" ADD COLUMN "slug" text',
            'CREATE INDEX "posts_slug" ON "posts" ("slug")',
          ],
        },
      })
    );
    expect(error.publicMessage).toBe(
      [
        "`0007_add_keys.sql` stopped part-way: table busy.",
        "These statements had committed before the wait, and stay: " +
          '`ALTER TABLE "posts" ADD COLUMN "slug" text`; `CREATE INDEX "posts_slug" ON "posts" ("slug")`.',
        'It waited for table "posts" through 1 try over 5 s, held by session 4242 (user app, ' +
          'from 10.0.0.5, application "worker", transaction open 3 min).',
        "Nothing was applied before it in this run.",
        "Resolve `0007_add_keys.sql` with `nextly migrate:resolve` as for any part-way file: finish " +
          "its remaining statements by hand and mark it applied with `nextly migrate:resolve --applied`, " +
          "or reverse them and run `nextly migrate:resolve --failed-cleanup`.",
      ].join("\n")
    );
  });

  it.each([
    ["setval", "a `setval`, whose sequence position a rollback does not undo,"],
    [
      "concurrent-index",
      "an index built or dropped without blocking writes, which an ended try can leave invalid,",
    ],
    ["unknown-code", "a call of code the system does not know"],
    [
      "trigger",
      "a row change on a table with a trigger, which runs code the system does not know,",
    ],
    ["outside-write", "a write outside the database's own transaction"],
    ["unread", "a statement of a kind the system does not recognise"],
  ] as const)(
    "names a no-retry statement's kind (%s) and resolving the file",
    (reason, kind) => {
      const error = tableBusyError(
        stopWith({
          tries: 1,
          elapsedMs: 5_000,
          outcome: {
            kind: "no-retry",
            statement: "SELECT setval('posts_id_seq', 10)",
            reason,
            restUndone: true,
          },
        })
      );
      const lines = error.publicMessage.split("\n");
      expect(lines[0]).toBe(
        "`0007_add_keys.sql` stopped after one try: table busy."
      );
      expect(lines[1]).toBe(
        `It was not tried again, since ${kind} may not be sent again: ` +
          "`SELECT setval('posts_id_seq', 10)`. The rest of the change was undone with its transaction."
      );
      expect(lines[lines.length - 1]).toMatch(
        /^Resolve `0007_add_keys\.sql` with `nextly migrate:resolve` as for any part-way file:/
      );
    }
  );

  it("says nothing was undone where a no-retry statement ran outside a transaction", () => {
    const error = tableBusyError(
      stopWith({
        tries: 1,
        elapsedMs: 5_000,
        outcome: {
          kind: "no-retry",
          statement:
            'CREATE INDEX CONCURRENTLY "posts_slug" ON "posts" ("slug")',
          reason: "concurrent-index",
          restUndone: false,
        },
      })
    );
    expect(error.publicMessage).toContain(
      "may not be sent again: " +
        '`CREATE INDEX CONCURRENTLY "posts_slug" ON "posts" ("slug")`. ' +
        "What ran before it was not undone."
    );
    expect(error.publicMessage).not.toContain("undone with its transaction");
  });

  it("names an unnamed holder's reason and SQLite's lease ending the tries early", () => {
    const error = tableBusyError(
      stopWith({
        ended: { table: null, holder: SQLITE },
        tries: 3,
        elapsedMs: 21_400,
        endedAtLease: true,
      })
    );
    expect(error.publicMessage.split("\n").slice(1, -1)).toEqual([
      "It waited for a table through 3 tries over 21 s; its holder is not named: SQLite does " +
        "not say which connection holds the database.",
      "Applied before it in this run: `0005_add_tags.sql`, `0006_add_authors.sql`.",
      "The tries ended early: the schema lock could not be renewed while another connection " +
        "holds the whole database.",
    ]);
  });

  it("leaves the lease line out where the tries did not end at it", () => {
    expect(tableBusyError(stopWith()).publicMessage).not.toContain(
      "could not be renewed"
    );
  });

  it("says interrupted instead of table busy", () => {
    const error = tableBusyError(
      stopWith({ cause: "interrupted", tries: 3, elapsedMs: 20_000 })
    );
    expect(error.code).toBe("NEXTLY_TABLE_BUSY");
    expect(error.logContext?.reason).toBe("interrupted");
    expect(error.publicMessage.split("\n")[0]).toBe(
      "`0007_add_keys.sql` stopped: interrupted, nothing changed."
    );
    expect(error.publicMessage).not.toContain("table busy");
  });

  it("carries the whole stop in its log context", () => {
    const stop = stopWith();
    expect(tableBusyError(stop).logContext?.stop).toEqual(stop);
  });

  it("carries no query text, even when something hands one along with the holder", () => {
    const planted = "UPDATE accounts SET secret = 'hunter2' WHERE id = 1";
    // Fields the types do not have, as a careless reader of the database's views might add.
    const session = { ...SESSION, query: planted };
    const holder = {
      kind: "named" as const,
      sessions: [session],
      unreadable: [],
      lastQuery: planted,
    };
    const stop = {
      ...stopWith({ ended: { table: "posts", holder } }),
      holderQuery: planted,
    };
    const error = tableBusyError(stop);
    const json = JSON.stringify({
      code: error.code,
      publicMessage: error.publicMessage,
      publicData: error.publicData,
      logMessage: error.logMessage,
      logContext: error.logContext,
      message: error.message,
    });
    // The holder is still reported, by what the types carry: the planted text alone is gone.
    expect(error.logContext?.stop).toEqual(stopWith());
    expect(error.publicMessage).toContain("session 4242");
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("UPDATE accounts");
    expect(
      tryNotice({
        change: "0007_add_keys.sql",
        table: "posts",
        holder,
        tryNumber: 2,
        plannedTries: 7,
      })
    ).not.toContain("hunter2");
  });
});

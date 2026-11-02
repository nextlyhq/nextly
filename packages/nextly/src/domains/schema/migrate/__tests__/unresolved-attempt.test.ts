/**
 * When a command refuses on an unresolved attempt, and what the refusal says.
 *
 * The matrix runs every dialect, marked and unmarked, against every kind of
 * attempt record, so the refusal is held to its one rule: an unresolved
 * attempt (the ledger's rule) that may have stopped part-way (MySQL, or a
 * file marked to run outside a transaction). The plausible broken versions it
 * separates the rule from: refusing on any failed row (an outcome since then
 * resolved it), refusing on PostgreSQL or SQLite in a transaction (that file
 * left nothing and runs again), reading only `file_apply` rows (a stopped
 * down section is missed), and judging the UP when the down section stopped.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors";
import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../../schemas/schema-events/types";
import {
  NO_TRANSACTION_ROLLBACK_NOTE,
  PARTIAL_ROLLBACK_NOTE,
} from "../../../../cli/commands/plugin-module-rollback";
import { partiallyAppliedAdvice } from "../migration-transaction";
import type { LiveSchema } from "../statement-judgement";
import {
  refuseUnresolvedAttempts,
  type AttemptedFile,
} from "../unresolved-attempt";

const FILE = "20261030_000001_add_posts.sql";
const UP = "CREATE TABLE posts (id integer);\nCREATE TABLE tags (id integer);";
const DOWN = "DROP TABLE tags;\nDROP TABLE posts;";

/** The checksum of the file as every attempt below ran it, unless one says otherwise. */
const SUM = "a".repeat(64);

let clock = 1_000;
function row(
  eventType: SchemaEventType,
  status: SchemaEventStatus,
  filename = FILE,
  supersededEventIds: string[] | null = null,
  extra: { sha256?: string | null; note?: string | null } = {}
) {
  clock += 1_000;
  return {
    eventType,
    status,
    filename,
    startedAt: new Date(clock),
    supersededEventIds,
    sha256: SUM,
    note: null as string | null,
    ...extra,
  };
}

/**
 * The note a failed down section's row carries, as `recordRollbackFailed`
 * writes it: a prefix where it may have stopped part-way.
 */
function downFailedNote(dialect: SupportedDialect, marked: boolean) {
  if (marked) return `${NO_TRANSACTION_ROLLBACK_NOTE} migrate:down failed: x`;
  if (dialect === "mysql")
    return `${PARTIAL_ROLLBACK_NOTE} migrate:down failed: x`;
  return "migrate:down failed: x";
}

/** The database after the UP's first statement: `posts` is there, `tags` is not. */
const live: LiveSchema = {
  hasTable: table => table === "posts",
  hasColumn: () => false,
  hasIndex: () => false,
  hasConstraint: () => false,
  usable: () => true,
};

function file(marked: boolean, filename = FILE): AttemptedFile {
  return {
    filename,
    upSql: UP,
    downSql: DOWN,
    transaction: !marked,
    checksum: SUM,
  };
}

async function refusal(
  dialect: SupportedDialect,
  files: AttemptedFile[],
  rows: ReturnType<typeof row>[]
): Promise<NextlyError | undefined> {
  try {
    await refuseUnresolvedAttempts({
      files,
      rows,
      dialect,
      readLive: () => Promise.resolve(live),
      command: "nextly migrate",
    });
    return undefined;
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
}

/** Each ledger history, and the section its unresolved attempt is at, if it has one. */
const HISTORIES: Array<{
  name: string;
  rows: (downNote: string) => ReturnType<typeof row>[];
  unresolved: "up" | "down" | undefined;
}> = [
  { name: "no rows", rows: () => [], unresolved: undefined },
  {
    name: "applied",
    rows: () => [row("file_apply", "applied")],
    unresolved: undefined,
  },
  {
    name: "an UP that failed",
    rows: () => [row("file_apply", "failed")],
    unresolved: "up",
  },
  {
    name: "an UP with no outcome",
    rows: () => [row("file_apply", "in_progress")],
    unresolved: "up",
  },
  {
    name: "an UP that failed, then applied",
    rows: () => [row("file_apply", "failed"), row("file_apply", "applied")],
    unresolved: undefined,
  },
  {
    name: "an UP that failed, then cleared",
    rows: () => [
      row("file_apply", "failed"),
      row("file_apply", "rolled_back", FILE, []),
    ],
    unresolved: undefined,
  },
  {
    name: "a down section that failed",
    rows: downNote => [
      row("file_apply", "applied"),
      row("file_rollback", "failed", FILE, null, { note: downNote }),
    ],
    unresolved: "down",
  },
  {
    name: "a down section with no outcome",
    rows: () => [
      row("file_apply", "applied"),
      row("file_rollback", "in_progress"),
    ],
    unresolved: "down",
  },
  {
    name: "a down section with no outcome, then one that ended with nothing applied",
    rows: () => [
      row("file_apply", "applied"),
      row("file_rollback", "in_progress"),
      row("file_rollback", "nothing_applied"),
    ],
    unresolved: undefined,
  },
  {
    name: "a down section with no outcome, then rolled back",
    rows: () => [
      row("file_apply", "applied"),
      row("file_rollback", "in_progress"),
      row("file_apply", "rolled_back", FILE, ["the-applied-row"]),
    ],
    unresolved: undefined,
  },
];

const CASES = (["postgresql", "sqlite", "mysql"] as const).flatMap(dialect =>
  [true, false].flatMap(marked =>
    HISTORIES.map(history => ({ dialect, marked, ...history }))
  )
);

describe("refuseUnresolvedAttempts", () => {
  it.each(CASES)(
    "on $dialect, marked $marked, after $name",
    async ({ dialect, marked, name, rows, unresolved }) => {
      const error = await refusal(
        dialect,
        [file(marked)],
        rows(downFailedNote(dialect, marked))
      );
      // A down section's start is recorded only where it may stop part-way,
      // so one with no outcome is refused on every dialect.
      const partial =
        dialect === "mysql" ||
        marked ||
        name === "a down section with no outcome";
      if (unresolved === undefined || !partial) {
        expect(error).toBeUndefined();
        return;
      }
      expect(error?.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
      expect(error?.logContext?.reason).toBe("partially-applied");
      // The section that stopped is the one judged: after the UP's first
      // statement the UP reads done, not done; read as its down section
      // (DROP tags, DROP posts) the same database reads done, not done too,
      // so the labels tell the two apart.
      expect(error?.logContext?.attempts).toEqual([
        {
          filename: FILE,
          direction: unresolved,
          statements: [
            { number: 1, verdict: "done" },
            { number: 2, verdict: "not_done" },
          ],
        },
      ]);
      expect(error?.publicMessage).toContain(
        unresolved === "up"
          ? "statement 1 (CREATE TABLE posts) is done; statement 2 (CREATE TABLE tags) is not done"
          : "statement 1 (DROP TABLE tags) is done; statement 2 (DROP TABLE posts) is not done"
      );
    }
  );

  it("names every refused file, passes over plugin rows and files with nothing unresolved", async () => {
    const other = "20261030_000002_add_tags.sql";
    const plugin = "plugin:shop/0001_products";
    const error = await refusal(
      "mysql",
      [file(false), file(false, other), file(false, "20261030_000003_ok.sql")],
      [
        row("file_apply", "in_progress"),
        row("file_rollback", "failed", other),
        row("file_apply", "failed", plugin),
        row("file_apply", "applied", "20261030_000003_ok.sql"),
      ]
    );
    expect(
      (error?.logContext?.attempts as Array<{ filename: string }>).map(
        a => a.filename
      )
    ).toEqual([FILE, other]);
    expect(error?.publicMessage).toMatch(
      /^nextly migrate stops before changing anything: 2 migrations have an unresolved attempt/
    );
  });

  it.each(["postgresql", "sqlite", "mysql"] as const)(
    "refuses on %s an unresolved attempt whose file this build lacks, on every dialect, naming it",
    async dialect => {
      // A build without the file cannot tell whether the attempt ran in a
      // transaction, so even an unmarked file on PostgreSQL or SQLite is
      // refused; an attempt since resolved, and a plugin's, are not.
      const gone = "20261030_000009_gone.sql";
      const error = await refusal(
        dialect,
        [file(false)],
        [
          row("file_apply", "applied"),
          row("file_apply", "in_progress", gone),
          row("file_apply", "failed", "20261030_000010_resolved.sql"),
          row("file_apply", "applied", "20261030_000010_resolved.sql"),
          row("file_apply", "failed", "plugin:shop/0002_gone"),
        ]
      );
      expect(error?.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
      expect(error?.logContext?.attempts).toEqual([
        { filename: gone, direction: "up", missing: true, statements: [] },
      ]);
      expect(error?.publicMessage).toContain(
        `this build lacks ${gone}, so it cannot tell how that attempt ran`
      );
      expect(error?.publicMessage).toContain(
        `\`nextly migrate:resolve --failed-cleanup ${gone}\``
      );
    }
  );

  it.each([
    ["a changed checksum", "b".repeat(64)],
    ["no checksum", null],
  ] as const)(
    "refuses, from the ledger, an UP attempt whose recorded text differs from the file (%s), judging nothing",
    async (_name, sha256) => {
      // The file reads as run in a transaction today, but the attempt ran an
      // earlier text, which may have been marked to run outside one.
      const error = await refusal(
        "postgresql",
        [file(false)],
        [row("file_apply", "failed", FILE, null, { sha256 })]
      );
      expect(error?.logContext?.attempts).toEqual([
        { filename: FILE, direction: "up", changed: true, statements: [] },
      ]);
      expect(error?.publicMessage).toContain(
        `${FILE} has changed since that attempt ran`
      );
    }
  );

  it("judges a file whose recorded text matches by today's marker, as before", async () => {
    // Run in a transaction on PostgreSQL, as the file still reads: it left
    // nothing, so it runs again rather than being refused.
    expect(
      await refusal("postgresql", [file(false)], [row("file_apply", "failed")])
    ).toBeUndefined();
  });

  it("reads a failed down section's mode from its note, never from the file", async () => {
    const down = (note: string) => [
      row("file_apply", "applied"),
      row("file_rollback", "failed", FILE, null, { note }),
    ];
    // Unmarked today, but the note says the DOWN ran outside a transaction.
    expect(
      (
        await refusal(
          "postgresql",
          [file(false)],
          down(`${NO_TRANSACTION_ROLLBACK_NOTE} migrate:down failed: x`)
        )
      )?.code
    ).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    // Marked today, but the note says it ran in a transaction, undone whole.
    expect(
      await refusal("sqlite", [file(true)], down("migrate:down failed: x"))
    ).toBeUndefined();
  });

  it("judges a down section against the text recorded applied, and nothing once the file changed", async () => {
    const error = await refusal(
      "mysql",
      [file(false)],
      [
        row("file_apply", "applied", FILE, null, { sha256: "c".repeat(64) }),
        row("file_rollback", "in_progress", FILE, null, { sha256: null }),
      ]
    );
    expect(error?.logContext?.attempts).toEqual([
      { filename: FILE, direction: "down", changed: true, statements: [] },
    ]);
  });

  it("names a down section's attempt whose file this build lacks", async () => {
    const gone = "20261030_000009_gone.sql";
    const error = await refusal(
      "postgresql",
      [],
      [row("file_apply", "applied", gone), row("file_rollback", "failed", gone)]
    );
    expect(error?.logContext?.attempts).toEqual([
      { filename: gone, direction: "down", missing: true, statements: [] },
    ]);
  });

  it("still names the file and the recovery when the live schema cannot be read", async () => {
    const error = await refuseUnresolvedAttempts({
      files: [file(false)],
      rows: [row("file_apply", "in_progress")],
      dialect: "mysql",
      readLive: () => Promise.reject(new Error("connection reset")),
      command: "nextly migrate",
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error) && error.code).toBe(
      "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
    );
    expect((error as NextlyError).logContext?.attempts).toEqual([
      {
        filename: FILE,
        direction: "up",
        statements: [
          { number: 1, verdict: "unknown", reason: "unread" },
          { number: 2, verdict: "unknown", reason: "unread" },
        ],
      },
    ]);
  });

  it("reads the live database once per refused file, through the reader it is given", async () => {
    const asked: Array<readonly string[]> = [];
    await refuseUnresolvedAttempts({
      files: [file(true)],
      rows: [row("file_apply", "in_progress")],
      dialect: "postgresql",
      readLive: statements => {
        asked.push(statements);
        return Promise.resolve(live);
      },
      command: "nextly migrate:down",
    }).catch(() => undefined);
    expect(asked).toEqual([
      ["CREATE TABLE posts (id integer)", "CREATE TABLE tags (id integer)"],
    ]);
  });

  it("is worded for the CLI: what, why ending 'so it is not run again.', then the recovery for its section", async () => {
    const up = await refusal(
      "mysql",
      [file(false)],
      [row("file_apply", "failed")]
    );
    const message = up?.publicMessage ?? "";
    // The first sentence is what stopped; the CLI splits it off at its ". ".
    expect(message.slice(0, message.indexOf(". ") + 1)).toBe(
      `nextly migrate stops before changing anything: ${FILE} has an unresolved attempt at its UP.`
    );
    const end = "so it is not run again.";
    expect(message).toContain(end);
    expect(message.slice(message.indexOf(end) + end.length).trim()).toBe(
      partiallyAppliedAdvice(FILE)
    );
    // A file that knows its own recovery says it instead.
    const own = await refusal(
      "mysql",
      [{ ...file(false), advice: "Check the companion table." }],
      [row("file_apply", "failed")]
    );
    expect(own?.publicMessage).toMatch(
      /so it is not run again\. Check the companion table\.$/
    );
    const down = await refusal(
      "mysql",
      [file(false)],
      [row("file_apply", "applied"), row("file_rollback", "in_progress")]
    );
    expect(down?.publicMessage).toContain(
      `record the rollback with \`nextly migrate:resolve --rolled-back ${FILE}\``
    );
    expect(down?.publicMessage).not.toContain("--applied");
  });
});

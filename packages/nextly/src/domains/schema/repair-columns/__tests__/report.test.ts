/**
 * The report of one column: the record the text and the JSON document are both made from, and the
 * text it prints.
 *
 * Each class gets its outcome, its facts and its line; a fact that does not exist for an outcome is
 * null in the record and absent from the text; a table whose wait ran out carries its tries, time,
 * holder and next step on every column it affected.
 */
import { describe, expect, it } from "vitest";

import {
  NO_RUN_FACTS,
  type ColumnRunFacts,
  type RunMode,
  type TableLockFacts,
} from "../outcome";
import {
  formatRecord,
  formatSummary,
  formatTableLock,
  repairRecord,
  tableLocks,
  countOutcomes,
  type RepairRecord,
} from "../report";
import { reportDocument } from "../report-json";
import { formatReport } from "../run-report";
import type { ColumnFinding, ColumnLocation, DiffersFinding } from "../types";

const location: ColumnLocation = {
  kind: "collection",
  slug: "posts",
  field: "links",
  table: "dc_posts",
  column: "links",
  translation: false,
};

const textToJson: DiffersFinding = {
  kind: "differs",
  location,
  expected: { type: "jsonb", nullable: true },
  live: { type: "text", nullable: true },
  aspects: { type: true, nullability: false },
  cause: {
    kind: "legacy",
    shape: "structured-as-text",
    before: "0.0.2-alpha.67",
  },
  judgement: { class: "safe", reasons: [] },
  conversion: {
    steps: [
      [
        'ALTER TABLE "dc_posts" ALTER COLUMN "links" TYPE jsonb USING "links"::jsonb',
      ],
    ],
    rewritesTable: true,
    blocks: "reads-and-writes",
    cannotCarry: [],
    notCarried: [],
  },
  rowsRewritten: 12,
};

const record = (
  finding: ColumnFinding,
  facts: Partial<ColumnRunFacts> = {},
  mode: RunMode = "dry-run"
): RepairRecord => repairRecord(finding, { ...NO_RUN_FACTS, ...facts }, mode);

const line = (
  finding: ColumnFinding,
  facts: Partial<ColumnRunFacts> = {},
  mode: RunMode = "dry-run"
) => formatRecord(record(finding, facts, mode));

const lock: TableLockFacts = {
  table: "dc_posts",
  tries: 4,
  waitedMs: 31_500,
  holder: {
    sessions: [
      {
        id: "4242",
        user: "app",
        clientAddress: "10.0.0.7",
        application: "reports",
        transactionOpenSeconds: 75,
      },
    ],
    couldNotRead: null,
    wholeDatabase: false,
  },
  nextStep:
    "run again once the holder ends, end the holding session, or raise the bounds of the wait",
};

/** The facts no column carries until a run establishes them. */
const RUN_FACT_KEYS = ["lock", "progress", "failure"] as const;

describe("one record and one line per class", () => {
  it("a safe column would convert, with its statements, its rewrite and what it blocks", () => {
    const r = record(textToJson);
    expect(r).toMatchObject({
      outcome: "would-convert",
      entity: { kind: "collection", slug: "posts" },
      field: "links",
      table: "dc_posts",
      column: "links",
      class: "safe",
      reasons: [],
      ownerCan: null,
      rowsRewritten: 12,
      live: { type: "text", nullable: true, typeModifier: null },
      expected: { type: "jsonb", nullable: true, typeModifier: null },
      cause: {
        kind: "legacy",
        shape: "structured-as-text",
        before: "0.0.2-alpha.67",
      },
      conversion: {
        steps: textToJson.conversion?.steps,
        rewritesTable: true,
        blocks: "reads-and-writes",
      },
    });
    expect(formatRecord(r)).toBe(
      [
        'collection "posts", field "links" (dc_posts.links) [would convert]: is text NULL, expected jsonb NULL; created before 0.0.2-alpha.67. safe. Converting it rewrites the table (12 rows); reads and writes of the table wait until it ends.',
        "  Statements:",
        '    ALTER TABLE "dc_posts" ALTER COLUMN "links" TYPE jsonb USING "links"::jsonb',
      ].join("\n")
    );
  });

  it("a NOT NULL drop that rewrites nothing says so, and counts no rows", () => {
    const r = record({
      ...textToJson,
      expected: { type: "text", nullable: true },
      live: { type: "text", nullable: false },
      aspects: { type: false, nullability: true },
      cause: { kind: "current-generator" },
      conversion: {
        steps: [['ALTER TABLE "dc_posts" ALTER COLUMN "links" DROP NOT NULL']],
        rewritesTable: false,
        blocks: "reads-and-writes",
        cannotCarry: [],
        notCarried: [],
      },
      rowsRewritten: 0,
    });
    expect(r.rowsRewritten).toBe(0);
    expect(formatRecord(r)).toContain(
      "created by the current version's generator. safe. Converting it changes the column without rewriting the table; reads and writes of the table wait until it ends."
    );
  });

  it("a lossy column needs consent on a dry run and is skipped on an apply, naming its rows by key", () => {
    const lossy: DiffersFinding = {
      ...textToJson,
      judgement: {
        class: "lossy",
        reasons: [
          {
            kind: "not-json",
            class: "lossy",
            rows: { first: [{ id: "7" }, { id: "9" }], count: 2 },
          },
        ],
      },
    };
    const dry = record(lossy);
    expect(dry.outcome).toBe("needs-consent");
    expect(dry.reasons).toEqual([
      {
        kind: "not-json",
        class: "lossy",
        rows: { first: [{ id: "7" }, { id: "9" }], count: 2 },
      },
    ]);
    expect(formatRecord(dry)).toContain(
      "[needs consent]: is text NULL, expected jsonb NULL; created before 0.0.2-alpha.67. lossy: values that do not parse as JSON would be cleared (2 rows: id 7, id 9)."
    );
    expect(record(lossy, {}, "apply").outcome).toBe("skipped-needs-consent");
  });

  it("a lossy column's record says the consent that covers it, and why one given did not", () => {
    const lossy: DiffersFinding = {
      ...textToJson,
      judgement: {
        class: "lossy",
        reasons: [
          {
            kind: "not-json",
            class: "lossy",
            rows: { first: [{ id: "7" }], count: 1 },
          },
        ],
      },
    };
    const dry = record(lossy);
    expect(dry.consent).toEqual({
      given: null,
      valuesCleared: 0,
      flag: "--accept-data-loss=dc_posts.links",
      notice: null,
    });
    expect(formatRecord(dry)).toContain(
      "To convert it, clearing the named values, give --accept-data-loss=dc_posts.links."
    );

    const notice =
      "--accept-data-loss without a list does not cover a repair: name the column, --accept-data-loss=dc_posts.links";
    const skipped = record(
      lossy,
      {
        consent: {
          given: null,
          valuesCleared: 0,
          flag: "--accept-data-loss=dc_posts.links",
          notice,
        },
      },
      "apply"
    );
    expect(skipped.outcome).toBe("skipped-needs-consent");
    expect(formatRecord(skipped)).toContain(`${notice}.`);

    const cleared = record(
      lossy,
      {
        converted: true,
        consent: {
          given: "confirmed",
          valuesCleared: 1,
          flag: "--accept-data-loss=dc_posts.links",
          notice: null,
        },
      },
      "apply"
    );
    expect(cleared.outcome).toBe("converted");
    expect(formatRecord(cleared)).toContain(
      "Cleared 1 value, as confirmed at the terminal."
    );
    expect(formatRecord(cleared)).not.toContain("To convert it");
  });

  it("a column that clears nothing carries no consent", () => {
    expect(record(textToJson).consent).toBeNull();
    expect(record(textToJson, { converted: true }, "apply").consent).toBeNull();
  });

  it("a blocked column says what the owner can change, for its rows and for what it cannot keep", () => {
    const r = record({
      ...textToJson,
      expected: { type: "varchar(255)", nullable: false },
      judgement: {
        class: "blocked",
        reasons: [
          // A reason that only clears values adds nothing for the owner to change.
          {
            kind: "not-json",
            class: "lossy",
            rows: { first: [{ id: "2" }], count: 1 },
          },
          {
            kind: "too-long",
            class: "blocked",
            rows: { first: [{ id: "3" }], count: 1 },
          },
          {
            kind: "null-under-not-null",
            class: "blocked",
            rows: { first: [{ id: "4" }], count: 1 },
          },
        ],
      },
      conversion: {
        ...(textToJson.conversion as NonNullable<DiffersFinding["conversion"]>),
        cannotCarry: [
          {
            property: "view",
            name: "posts_summary",
            reason:
              "PostgreSQL refuses to change the type of a column a view reads",
            ownerCan:
              "drop the view or rule, run the repair, then create it again",
          },
        ],
      },
    });
    expect(r.outcome).toBe("blocked");
    expect(r.ownerCan).toEqual([
      "shorten the named values so each fits the new type, then run the repair again",
      "give the named rows a value, or make the field optional, then run the repair again",
      "drop the view or rule, run the repair, then create it again",
    ]);
    expect(formatRecord(r)).toContain(
      '[blocked]: is text NULL, expected varchar(255) NOT NULL; created before 0.0.2-alpha.67. blocked: values that do not parse as JSON would be cleared (1 row: id 2); values longer than the new type holds would be cut (1 row: id 3); rows hold a null where the column is to be NOT NULL (1 row: id 4); cannot keep the view "posts_summary": PostgreSQL refuses to change the type of a column a view reads. The owner can: shorten the named values so each fits the new type, then run the repair again; or give the named rows a value, or make the field optional, then run the repair again; or drop the view or rule, run the repair, then create it again.'
    );
  });

  it("names rows of a translation table by parent and locale, the first ones past the bound", () => {
    const r = record({
      ...textToJson,
      location: { ...location, table: "dc_posts_locales", translation: true },
      judgement: {
        class: "lossy",
        reasons: [
          {
            kind: "not-json",
            class: "lossy",
            rows: {
              first: [
                { parent: "p1", locale: "en" },
                { parent: "p1", locale: "fr" },
              ],
              count: 25,
            },
          },
        ],
      },
    });
    const text = formatRecord(r);
    expect(text).toContain("(dc_posts_locales.links, translation table)");
    expect(text).toContain(
      "(25 rows, first 2: parent p1 locale en, parent p1 locale fr)"
    );
  });

  it("gives a reason the pair of types gives with no rows, and null rows in the record", () => {
    const r = record({
      ...textToJson,
      expected: { type: "double", nullable: true },
      live: { type: "bigint", nullable: true },
      cause: null,
      conversion: null,
      rowsRewritten: null,
      judgement: {
        class: "blocked",
        reasons: [{ kind: "late-write", class: "blocked" }],
      },
    });
    expect(r.reasons).toEqual([
      { kind: "late-write", class: "blocked", rows: null },
    ]);
    expect(formatRecord(r)).toMatch(
      /blocked: MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error\. The owner can: convert the column by hand, in a manual migration \(nextly migrate:create --blank\)\.$/
    );
  });

  it("names a character set and a collation the new type has no place for, without blocking", () => {
    const r = record({
      ...textToJson,
      expected: { type: "json", nullable: true },
      conversion: {
        steps: [["ALTER TABLE `dc_posts` MODIFY `links` json NULL"]],
        rewritesTable: true,
        blocks: "writes",
        cannotCarry: [],
        notCarried: [
          { property: "characterSet", value: "latin1" },
          { property: "collation", value: "latin1_bin" },
        ],
      },
    });
    expect(r.outcome).toBe("would-convert");
    expect(formatRecord(r)).toContain(
      "safe. Not carried, since the new type has no place for it: character set latin1, collation latin1_bin. Converting it rewrites the table (12 rows); reads continue and writes wait until it ends."
    );
  });

  it("prints a size PostgreSQL reports beside the type", () => {
    expect(
      line({
        ...textToJson,
        expected: { type: "float8", nullable: true },
        live: { type: "numeric", nullable: true, typeModifier: "10,2" },
      })
    ).toContain("is numeric(10,2) NULL, expected float8 NULL;");
  });

  it("prints every step of a conversion that commits in several", () => {
    const text = line({
      ...textToJson,
      conversion: {
        steps: [["widen"], ["rewrite"], ["retype"]],
        rewritesTable: true,
        blocks: "writes",
        cannotCarry: [],
        notCarried: [],
      },
    });
    expect(text).toMatch(
      /Statements:\n {4}step 1: widen\n {4}step 2: rewrite\n {4}step 3: retype$/
    );
  });
});

describe("a fact an outcome does not have is null in the record and absent from the text", () => {
  const expectNull = (
    r: RepairRecord,
    keys: readonly (keyof RepairRecord)[]
  ) => {
    for (const key of keys) expect(r[key], key).toBeNull();
  };
  const UNCLASSED = [
    "class",
    "reasons",
    "cannotCarry",
    "notCarried",
    "ownerCan",
    "rowsRewritten",
    "conversion",
  ] as const;

  it("a missing table: one not-migrated record for the column, with its expected state only", () => {
    const r = record({
      kind: "not-migrated",
      location,
      missing: "table",
      expected: { type: "jsonb", nullable: true },
    });
    expect(r.outcome).toBe("not-migrated");
    expect(r.missing).toBe("table");
    expect(r.expected).toEqual({
      type: "jsonb",
      nullable: true,
      typeModifier: null,
    });
    expectNull(r, ["live", "pending", "cause", ...UNCLASSED, ...RUN_FACT_KEYS]);
    expect(formatRecord(r)).toBe(
      'collection "posts", field "links" (dc_posts.links) [not migrated]: the table does not exist (expected jsonb NULL). Run `nextly migrate`.'
    );
  });

  it("a missing column: the same facts, naming the column", () => {
    const r = record({
      kind: "not-migrated",
      location: {
        kind: "userFields",
        slug: "users",
        field: "score",
        table: "user_ext",
        column: "score",
        translation: false,
      },
      missing: "column",
      expected: { type: "float4", nullable: true },
    });
    expect(r.missing).toBe("column");
    expectNull(r, ["live", ...UNCLASSED]);
    expect(formatRecord(r)).toBe(
      'user fields, field "score" (user_ext.score) [not migrated]: the column does not exist (expected float4 NULL). Run `nextly migrate`.'
    );
  });

  it("a pending change: applied and configured, no class and no statements", () => {
    const r = record({
      kind: "pending-migration",
      location,
      applied: { type: "int4", nullable: true },
      configured: null,
      live: { type: "int4", nullable: true },
    });
    expect(r.outcome).toBe("pending-migration");
    expect(r.pending).toEqual({
      applied: { type: "int4", nullable: true, typeModifier: null },
      configured: null,
    });
    expectNull(r, ["expected", "missing", ...UNCLASSED]);
    expect(formatRecord(r)).toBe(
      'collection "posts", field "links" (dc_posts.links) [pending a migration]: int4 NULL as applied, removed as configured. Run `nextly migrate:create`, then `nextly migrate`.'
    );
  });

  it("a plugin-owned column: reported with its plugin, never classed, no statements", () => {
    const r = record({
      ...textToJson,
      plugin: "seo-kit",
      judgement: null,
      conversion: null,
      rowsRewritten: null,
    });
    expect(r.outcome).toBe("plugin-owned");
    expect(r.plugin).toBe("seo-kit");
    expectNull(r, UNCLASSED);
    const text = formatRecord(r);
    expect(text).toMatch(
      /Owned by plugin "seo-kit"; reported, never changed here\.$/
    );
    expect(text).not.toContain("Statements:");
  });

  it("an unavailable column: its table's lock, and no class, rows or statements", () => {
    const r = record(
      {
        ...textToJson,
        judgement: null,
        conversion: null,
        rowsRewritten: null,
      },
      { lock }
    );
    expect(r.outcome).toBe("unavailable-locked");
    expect(r.lock).toEqual(lock);
    expectNull(r, UNCLASSED);
    expect(formatRecord(r)).toBe(
      'collection "posts", field "links" (dc_posts.links) [unavailable, locked]: is text NULL, expected jsonb NULL; created before 0.0.2-alpha.67. Its table "dc_posts" was in use, and the wait for it ran out (see below).'
    );
  });

  it("a column whose table's definition could not be read: no live state, and says so", () => {
    const r = record(
      {
        kind: "definition-unreadable",
        location,
        expected: { type: "text", nullable: true },
      },
      {
        lock: {
          ...lock,
          holder: {
            sessions: [],
            couldNotRead: {
              details: ["which connection holds it"],
              why: "SQLite says only that the database is busy",
            },
            wholeDatabase: true,
          },
        },
      }
    );
    expect(r.outcome).toBe("unavailable-locked");
    expect(r.differenceKnown).toBe(false);
    expectNull(r, ["live", "missing", "pending", "cause", ...UNCLASSED]);
    expect(formatRecord(r)).toBe(
      'collection "posts", field "links" (dc_posts.links) [unavailable, locked]: whether it differs could not be read: the table\'s definition could not be read (expected text NULL). Its table "dc_posts" was in use, and the wait for it ran out (see below).'
    );
  });

  it("every record carries every key, whatever its outcome", () => {
    const keys = Object.keys(record(textToJson)).sort();
    for (const finding of [
      {
        kind: "not-migrated",
        location,
        missing: "table",
        expected: { type: "jsonb", nullable: true },
      },
      {
        kind: "pending-migration",
        location,
        applied: null,
        configured: null,
        live: null,
      },
      {
        kind: "definition-unreadable",
        location,
        expected: { type: "text", nullable: true },
      },
    ] satisfies ColumnFinding[]) {
      expect(Object.keys(record(finding)).sort()).toEqual(keys);
    }
  });
});

describe("a table whose wait ran out", () => {
  it("names its tries, time, holder in full and next step, once for all its columns", () => {
    const records = [
      record(
        {
          ...textToJson,
          judgement: null,
          conversion: null,
          rowsRewritten: null,
        },
        { lock }
      ),
      record(
        {
          ...textToJson,
          location: { ...location, field: "hero", column: "hero" },
          judgement: null,
          conversion: null,
          rowsRewritten: null,
        },
        { lock }
      ),
    ];
    expect(tableLocks(records)).toEqual([lock]);
    expect(formatTableLock(lock)).toBe(
      'Table "dc_posts": 4 tries over 31.5s; held by session 4242 (user app, from 10.0.0.7, application reports, transaction open 75s). Next: run again once the holder ends, end the holding session, or raise the bounds of the wait'
    );
  });

  it("names a holder in part, and what it could not read and why", () => {
    expect(
      formatTableLock({
        ...lock,
        holder: {
          sessions: [
            {
              id: "4242",
              user: null,
              clientAddress: null,
              application: null,
              transactionOpenSeconds: null,
            },
          ],
          couldNotRead: {
            details: [
              "user",
              "client address",
              "application",
              "transaction age",
            ],
            why: "this database user may not see other users' sessions",
          },
          wholeDatabase: false,
        },
      })
    ).toBe(
      'Table "dc_posts": 4 tries over 31.5s; held by session 4242. Could not read user, client address, application, transaction age: this database user may not see other users\' sessions. Next: run again once the holder ends, end the holding session, or raise the bounds of the wait'
    );
  });

  it("names no holder where the database names none, and says why", () => {
    expect(
      formatTableLock({
        ...lock,
        tries: 1,
        holder: {
          sessions: [],
          couldNotRead: {
            details: ["which connection holds it"],
            why: "SQLite says only that the database is busy",
          },
          wholeDatabase: true,
        },
      })
    ).toBe(
      'Table "dc_posts": 1 try over 31.5s; another connection holds the whole database. Could not read which connection holds it: SQLite says only that the database is busy. Next: run again once the holder ends, end the holding session, or raise the bounds of the wait'
    );
  });
});

describe("a column that differs and also has a pending change", () => {
  it("gives two records, each with its own outcome, so the repair and the migration stay apart", () => {
    const pending: ColumnFinding = {
      kind: "pending-migration",
      location,
      applied: { type: "jsonb", nullable: true },
      configured: { type: "text", nullable: true },
      live: { type: "text", nullable: true },
    };
    const records = [record(textToJson), record(pending)];
    expect(records.map(r => [r.column, r.outcome])).toEqual([
      ["links", "would-convert"],
      ["links", "pending-migration"],
    ]);
    // The repair keeps its statements; the pending change shows none.
    expect(records[0].conversion).not.toBeNull();
    expect(records[1].conversion).toBeNull();
    const counts = countOutcomes(records);
    expect(counts["would-convert"] + counts["pending-migration"]).toBe(2);
  });
});

describe("the summary", () => {
  it("counts each outcome, naming every outcome in the counts and only the present ones in the text", () => {
    const records = [
      record(textToJson),
      record(textToJson),
      record({
        kind: "not-migrated",
        location,
        missing: "column",
        expected: { type: "jsonb", nullable: true },
      }),
    ];
    const counts = countOutcomes(records);
    expect(counts["would-convert"]).toBe(2);
    expect(counts["not-migrated"]).toBe(1);
    expect(counts.converted).toBe(0);
    expect(Object.keys(counts)).toHaveLength(11);
    expect(formatSummary(counts)).toBe("1 not migrated, 2 would convert.");
  });
});

describe("the text report of a run", () => {
  it("gives each warning its message, cause and next step, as the document does", () => {
    const document = reportDocument({
      nextlyVersion: "test",
      mode: "dry-run",
      dialect: "postgresql",
      schemaLock: {
        state: "unknown",
        holder: null,
        unreadable: "the field-group lock could not be read (42501)",
      },
      records: [record(textToJson)],
      warnings: [
        {
          code: "NEXTLY_REPAIR_COLUMNS_SCHEMA_LOCK_UNREADABLE",
          message:
            "Whether another schema change is running could not be read.",
          cause: "the field-group lock could not be read (42501).",
          next: "Run it again as a database user that can read Nextly's lock tables.",
          docs: null,
        },
      ],
    });
    const warnings = formatReport(document).filter(
      line => line.level === "warn" && line.text.startsWith("Whether")
    );
    expect(warnings.map(line => line.text)).toEqual([
      "Whether another schema change is running could not be read. the field-group lock could not be read (42501). Next: Run it again as a database user that can read Nextly's lock tables.",
    ]);
  });
});

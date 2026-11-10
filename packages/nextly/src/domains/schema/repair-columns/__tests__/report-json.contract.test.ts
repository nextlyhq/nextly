/**
 * The contract of `nextly repair-columns --json`: the shape of its one document, version 1.
 *
 * The schemas below are the contract, written out key by key and strict, so a key added, removed
 * or retyped fails here before it reaches a reader. A field is never removed or given a new meaning
 * without a new version. Every key is present on every record, with null for a fact that does not
 * exist.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NO_RUN_FACTS, OUTCOME_ORDER, type ColumnRunFacts } from "../outcome";
import { repairRecord } from "../report";
import {
  couldNotRunDocument,
  REPAIR_COLUMNS_DOCUMENT_SCHEMA,
  reportDocument,
} from "../report-json";
import type { ColumnFinding, ColumnLocation, DiffersFinding } from "../types";

const state = z
  .object({
    type: z.string(),
    nullable: z.boolean(),
    typeModifier: z.string().nullable(),
  })
  .strict();

const rowKey = z.union([
  z.object({ id: z.string() }).strict(),
  z.object({ parent: z.string(), locale: z.string() }).strict(),
]);

const holderSession = z
  .object({
    id: z.string().nullable(),
    user: z.string().nullable(),
    clientAddress: z.string().nullable(),
    application: z.string().nullable(),
    transactionOpenSeconds: z.number().nullable(),
  })
  .strict();

const lock = z
  .object({
    table: z.string(),
    tries: z.number().int(),
    waitedMs: z.number(),
    holder: z
      .object({
        sessions: z.array(holderSession),
        couldNotRead: z
          .object({ details: z.array(z.string()), why: z.string() })
          .strict()
          .nullable(),
        wholeDatabase: z.boolean(),
      })
      .strict(),
    nextStep: z.string(),
  })
  .strict();

const record = z
  .object({
    outcome: z.enum(OUTCOME_ORDER),
    entity: z
      .object({
        kind: z.enum(["collection", "single", "fieldGroup", "userFields"]),
        slug: z.string(),
      })
      .strict(),
    field: z.string(),
    table: z.string(),
    column: z.string(),
    translation: z.boolean(),
    plugin: z.string().nullable(),
    missing: z.enum(["table", "column"]).nullable(),
    differenceKnown: z.boolean(),
    live: state.nullable(),
    expected: state.nullable(),
    pending: z
      .object({ applied: state.nullable(), configured: state.nullable() })
      .strict()
      .nullable(),
    cause: z
      .object({
        kind: z.enum(["legacy", "current-generator"]),
        shape: z.string().nullable(),
        before: z.string().nullable(),
      })
      .strict()
      .nullable(),
    class: z.enum(["safe", "lossy", "blocked"]).nullable(),
    reasons: z
      .array(
        z
          .object({
            kind: z.string(),
            class: z.enum(["safe", "lossy", "blocked"]),
            rows: z
              .object({ first: z.array(rowKey), count: z.number().int() })
              .strict()
              .nullable(),
          })
          .strict()
      )
      .nullable(),
    cannotCarry: z
      .array(
        z
          .object({
            property: z.string(),
            name: z.string(),
            reason: z.string(),
            ownerCan: z.string(),
          })
          .strict()
      )
      .nullable(),
    notCarried: z
      .array(
        z
          .object({
            property: z.enum(["collation", "characterSet"]),
            value: z.string(),
          })
          .strict()
      )
      .nullable(),
    ownerCan: z.array(z.string()).nullable(),
    rowsRewritten: z.number().int().nullable(),
    conversion: z
      .object({
        steps: z.array(z.array(z.string())),
        rewritesTable: z.boolean(),
        blocks: z.enum(["reads-and-writes", "writes", "brief-locks"]),
      })
      .strict()
      .nullable(),
    lock: lock.nullable(),
    progress: z
      .object({ recordedStep: z.string(), liveStep: z.string().nullable() })
      .strict()
      .nullable(),
    failure: z
      .object({ reason: z.string(), heldStep: z.string().nullable() })
      .strict()
      .nullable(),
  })
  .strict();

const problem = z
  .object({
    code: z.string(),
    message: z.string(),
    cause: z.string().nullable(),
    next: z.string().nullable(),
    docs: z.string().nullable(),
  })
  .strict();

const document = z
  .object({
    schema: z.literal("nextly.repair-columns/1"),
    command: z.literal("repair-columns"),
    nextlyVersion: z.string(),
    ok: z.boolean(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    result: z
      .object({
        mode: z.enum(["dry-run", "apply"]),
        dialect: z.enum(["postgresql", "mysql", "sqlite"]),
        schemaLock: z
          .object({
            state: z.enum(["free", "held", "unknown"]),
            holder: z.string().nullable(),
            unreadable: z.string().nullable(),
          })
          .strict(),
        records: z.array(record),
        summary: z
          .object({
            total: z.number().int(),
            outcomes: z
              .object(
                Object.fromEntries(
                  OUTCOME_ORDER.map(o => [o, z.number().int()])
                )
              )
              .strict(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    errors: z.array(problem),
    warnings: z.array(problem),
  })
  .strict();

const location = (column: string): ColumnLocation => ({
  kind: "collection",
  slug: "posts",
  field: column,
  table: "dc_posts",
  column,
  translation: false,
});

const differs = (
  column: string,
  over: Partial<DiffersFinding> = {}
): DiffersFinding => ({
  kind: "differs",
  location: location(column),
  expected: { type: "jsonb", nullable: true },
  live: { type: "text", nullable: true },
  aspects: { type: true, nullability: false },
  cause: { kind: "current-generator" },
  judgement: { class: "safe", reasons: [] },
  conversion: {
    steps: [["ALTER ..."]],
    rewritesTable: true,
    blocks: "reads-and-writes",
    cannotCarry: [],
    notCarried: [{ property: "collation", value: "C" }],
  },
  rowsRewritten: 2,
  ...over,
});

const tableLock = {
  table: "dc_posts",
  tries: 3,
  waitedMs: 1000,
  holder: {
    sessions: [
      {
        id: "1",
        user: null,
        clientAddress: null,
        application: null,
        transactionOpenSeconds: null,
      },
    ],
    couldNotRead: { details: ["user"], why: "not allowed" },
    wholeDatabase: false,
  },
  nextStep: "run again",
};

/** A finding and the run's facts for it, one per outcome of each mode. */
const lossy = {
  class: "lossy" as const,
  reasons: [
    {
      kind: "not-json" as const,
      class: "lossy" as const,
      rows: { first: [{ parent: "p", locale: "en" }], count: 1 },
    },
  ],
};
const blocked = {
  class: "blocked" as const,
  reasons: [{ kind: "late-write" as const, class: "blocked" as const }],
};
const common: Array<[ColumnFinding, Partial<ColumnRunFacts>]> = [
  [
    {
      kind: "not-migrated",
      location: location("a"),
      missing: "table",
      expected: { type: "jsonb", nullable: true },
    },
    {},
  ],
  [
    {
      kind: "pending-migration",
      location: location("b"),
      applied: { type: "int4", nullable: true },
      configured: null,
      live: { type: "int4", nullable: true },
    },
    {},
  ],
  [
    differs("c", {
      plugin: "seo",
      judgement: null,
      conversion: null,
      rowsRewritten: null,
    }),
    {},
  ],
  [
    differs("d", { judgement: null, conversion: null, rowsRewritten: null }),
    { lock: tableLock },
  ],
  [
    {
      kind: "definition-unreadable",
      location: location("e"),
      expected: { type: "text", nullable: true },
    },
    {
      lock: {
        ...tableLock,
        holder: { sessions: [], couldNotRead: null, wholeDatabase: true },
      },
    },
  ],
  [differs("f", { judgement: blocked }), {}],
  [differs("g", { judgement: lossy }), {}],
];

describe("the document's shape", () => {
  it("the dry-run document's shape", () => {
    const records = [
      ...common,
      [differs("h"), {}] as [ColumnFinding, Partial<ColumnRunFacts>],
    ].map(([finding, facts]) =>
      repairRecord(finding, { ...NO_RUN_FACTS, ...facts }, "dry-run")
    );
    const doc = reportDocument({
      nextlyVersion: "0.0.2-alpha.99",
      mode: "dry-run",
      dialect: "postgresql",
      schemaLock: {
        state: "held",
        holder: "`nextly migrate` holds it",
        unreadable: null,
      },
      records,
      warnings: [
        {
          code: "NEXTLY_REPAIR_COLUMNS_SCHEMA_CHANGE_RUNNING",
          message: "Another schema change is running",
          cause: null,
          next: null,
          docs: null,
        },
      ],
    });
    const parsed = document.parse(JSON.parse(JSON.stringify(doc)));
    expect(parsed.schema).toBe(REPAIR_COLUMNS_DOCUMENT_SCHEMA);
    expect(new Set(parsed.result?.records.map(r => r.outcome))).toEqual(
      new Set([
        "not-migrated",
        "pending-migration",
        "plugin-owned",
        "unavailable-locked",
        "blocked",
        "needs-consent",
        "would-convert",
      ])
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(2);
    expect(parsed.result?.summary.total).toBe(records.length);
  });

  it("the apply document's shape", () => {
    const applyOnly: Array<[ColumnFinding, Partial<ColumnRunFacts>]> = [
      [
        differs("i"),
        { failure: { reason: "Invalid JSON text", heldStep: null } },
      ],
      [
        differs("j"),
        { progress: { recordedStep: "widen", liveStep: "widen" } },
      ],
      [differs("k", { judgement: lossy }), {}],
      [differs("l"), { converted: true }],
    ];
    const records = [...common, ...applyOnly].map(([finding, facts]) =>
      repairRecord(finding, { ...NO_RUN_FACTS, ...facts }, "apply")
    );
    const doc = reportDocument({
      nextlyVersion: "0.0.2-alpha.99",
      mode: "apply",
      dialect: "mysql",
      schemaLock: {
        state: "unknown",
        holder: null,
        unreadable: "the field-group lock could not be read (42501)",
      },
      records,
      warnings: [],
    });
    const parsed = document.parse(JSON.parse(JSON.stringify(doc)));
    expect(new Set(parsed.result?.records.map(r => r.outcome))).toEqual(
      new Set([
        "not-migrated",
        "pending-migration",
        "plugin-owned",
        "unavailable-locked",
        "blocked",
        "failed",
        "interrupted",
        "skipped-needs-consent",
        "converted",
      ])
    );
    expect(parsed.exitCode).toBe(3);
  });

  it("a run that could not run: no result, its error, and exit 1", () => {
    const parsed = document.parse(
      JSON.parse(
        JSON.stringify(
          couldNotRunDocument({
            nextlyVersion: "0.0.2-alpha.99",
            error: {
              code: "NEXTLY_DATABASE_URL_MISSING",
              message: "No database is configured.",
              cause: "DATABASE_URL is not set.",
              next: "Set DATABASE_URL.",
              docs: "https://nextlyhq.com/docs/errors/x",
            },
          })
        )
      )
    );
    expect(parsed).toMatchObject({ ok: false, exitCode: 1, result: null });
    expect(parsed.errors).toHaveLength(1);
  });

  it("a run with nothing to report succeeds with exit 0", () => {
    const parsed = document.parse(
      reportDocument({
        nextlyVersion: "0.0.2-alpha.99",
        mode: "dry-run",
        dialect: "sqlite",
        schemaLock: { state: "free", holder: null, unreadable: null },
        records: [],
        warnings: [],
      })
    );
    expect(parsed).toMatchObject({ ok: true, exitCode: 0 });
  });
});

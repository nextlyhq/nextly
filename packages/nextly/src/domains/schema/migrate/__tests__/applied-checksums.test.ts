/**
 * Which applied app migration files no longer match the checksum recorded for
 * them, and which have none recorded.
 *
 * The plausible broken readings it separates the rule from: comparing every
 * file, pending ones included (a pending file has no recorded checksum to
 * break); reading the newest record of any kind (an attempt or a cleared
 * attempt after the applied row carries another checksum); treating a missing
 * checksum, or the text "null" an older ledger backfill wrote, as a mismatch
 * (an older row would then stop every run); and judging a plugin module by
 * the app's rule.
 */
import { describe, expect, it } from "vitest";

import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../../schemas/schema-events/types";
import { appliedChecksums, isRecordedChecksum } from "../applied-checksums";

const A = "a".repeat(64);
const B = "b".repeat(64);
const FILE = "20261102_000001_add_posts.sql";

let clock = 1_000;
function row(
  status: SchemaEventStatus,
  sha256: string | null,
  extra: {
    filename?: string;
    eventType?: SchemaEventType;
    supersededEventIds?: string[] | null;
  } = {}
) {
  clock += 1_000;
  return {
    id: `row-${clock}`,
    eventType: extra.eventType ?? ("file_apply" as SchemaEventType),
    status,
    filename: extra.filename ?? FILE,
    startedAt: new Date(clock),
    supersededEventIds: extra.supersededEventIds ?? null,
    sha256,
  };
}

const file = (checksum: string, filename = FILE) => ({ filename, checksum });

describe("isRecordedChecksum", () => {
  it.each([
    [A, true],
    ["A".repeat(64), false],
    ["a".repeat(63), false],
    ["null", false],
    ["", false],
    [null, false],
  ] as const)("%s → %s", (value, expected) => {
    expect(isRecordedChecksum(value)).toBe(expected);
  });
});

describe("appliedChecksums", () => {
  it("names an applied file whose recorded checksum differs, and only that one", () => {
    const other = "20261102_000002_add_tags.sql";
    const result = appliedChecksums(
      [file(B), file(A, other)],
      [row("applied", A), row("applied", A, { filename: other })]
    );
    expect(result).toEqual({ changed: [FILE], unrecorded: [] });
  });

  it("reads the checksum from the applied outcome, past a newer attempt or cleared attempt", () => {
    // The newest records carry other checksums; neither is the outcome.
    const result = appliedChecksums(
      [file(A)],
      [
        row("applied", A),
        row("failed", B),
        row("rolled_back", B, { supersededEventIds: [] }),
        row("failed", B, { eventType: "file_rollback" }),
      ]
    );
    expect(result).toEqual({ changed: [], unrecorded: [] });
  });

  it.each([
    ["no checksum", null],
    ["the text an older backfill wrote", "null"],
    ["a value that is no checksum", "deadbeef"],
  ])(
    "takes an applied row with %s as matching, and lists it for recording",
    (_name, sha256) => {
      const applied = row("applied", sha256);
      expect(appliedChecksums([file(A)], [applied])).toEqual({
        changed: [],
        unrecorded: [{ filename: FILE, outcomeId: applied.id, checksum: A }],
      });
    }
  );

  it("does not check a pending or rolled-back file, nor a file the ledger lacks", () => {
    const pending = "20261102_000002_pending.sql";
    const rolledBack = "20261102_000003_rolled_back.sql";
    const result = appliedChecksums(
      [file(B), file(B, pending), file(B, rolledBack)],
      [
        row("failed", A, { filename: pending }),
        row("applied", A, { filename: rolledBack }),
        row("rolled_back", null, {
          filename: rolledBack,
          supersededEventIds: ["x"],
        }),
      ]
    );
    expect(result).toEqual({ changed: [], unrecorded: [] });
  });

  it("leaves a plugin module to its own rule", () => {
    const plugin = "plugin:shop/0001_products";
    expect(
      appliedChecksums(
        [file(B, plugin)],
        [row("applied", A, { filename: plugin })]
      )
    ).toEqual({ changed: [], unrecorded: [] });
  });

  it("lists changed files in folder order", () => {
    const later = "20261102_000009_later.sql";
    expect(
      appliedChecksums(
        [file(B), file(B, later)],
        [row("applied", A, { filename: later }), row("applied", A)]
      ).changed
    ).toEqual([FILE, later]);
  });
});

/**
 * An app migration's state is read from its latest OUTCOME alone, and whether
 * it has an unresolved attempt from its latest attempt and the outcomes since.
 *
 * The plausible wrong reading these separate the rule from is "the latest
 * record of any kind": the ledger also holds records that are not outcomes —
 * an attempt started, failed or ended with nothing applied, a superseded row,
 * and the kinds later records add — and reading the newest one made an applied
 * migration pending, or hid a part-applied attempt behind a record that never
 * resolved it. The matrices run every event type against every status, so a
 * record kind added later is judged by this rule before anyone writes it.
 */
import { describe, expect, it } from "vitest";

import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../../schemas/schema-events/types";
import {
  hasUnresolvedAttempt,
  isOutcome,
  migrationStanding,
  migrationState,
  standingOf,
  unresolvedAttempts,
} from "../migration-state";
import type { SchemaEventRow } from "../schema-events-repository";

const EVENT_TYPES = [
  "file_apply",
  "dev_push",
  "ui_save",
  "db_sync",
  "core_apply",
  "file_rollback",
  "plugin_lifecycle",
] as const satisfies readonly SchemaEventType[];

const STATUSES = [
  "in_progress",
  "applied",
  "failed",
  "rolled_back",
  "superseded",
  "nothing_applied",
] as const satisfies readonly SchemaEventStatus[];

// Each list names every member of its union, or this stops compiling, so a
// kind or status added to the ledger is added to the matrices too.
const everyType: Exclude<
  SchemaEventType,
  (typeof EVENT_TYPES)[number]
> extends never
  ? true
  : false = true;
const everyStatus: Exclude<
  SchemaEventStatus,
  (typeof STATUSES)[number]
> extends never
  ? true
  : false = true;
void everyType;
void everyStatus;

const FILE = "20261029_000001_add_posts.sql";

let clock = 1_000;

function row(
  eventType: SchemaEventType,
  status: SchemaEventStatus,
  extra: Partial<SchemaEventRow> = {}
): SchemaEventRow {
  clock += 1_000;
  // A rollback retires the applied row it undoes, as `migrate:down` and
  // `migrate:resolve --rolled-back` write it; a cleared attempt retires none.
  const retires =
    eventType === "file_apply" && status === "rolled_back"
      ? { supersededEventIds: ["the-applied-row"] }
      : {};
  return {
    id: `${eventType}-${status}-${clock}`,
    eventType,
    status,
    source: "cli-migrate",
    filename: FILE,
    sha256: null,
    scopeKind: null,
    scopeSlug: null,
    startedAt: new Date(clock),
    endedAt: null,
    durationMs: null,
    note: null,
    statementsExecuted: null,
    supersededEventIds: null,
    supersededBy: null,
    ...retires,
    ...extra,
  };
}

/** An attempt `migrate:resolve --failed-cleanup` cleared: rolled back in place, retiring nothing. */
const cleared = () =>
  row("file_apply", "rolled_back", { supersededEventIds: [] });

/** Every record that is not an outcome: each type and status but the two. */
const NOT_OUTCOMES = EVENT_TYPES.flatMap(eventType =>
  STATUSES.filter(
    status =>
      !(
        eventType === "file_apply" &&
        (status === "applied" || status === "rolled_back")
      )
  ).map(status => ({ eventType, status }))
);

/** The attempts an outcome or an attempt ending with nothing applied resolves. */
const ATTEMPTS = [
  { eventType: "file_apply", status: "failed" },
  { eventType: "file_apply", status: "in_progress" },
  { eventType: "file_rollback", status: "failed" },
  { eventType: "file_rollback", status: "in_progress" },
] as const;

/**
 * The records that neither are an attempt nor resolve one: everything but an
 * outcome, an attempt, and an attempt that ended with nothing applied.
 */
const NEITHER = NOT_OUTCOMES.filter(
  ({ eventType, status }) =>
    !(
      (eventType === "file_apply" || eventType === "file_rollback") &&
      (status === "failed" ||
        status === "in_progress" ||
        status === "nothing_applied")
    )
);

describe("an attempt --failed-cleanup cleared", () => {
  it("is not an outcome", () => {
    expect(isOutcome(cleared())).toBe(false);
    expect(
      isOutcome(row("file_apply", "rolled_back", { supersededEventIds: null }))
    ).toBe(false);
  });

  it("keeps an applied migration applied", () => {
    // Read as a rollback, the next run would apply the file again on top of
    // the applied row the one-applied-row guard still sees.
    expect(migrationState([row("file_apply", "applied"), cleared()])).toBe(
      "applied"
    );
  });

  it("keeps a pending migration pending, and a rolled-back one rolled back", () => {
    expect(migrationState([row("file_apply", "failed"), cleared()])).toBe(
      "pending"
    );
    expect(
      migrationState([
        row("file_apply", "superseded"),
        row("file_apply", "rolled_back"),
        cleared(),
      ])
    ).toBe("rolled_back");
  });

  it("resolves the attempt it cleared, and every older one", () => {
    expect(
      hasUnresolvedAttempt([
        row("file_apply", "failed"),
        row("file_apply", "in_progress"),
        cleared(),
      ])
    ).toBe(false);
    expect(hasUnresolvedAttempt([cleared(), row("file_apply", "failed")])).toBe(
      true
    );
  });
});

describe("isOutcome", () => {
  it("is an applied or rolled-back file_apply row, and nothing else", () => {
    const outcomes = EVENT_TYPES.flatMap(eventType =>
      STATUSES.map(status => ({ eventType, status }))
    ).filter(kind => isOutcome(row(kind.eventType, kind.status)));
    expect(outcomes).toEqual([
      { eventType: "file_apply", status: "applied" },
      { eventType: "file_apply", status: "rolled_back" },
    ]);
  });
});

describe("migrationState: the latest outcome alone", () => {
  it("is pending with no outcome", () => {
    expect(migrationState([])).toBe("pending");
  });

  it("is applied after a run, and rolled back after migrate:down's row", () => {
    const applied = row("file_apply", "applied");
    expect(migrationState([applied])).toBe("applied");
    const rollback = row("file_apply", "rolled_back", {
      supersededEventIds: [applied.id],
    });
    expect(
      migrationState([{ ...applied, status: "superseded" }, rollback])
    ).toBe("rolled_back");
  });

  it("is applied again after a rollback and a new run", () => {
    expect(
      migrationState([
        row("file_apply", "superseded"),
        row("file_apply", "rolled_back"),
        row("file_apply", "applied"),
      ])
    ).toBe("applied");
  });

  it("is read by start time, not by the order rows arrive in", () => {
    const applied = row("file_apply", "applied");
    const rollback = row("file_apply", "rolled_back");
    expect(migrationState([rollback, applied])).toBe("rolled_back");
  });

  for (const { eventType, status } of NOT_OUTCOMES) {
    it(`keeps an applied migration applied after a ${eventType} ${status} record`, () => {
      expect(
        migrationState([row("file_apply", "applied"), row(eventType, status)])
      ).toBe("applied");
    });

    it(`keeps a rolled-back migration rolled back after a ${eventType} ${status} record`, () => {
      expect(
        migrationState([
          row("file_apply", "superseded"),
          row("file_apply", "rolled_back"),
          row(eventType, status),
        ])
      ).toBe("rolled_back");
    });

    it(`keeps a pending migration pending after a ${eventType} ${status} record`, () => {
      expect(migrationState([row(eventType, status)])).toBe("pending");
    });
  }
});

describe("hasUnresolvedAttempt", () => {
  it("is false with no attempt, and after a run that recorded its outcome", () => {
    expect(hasUnresolvedAttempt([])).toBe(false);
    expect(hasUnresolvedAttempt([row("file_apply", "applied")])).toBe(false);
  });

  for (const attempt of ATTEMPTS) {
    const label = `a ${attempt.eventType} attempt ${attempt.status}`;

    it(`is true after ${label}`, () => {
      expect(
        hasUnresolvedAttempt([
          row("file_apply", "applied"),
          row(attempt.eventType, attempt.status),
        ])
      ).toBe(true);
    });

    it(`is resolved by an applied outcome after ${label}`, () => {
      expect(
        hasUnresolvedAttempt([
          row(attempt.eventType, attempt.status),
          row("file_apply", "applied"),
        ])
      ).toBe(false);
    });

    it(`is resolved by a rolled-back outcome after ${label}`, () => {
      expect(
        hasUnresolvedAttempt([
          row(attempt.eventType, attempt.status),
          row("file_apply", "rolled_back"),
        ])
      ).toBe(false);
    });

    for (const other of NEITHER) {
      it(`is not resolved by a ${other.eventType} ${other.status} record after ${label}`, () => {
        expect(
          hasUnresolvedAttempt([
            row(attempt.eventType, attempt.status),
            row(other.eventType, other.status),
          ])
        ).toBe(true);
      });
    }
  }

  it("is true for an attempt after an older one an outcome resolved", () => {
    expect(
      hasUnresolvedAttempt([
        row("file_apply", "failed"),
        row("file_apply", "rolled_back"),
        row("file_apply", "in_progress"),
      ])
    ).toBe(true);
  });

  it("is read by start time, not by the order rows arrive in", () => {
    const failed = row("file_apply", "failed");
    const applied = row("file_apply", "applied");
    expect(hasUnresolvedAttempt([applied, failed])).toBe(false);
  });
});

describe("an attempt that ended with nothing applied", () => {
  it("is resolved, and leaves a pending migration pending", () => {
    const rows = [row("file_apply", "nothing_applied")];
    expect(hasUnresolvedAttempt(rows)).toBe(false);
    expect(migrationState(rows)).toBe("pending");
  });

  it("resolves an older failed attempt, leaving the migration pending", () => {
    const rows = [
      row("file_apply", "failed"),
      row("file_apply", "nothing_applied"),
    ];
    expect(hasUnresolvedAttempt(rows)).toBe(false);
    expect(migrationState(rows)).toBe("pending");
  });

  it("of a down section leaves an applied migration applied and resolved", () => {
    const rows = [
      row("file_apply", "applied"),
      row("file_rollback", "nothing_applied"),
    ];
    expect(hasUnresolvedAttempt(rows)).toBe(false);
    expect(migrationState(rows)).toBe("applied");
  });
});

describe("unresolvedAttempts", () => {
  it("lists every attempt since the last resolving record, newest first", () => {
    const older = row("file_apply", "failed");
    const resolved = row("file_apply", "rolled_back");
    const first = row("file_apply", "failed");
    const between = row("file_apply", "superseded");
    const second = row("file_apply", "in_progress");
    expect(
      unresolvedAttempts(FILE, [older, resolved, first, between, second]).map(
        r => r.id
      )
    ).toEqual([second.id, first.id]);
  });
});

describe("migrationStanding", () => {
  it("names the outcome it read and the newest unresolved attempt", () => {
    const applied = row("file_apply", "applied");
    const down = row("file_rollback", "in_progress");
    const standing = migrationStanding([applied, down]);
    expect(standing.state).toBe("applied");
    expect(standing.outcome?.id).toBe(applied.id);
    expect(standing.unresolvedAttempt?.id).toBe(down.id);
  });
});

describe("standingOf: a plugin module keeps its own history's rule", () => {
  const MODULE = "plugin:@acme/nextly-plugin-x/0001_init";

  it("reads a plugin module from its newest record", () => {
    // Applied, then a failed record: an app migration stays applied, a
    // plugin module reads its newest record.
    const rows = [
      row("file_apply", "applied", { filename: MODULE }),
      row("file_apply", "failed", { filename: MODULE }),
    ];
    expect(standingOf(MODULE, rows).state).toBe("pending");
    expect(standingOf(MODULE, rows).unresolvedAttempt?.status).toBe("failed");
    const app = rows.map(r => ({ ...r, filename: FILE }));
    expect(standingOf(FILE, app).state).toBe("applied");
  });

  it("lists only the unbroken run of unfinished attempts at a module's newest end", () => {
    const failed = row("file_apply", "failed", { filename: MODULE });
    const superseded = row("file_apply", "superseded", { filename: MODULE });
    expect(unresolvedAttempts(MODULE, [failed, superseded])).toEqual([]);
  });
});

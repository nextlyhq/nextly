/**
 * How the service classifies a failed INSERT.
 *
 * A lost race and a broken write both arrive as a driver throw, and telling
 * them apart is the whole job: reported as a conflict, a write fault becomes
 * "reload and try again", so the client re-reads version 0, retries, loops, and
 * no operator ever sees that the database is refusing writes.
 *
 * Exercised through a stubbed `db` rather than a real one, because the
 * interesting inputs are failures a healthy database will not produce on
 * demand -- and the discriminator under test is a second query, not any SQL the
 * first one emitted.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { Logger } from "../shared";

import { WidgetLayoutService } from "./widget-layout-service";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const adapterStub = {
  getCapabilities: () => ({ dialect: "sqlite" as const }),
} as unknown as DrizzleAdapter;

/**
 * A service whose `db` answers exactly what a test wants.
 *
 * `insertThrows` is what the write does; `rowExistsAfter` is what the follow-up
 * SELECT finds. Those two inputs are the entire decision.
 */
class StubbedService extends WidgetLayoutService {
  constructor(
    private readonly insertThrows: Error,
    private readonly rowExistsAfter: boolean
  ) {
    super(adapterStub, silentLogger);
  }

  protected override get db(): never {
    const rows = this.rowExistsAfter ? [{ id: "user:u1" }] : [];
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      limit: async () => rows,
      then: (resolve: (v: unknown) => unknown) => resolve(rows),
    };
    return {
      insert: () => ({
        values: () => {
          throw this.insertThrows;
        },
      }),
      select: () => selectChain,
    } as never;
  }
}

const placements = [
  { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
];

describe("a failed insert", () => {
  it("is a conflict when a row is there afterwards", async () => {
    const service = new StubbedService(new Error("UNIQUE constraint"), true);

    await expect(
      service.saveLayout("user", "u1", placements, 0)
    ).rejects.toSatisfy((e: unknown) => NextlyError.isConflict(e));
  });

  it("propagates unchanged when no row is there afterwards", async () => {
    // 🔴 The case a bare `catch` got wrong. A dropped connection, a missing
    // table or an over-long payload is a write FAULT, and answering it with
    // "reload and try again" sends the client into a retry loop while hiding
    // the fault from everyone who could fix it.
    const fault = new Error("connection terminated");
    const service = new StubbedService(fault, false);

    await expect(service.saveLayout("user", "u1", placements, 0)).rejects.toBe(
      fault
    );
  });

  it("does not classify a fault as a conflict merely because it threw", async () => {
    const service = new StubbedService(new Error("no such table"), false);

    await expect(
      service.saveLayout("user", "u1", placements, 0)
    ).rejects.toSatisfy((e: unknown) => !NextlyError.isConflict(e));
  });
});

/**
 * A service whose stored row is whatever a test wants to have been persisted.
 *
 * Only `getLayout` is exercised here, so the write half of the stub above is
 * not reproduced -- the SELECT is the entire input.
 */
class StoredRowService extends WidgetLayoutService {
  constructor(
    private readonly storedLayout: string,
    logger: Logger
  ) {
    super(adapterStub, logger);
  }

  protected override get db(): never {
    const rows = [{ id: "user:u1", layout: this.storedLayout, version: 3 }];
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      limit: async () => rows,
      then: (resolve: (v: unknown) => unknown) => resolve(rows),
    };
    return { select: () => selectChain } as never;
  }
}

/** A logger that keeps what it was told, so a test can read it back. */
function recordingLogger(): {
  logger: Logger;
  warnings: { message: string; meta?: Record<string, unknown> }[];
} {
  const warnings: { message: string; meta?: Record<string, unknown> }[] = [];
  return {
    warnings,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message: string, meta?: Record<string, unknown>) => {
        warnings.push({ message, ...(meta === undefined ? {} : { meta }) });
      },
      error: () => {},
    },
  };
}

const twiceKeyed = JSON.stringify({
  schemaVersion: 2,
  columnCount: 2,
  placements: [
    { id: "same", widgetId: "core/a", column: 0, order: 0, hidden: false },
    { id: "same", widgetId: "core/b", column: 1, order: 1, hidden: false },
  ],
});

describe("a stored row whose placement ids collide", () => {
  it("is served rather than reported unreadable", async () => {
    // Throwing would cost the reader every card: the row reports unreadable and
    // the dashboard falls back to the registry's own order. The repeat is
    // resolved later, per caller, by `partitionPlacements`.
    const { logger } = recordingLogger();
    const row = await new StoredRowService(twiceKeyed, logger).getLayout(
      "user",
      "u1"
    );

    expect(row.unreadable).toBe(false);
    expect(row.layout?.placements).toHaveLength(2);
  });

  it("keeps the row's own version, so a save still races correctly", async () => {
    const { logger } = recordingLogger();
    const row = await new StoredRowService(twiceKeyed, logger).getLayout(
      "user",
      "u1"
    );

    expect(row.version).toBe(3);
  });

  it("WARNS, naming the id, so the malformed row is not invisible to an operator", async () => {
    // The reader is told nothing on purpose -- their dashboard is whole. That
    // makes this log the only place the malformed row can be found, and the
    // only signal that whatever wrote it is still writing them.
    const { logger, warnings } = recordingLogger();
    await new StoredRowService(twiceKeyed, logger).getLayout("user", "u1");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.meta).toMatchObject({
      scopeKind: "user",
      scopeId: "u1",
      duplicatePlacementIds: ["same"],
    });
  });

  it("CONTROL: a sound row is served with no warning at all", async () => {
    const sound = JSON.stringify({
      schemaVersion: 2,
      columnCount: 2,
      placements: [
        { id: "a", widgetId: "core/a", column: 0, order: 0, hidden: false },
        { id: "b", widgetId: "core/b", column: 1, order: 1, hidden: false },
      ],
    });
    const { logger, warnings } = recordingLogger();
    const row = await new StoredRowService(sound, logger).getLayout(
      "user",
      "u1"
    );

    expect(row.layout?.placements.map(p => p.id)).toEqual(["a", "b"]);
    expect(row.layout?.duplicatePlacementIds).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

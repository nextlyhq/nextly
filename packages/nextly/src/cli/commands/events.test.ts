/**
 * Unit coverage for the `nextly events` glue. What a report lists and what
 * abandoning does are covered by the dispatch integration suite; here: a dry
 * run of `abandon` opens the database read-only, asks the service for a dry
 * run, names each delivery it would abandon and says nothing changed; a real
 * run connects for writing; the report opens read-only and lists each stuck
 * delivery.
 *
 * @module cli/commands/events.test
 */
import { describe, expect, it, vi } from "vitest";

import type { CommandContext } from "../program";

import { runEventsAbandonCommand, runEventsReportCommand } from "./events";

const stand = vi.hoisted(() => ({
  getCapabilities: () => ({ dialect: "sqlite" }),
  setTableResolver: () => {},
  disconnect: async () => {},
}));

vi.mock("../utils/adapter", () => ({
  validateDatabaseEnv: vi.fn(() => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "memory",
  })),
  createCliAdapter: vi.fn(async () => stand),
  // The dry run's read-only open, which answers the same stand-in.
  openCommandAdapter: vi.fn(async () => stand),
}));

const abandon = vi.hoisted(() =>
  vi.fn(async () => [
    {
      id: "d-1",
      eventId: "e-1",
      subscriber: "@acme/loyalty:award",
      status: "held",
    },
  ])
);
vi.mock("../../domains/plugin-events/abandon", () => ({
  abandonDurableDeliveries: abandon,
}));

const report = vi.hoisted(() =>
  vi.fn(async () => [
    {
      id: "d-2",
      eventId: "e-2",
      subscriber: "@acme/email:receipt",
      status: "failed",
      attemptCount: 10,
      lastError: "the address is refused",
    },
  ])
);
vi.mock("../../domains/plugin-events/report", () => ({
  reportStuckDeliveries: report,
}));

import { createCliAdapter, openCommandAdapter } from "../utils/adapter";

function fakeContext() {
  const lines: string[] = [];
  const rows: unknown[][] = [];
  const push = (m: string) => lines.push(m);
  const logger = {
    header: vi.fn(),
    info: vi.fn(push),
    warn: vi.fn(push),
    error: vi.fn(push),
    success: vi.fn(push),
    table: vi.fn((_headers: string[], body: unknown[][]) => rows.push(...body)),
    getOptions: () => ({ noColor: true }),
  };
  return { lines, rows, context: { logger } as unknown as CommandContext };
}

describe("nextly events abandon", () => {
  it("a dry run opens read-only, names what it would abandon and changes nothing", async () => {
    vi.mocked(createCliAdapter).mockClear();
    vi.mocked(openCommandAdapter).mockClear();
    abandon.mockClear();
    const { lines, context } = fakeContext();

    await runEventsAbandonCommand(
      undefined,
      { subscriber: "@acme/loyalty:award", dryRun: true },
      context
    );

    expect(openCommandAdapter).toHaveBeenCalledTimes(1);
    expect(createCliAdapter).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledWith(
      stand,
      { deliveryId: undefined, subscriber: "@acme/loyalty:award" },
      { dryRun: true }
    );
    expect(lines).toEqual([
      "Would abandon delivery d-1 to @acme/loyalty:award (held)",
      "Dry run: nothing was changed.",
    ]);
  });

  it("a real run connects for writing and says what it abandoned", async () => {
    vi.mocked(createCliAdapter).mockClear();
    abandon.mockClear();
    const { lines, context } = fakeContext();

    await runEventsAbandonCommand("d-1", {}, context);

    expect(createCliAdapter).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledWith(
      stand,
      { deliveryId: "d-1", subscriber: undefined },
      { dryRun: false }
    );
    expect(lines).toEqual(["Abandoned delivery d-1 to @acme/loyalty:award."]);
  });

  it("a real run that matches nothing says nothing was abandoned", async () => {
    abandon.mockImplementationOnce(async () => []);
    const { lines, context } = fakeContext();

    await runEventsAbandonCommand("d-missing", {}, context);

    expect(lines).toEqual([
      "No open delivery matched that is not being run right now; nothing was abandoned. `nextly events report` lists the deliveries that need an operator.",
    ]);
  });
});

describe("nextly events report", () => {
  it("opens read-only and lists each stuck delivery", async () => {
    vi.mocked(createCliAdapter).mockClear();
    vi.mocked(openCommandAdapter).mockClear();
    const { rows, context } = fakeContext();

    await runEventsReportCommand(context);

    expect(openCommandAdapter).toHaveBeenCalledTimes(1);
    expect(createCliAdapter).not.toHaveBeenCalled();
    expect(rows).toEqual([
      [
        "d-2",
        "e-2",
        "@acme/email:receipt",
        "failed",
        10,
        "the address is refused",
      ],
    ]);
  });
});

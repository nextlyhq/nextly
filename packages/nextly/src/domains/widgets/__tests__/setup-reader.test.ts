/**
 * What reading a reader's setup state costs the database: one select for every key the card
 * keeps, and one presence check for the table across requests, over the real repository and a
 * database that counts what it is asked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adapter } = vi.hoisted(() => ({ adapter: { current: {} as object } }));
vi.mock("../../../di/container", () => ({
  container: { get: () => adapter.current },
}));

import {
  DashboardPreferences,
  type DashboardPreferencesDb,
} from "../../dashboard/dashboard-preferences";
import { preferences, readSetupState } from "../setup-reader";

type SelectOptions = Parameters<DashboardPreferencesDb["select"]>[1];

/** A database holding `rows`, counting each presence check and recording each select. */
function countingDb(rows: { key: string; value: string }[]) {
  const asked = { tableExists: 0, selects: [] as SelectOptions[] };
  const db: DashboardPreferencesDb = {
    tableExists: () => {
      asked.tableExists += 1;
      return Promise.resolve(true);
    },
    select: <T>(_table: string, options?: SelectOptions) => {
      asked.selects.push(options);
      // The rows as the repository asks for them: the stand-in answers one shape.
      return Promise.resolve(rows as unknown as T[]);
    },
    upsert: <T>() => Promise.resolve(undefined as T),
    // Reading setup state opens no transaction (only a locked change does), so
    // one opened here fails the read rather than passing uncounted.
    transaction: <T>() =>
      Promise.reject<T>(new Error("a setup read opened a transaction")),
  };
  return { db, asked };
}

const ROWS = [
  { key: "setup-collapsed", value: "true" },
  { key: "setup-skipped-invite", value: "true" },
  { key: "setup-retired", value: "2026-10-30T09:00:00.000Z" },
  // A key the card does not keep, answered by a database that ignored the filter: never read.
  { key: "new-type", value: "posts" },
];

let db: DashboardPreferencesDb;
let asked: ReturnType<typeof countingDb>["asked"];

beforeEach(() => {
  ({ db, asked } = countingDb(ROWS));
  // A new adapter each case, as a reboot gives, so no case shares another's repository.
  adapter.current = db;
});

describe("reading a reader's setup state", () => {
  it("asks for every key the card keeps in one select, and reads each back", async () => {
    const state = await readSetupState("ana", new DashboardPreferences(db));
    expect(asked.selects).toHaveLength(1);
    expect(asked.tableExists).toBe(1);
    expect(asked.selects[0]?.where?.and).toContainEqual({
      column: "key",
      op: "IN",
      value: [
        "setup-collapsed",
        "setup-dismissed",
        "setup-retired",
        "setup-skipped-singles",
        "setup-skipped-invite",
      ],
    });
    expect(state).toEqual({
      collapsed: true,
      dismissed: false,
      retiredAt: "2026-10-30T09:00:00.000Z",
      skipped: new Set(["invite"]),
    });
  });

  it("checks the table is there once across requests, not once per read or per key", async () => {
    // Three reads, as one dashboard open asks: the layout, the card and the header.
    await Promise.all([
      readSetupState("ana"),
      readSetupState("ana"),
      readSetupState("ana"),
    ]);
    await readSetupState("ana");
    expect(asked.selects).toHaveLength(4);
    // The first reads may race to the check; once found, it is never asked again.
    const raced = asked.tableExists;
    expect(raced).toBeLessThanOrEqual(3);
    await readSetupState("ana");
    expect(asked.tableExists).toBe(raced);
    expect(preferences()).toBe(preferences());
  });

  it("gives a new adapter its own repository", () => {
    const first = preferences();
    adapter.current = countingDb([]).db;
    expect(preferences()).not.toBe(first);
  });
});

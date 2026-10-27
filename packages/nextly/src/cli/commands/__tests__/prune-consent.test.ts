/**
 * `nextly prune` drops orphaned tables only as the data-loss consent allows:
 * what it would drop is listed and judged first, and with no consent and no
 * terminal it drops nothing and names the consent that would cover it.
 *
 * The registry and adapter are fakes that record each drop, so what the
 * command dropped is read off them.
 */
import { describe, expect, it, vi } from "vitest";

import {
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { pruneApproval, pruneConsent, runPrune } from "../prune";

/** Two orphaned collections, one of them localized. */
function orphanedDatabase() {
  const executed: string[] = [];
  const deleted: string[] = [];
  const tables = ["dc_a", "dc_b", "dc_b_locales"];
  return {
    executed,
    deleted,
    registry: {
      findOrphanedCollections: async () => [
        { slug: "a", tableName: "dc_a" },
        { slug: "b", tableName: "dc_b" },
      ],
      deleteCollection: async (slug: string) => {
        deleted.push(slug);
      },
    },
    adapter: {
      dialect: "sqlite" as const,
      getCapabilities: () => ({ dialect: "sqlite" }),
      listTables: async () => tables,
      tableExists: async (name: string) => tables.includes(name),
      executeQuery: async (statement: string) => {
        executed.push(statement);
        return [];
      },
    },
  };
}

function approvalFor(
  consent: DataLossConsent,
  over: { interactive?: boolean; ask?: () => Promise<boolean> } = {}
) {
  const lines: string[] = [];
  const approve = pruneApproval({
    consent,
    interactive: over.interactive ?? false,
    ask: over.ask ?? (async () => false),
    print: line => lines.push(line),
    db: undefined,
    dialect: "sqlite",
  });
  return { approve, lines };
}

async function prune(
  approve: ReturnType<typeof pruneApproval>,
  db = orphanedDatabase()
) {
  const result = await runPrune({
    registry: db.registry as never,
    adapter: db.adapter as never,
    currentSlugs: [],
    approve,
  });
  return { result, db };
}

describe("nextly prune and the data-loss consent", () => {
  it("drops nothing without consent or a terminal, and names the consent", async () => {
    const { approve, lines } = approvalFor(resolveDataLossConsent({ env: {} }));
    const { result, db } = await prune(approve);
    expect(result.dropped).toEqual([]);
    expect(db.executed).toEqual([]);
    expect(db.deleted).toEqual([]);
    expect(lines.join("\n")).toContain(
      "--accept-data-loss=dc_a,dc_b,dc_b_locales"
    );
  });

  it("drops every orphan with the consent without targets, listing each first", async () => {
    const { approve, lines } = approvalFor(
      resolveDataLossConsent({ flag: true, env: {} })
    );
    const { result } = await prune(approve);
    expect(result.dropped).toEqual(["a", "b"]);
    expect(lines).toEqual([
      "Deleting 3 items, with consent:",
      "  - table dc_a",
      "  - table dc_b",
      "  - table dc_b_locales",
    ]);
  });

  it("drops nothing when the consent names one orphan of two, naming the other", async () => {
    const { approve } = approvalFor(
      resolveDataLossConsent({ flag: "dc_a", env: {} })
    );
    const db = orphanedDatabase();
    await expect(prune(approve, db)).rejects.toThrow(
      /does not cover 2 deletions:\n {2}- table dc_b\n {2}- table dc_b_locales/
    );
    expect(db.executed).toEqual([]);
    expect(db.deleted).toEqual([]);
  });

  it("asks a terminal, and drops nothing when it says no", async () => {
    const ask = vi.fn(async () => false);
    const { approve } = approvalFor(resolveDataLossConsent({ env: {} }), {
      interactive: true,
      ask,
    });
    const { result, db } = await prune(approve);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.dropped).toEqual([]);
    expect(db.executed).toEqual([]);
  });

  it("reads --accept-data-loss and NEXTLY_ACCEPT_DATA_LOSS, and honours --force as deprecated", () => {
    const warn = vi.fn();
    expect(pruneConsent({ acceptDataLoss: "dc_a" }, warn).given).toEqual({
      from: "flag",
      targets: { tables: new Set(["dc_a"]), columns: new Set() },
    });
    const saved = process.env.NEXTLY_ACCEPT_DATA_LOSS;
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "dc_b";
    try {
      expect(pruneConsent({}, warn).given?.from).toBe("env");
    } finally {
      if (saved === undefined) delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
      else process.env.NEXTLY_ACCEPT_DATA_LOSS = saved;
    }
    expect(warn).not.toHaveBeenCalled();
    expect(pruneConsent({ force: true }, warn).earlier).toEqual([
      "prune --force",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/prune's --force is deprecated/)
    );
  });
});

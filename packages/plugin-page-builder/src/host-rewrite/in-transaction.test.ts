/**
 * The in-transaction fence's decisions, over a fake transaction: which runs a
 * written row is judged against, what each phase does with it, and that a
 * row holding no component reads no table.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { componentDeletionHosts, componentDeletions } from "../schema/tables";

import { heldComponents, judgeInTransaction } from "./in-transaction";

const copyOf = (id: string, componentId: string) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const doc = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** Any column a query names; the fake reads no predicate. */
const columns = new Proxy(
  {},
  { get: (_target, key) => ({ name: String(key) }) }
);

/** A transaction holding these runs, recording every update it is asked. */
function transaction(
  runs: { id: string; componentId: string; purpose: string; phase: string }[],
  moved = 1
) {
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
  let reads = 0;
  const db = {
    table: () => columns as never,
    select: (table: unknown) => {
      reads += 1;
      const rows = async () => (table === componentDeletions ? runs : []);
      const first = async () => (await rows())[0] ?? null;
      return { all: rows, where: () => ({ all: rows, first }) };
    },
    update: (table: unknown, set: Record<string, unknown>) => ({
      where: async () => {
        updates.push({ table, set });
        return table === componentDeletions ? moved : 1;
      },
    }),
  };
  return { db: db as never, updates, reads: () => reads };
}

const SETTINGS = { maxNodes: 1000, components: "components", stamp: () => "s" };

const write = (db: never, data: unknown, collection = "notes") => ({
  collection,
  operation: "update" as const,
  id: "n1",
  data,
  db,
});

describe("judging a write inside its transaction", () => {
  it("reads no table for a row holding no component", async () => {
    const tx = transaction([]);

    await judgeInTransaction(
      write(tx.db, { title: "x", content: doc([]) }),
      SETTINGS
    );

    expect(tx.reads()).toBe(0);
  });

  it("refuses a row holding a component that is being deleted", async () => {
    const tx = transaction([
      { id: "r", componentId: "card", purpose: "delete", phase: "deleted" },
    ]);

    await expect(
      judgeInTransaction(
        write(tx.db, { content: doc([copyOf("i", "card")]) }),
        SETTINGS
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("sends a walking run back to converting, stamping it, and marks the document pending", async () => {
    const tx = transaction([
      { id: "r", componentId: "card", purpose: "delete", phase: "done" },
    ]);

    await judgeInTransaction(
      write(tx.db, { content: doc([copyOf("i", "card")]) }),
      SETTINGS
    );

    expect(tx.updates).toEqual([
      {
        table: componentDeletions,
        set: { phase: "converting", cursor: "requeued:s" },
      },
      {
        table: componentDeletionHosts,
        set: { state: "pending", reason: null },
      },
    ]);
  });

  it("refuses when the run moved on between its read and its update", async () => {
    const tx = transaction(
      [{ id: "r", componentId: "card", purpose: "delete", phase: "done" }],
      0
    );

    await expect(
      judgeInTransaction(
        write(tx.db, { content: doc([copyOf("i", "card")]) }),
        SETTINGS
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("restarts a run still judging its hosts, rather than refusing the save", async () => {
    const tx = transaction([
      { id: "c", componentId: "card", purpose: "delete", phase: "preflight" },
    ]);

    await judgeInTransaction(
      write(tx.db, { content: doc([copyOf("i", "card")]) }),
      SETTINGS
    );

    expect(tx.updates).toEqual([
      { table: componentDeletions, set: { cursor: "restart:s" } },
    ]);
  });

  it("refuses an update of the component itself while its copies convert", async () => {
    const tx = transaction([
      { id: "r", componentId: "card", purpose: "delete", phase: "converting" },
    ]);

    await expect(
      judgeInTransaction(
        { ...write(tx.db, { title: "x" }, "components"), id: "card" },
        SETTINGS
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves alone runs of other components and retired-field runs", async () => {
    const tx = transaction([
      { id: "a", componentId: "other", purpose: "delete", phase: "deleted" },
      { id: "b", componentId: "card", purpose: "strip-retired", phase: "done" },
    ]);

    await judgeInTransaction(
      write(tx.db, { content: doc([copyOf("i", "card")]) }),
      SETTINGS
    );

    expect(tx.updates).toEqual([]);
  });

  it("finds a copy in a named group and in a repeater's rows", () => {
    const held = heldComponents(
      {
        hero: { body: doc([copyOf("i", "a")]) },
        rows: [{ body: doc([copyOf("j", "b")]) }],
      },
      1000
    );

    expect([...held.ids].sort()).toEqual(["a", "b"]);
    expect(held.complete).toBe(true);
    expect(held.field).toBe("hero");
  });

  it("judges a document read only in part against every run", async () => {
    const tx = transaction([
      { id: "r", componentId: "card", purpose: "delete", phase: "deleting" },
    ]);
    // Two nodes, read under a bound of one: what lies past it is unknown.
    const content = doc([copyOf("i", "other"), copyOf("j", "other")]);

    await expect(
      judgeInTransaction(write(tx.db, { content }), {
        ...SETTINGS,
        maxNodes: 1,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/**
 * Whether a recording created its notice is told by the row that stands, and
 * never by an id the call generated but did not store.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  clearNoticeKindsForTests,
  defineNoticeKind,
  registerNoticeKind,
} from "../notice-kinds";
import { NoticesService, type NoticesWriter } from "../notices-service";

afterEach(() => clearNoticeKindsForTests());

const kind = defineNoticeKind({
  key: "test.plain",
  subjectType: "thing",
  data: z.object({ n: z.number() }),
  render: data => ({ title: `Thing ${data.n}` }),
});

function service(upsert: () => Promise<unknown>): NoticesService {
  registerNoticeKind(kind);
  return new NoticesService({
    db: {
      dialect: "sqlite",
      tableExists: async () => true,
      upsert,
      select: async () => [],
      count: async () => 0,
      delete: async () => 0,
      updateCount: async () => 0,
    } as never,
  });
}

const notice = {
  kind,
  userId: "u1",
  subjectId: "t1",
  occurrence: "1",
  data: { n: 1 },
};

describe("recording a notice", () => {
  it("does not report a notice created when the kept row vanished before its read-back", async () => {
    const result = await service(async () => null).record(notice);
    expect(result).toEqual({ created: false, id: null });
  });

  it("reports the row that stands, and created only when it is the new one", async () => {
    const kept = await service(async () => ({ id: "earlier" })).record(notice);
    expect(kept).toEqual({ created: false, id: "earlier" });
    const made = await service(async (...args: unknown[]) => ({
      id: (args[1] as { id: string }).id,
    })).record(notice);
    expect(made.created).toBe(true);
  });
});

describe("recording a notice inside the caller's transaction", () => {
  // The transaction holds a connection; a probe through the pool would wait
  // for a second one, which a one-connection pool never frees.
  function inTransaction() {
    registerNoticeKind(kind);
    const tableExists = vi.fn(async () => true);
    const svc = new NoticesService({
      db: {
        dialect: "postgresql",
        tableExists,
        upsert: async () => {
          throw new Error("the pool is not the transaction");
        },
        select: async () => [],
        count: async () => 0,
        delete: async () => 0,
        updateCount: async () => 0,
      } as never,
    });
    const upsert = vi.fn(
      async (_table: string, row: Record<string, unknown>) => ({ id: row.id })
    );
    const tx: NoticesWriter = {
      upsert: upsert as unknown as NoticesWriter["upsert"],
    };
    return { svc, tableExists, tx, upsert };
  }

  it("never asks the pool whether the table exists", async () => {
    const { svc, tableExists, tx, upsert } = inTransaction();
    await svc.ready();
    tableExists.mockClear();
    const result = await svc.record(notice, tx);
    expect(tableExists).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
  });

  it("writes nothing when the table was not found ready beforehand", async () => {
    const { svc, tableExists, tx, upsert } = inTransaction();
    const result = await svc.record(notice, tx);
    expect(tableExists).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false, id: null });
  });
});

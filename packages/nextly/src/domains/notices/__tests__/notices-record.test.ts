/**
 * Whether a recording created its notice is told by the row that stands, and
 * never by an id the call generated but did not store.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  clearNoticeKindsForTests,
  defineNoticeKind,
  registerNoticeKind,
} from "../notice-kinds";
import { NoticesService } from "../notices-service";

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

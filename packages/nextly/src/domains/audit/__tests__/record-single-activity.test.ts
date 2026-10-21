/**
 * The row one save of a Single writes to the activity trail: stated as a
 * Single's, carrying the live document id and the Single's label, and written
 * only for an actor that can name itself.
 *
 * The activity service stands in for the database; the integration tests
 * cover the row as stored and read back on each dialect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = vi.hoisted(() => ({
  service: undefined as
    | { logActivityInTx: (db: unknown, input: unknown) => Promise<void> }
    | undefined,
  throws: false,
}));

vi.mock("../../../di/container", () => ({
  container: {
    get: (name: string) => {
      if (registered.throws) throw new Error(`${name} is not registered`);
      return name === "activityLogService" ? registered.service : undefined;
    },
  },
}));

import type { ActivityWriteDb } from "../../../services/dashboard/activity-log-service";
import { recordSingleActivity } from "../record-activity";

const logged: Array<{ db: unknown; input: unknown }> = [];
// Stands in for the save's transaction: the recorder only hands it on, so
// identity is all these cases look at.
const tx = {
  insert: vi.fn(),
  select: vi.fn(),
} as unknown as ActivityWriteDb;

beforeEach(() => {
  logged.length = 0;
  registered.throws = false;
  registered.service = {
    logActivityInTx: async (db, input) => {
      logged.push({ db, input });
    },
  };
});

const save = {
  slug: "site-settings",
  entryId: "doc-1",
  label: "Site Settings",
};

describe("recording a save of a Single", () => {
  it("writes one update stating the Single, its live id and its label, in the save's transaction", async () => {
    await recordSingleActivity(() => tx, {
      ...save,
      locale: "es",
      actor: { type: "user", id: "user-7" },
    });
    expect(logged).toEqual([
      {
        db: tx,
        input: {
          actorType: "user",
          userId: "user-7",
          action: "update",
          collection: "site-settings",
          locale: "es",
          subjectKind: "single",
          entryId: "doc-1",
          entryTitle: "Site Settings",
        },
      },
    ]);
  });

  it("records a key by its kind", async () => {
    await recordSingleActivity(() => tx, {
      ...save,
      actor: { type: "apiKey", id: "key-3" },
    });
    expect(logged).toEqual([
      {
        db: tx,
        input: expect.objectContaining({
          actorType: "apiKey",
          userId: "key-3",
        }),
      },
    ]);
  });

  it("records nothing for a write that names no actor, a system actor, or the system user", async () => {
    await recordSingleActivity(() => tx, save);
    await recordSingleActivity(() => tx, { ...save, actor: null });
    await recordSingleActivity(() => tx, {
      ...save,
      actor: { type: "system" },
    });
    await recordSingleActivity(() => tx, {
      ...save,
      actor: { type: "user", id: "system" },
    });
    expect(logged).toEqual([]);
  });

  it("records nothing, and does not fail the save, when no activity service is registered", async () => {
    const actor = { type: "user" as const, id: "user-7" };
    registered.service = undefined;
    await expect(
      recordSingleActivity(() => tx, { ...save, actor })
    ).resolves.toBeUndefined();
    registered.throws = true;
    await expect(
      recordSingleActivity(() => tx, { ...save, actor })
    ).resolves.toBeUndefined();
    expect(logged).toEqual([]);
  });

  it("fails the save when the row cannot be written", async () => {
    registered.service = {
      logActivityInTx: async () => {
        throw new Error("activity_log unavailable");
      },
    };
    await expect(
      recordSingleActivity(() => tx, {
        ...save,
        actor: { type: "user", id: "user-7" },
      })
    ).rejects.toThrow("activity_log unavailable");
  });

  it("does not take the transaction's handle for a write it will not record", async () => {
    const db = vi.fn((): ActivityWriteDb => tx);
    await recordSingleActivity(db, { ...save, actor: null });
    expect(db).not.toHaveBeenCalled();
  });
});

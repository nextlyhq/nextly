/**
 * The publish mark on a row of the activity trail: one rule decides whether a
 * write published its document, from the facts each write path states, and an
 * entry's row and a Single's carry the mark, and the fields a save changed, in
 * the same shape.
 *
 * The activity service stands in for the database; the integration tests cover
 * the rows the real write paths store.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = vi.hoisted(() => ({
  service: undefined as
    | { logActivityInTx: (db: unknown, input: unknown) => Promise<void> }
    | undefined,
}));

vi.mock("../../../di/container", () => ({
  container: {
    get: (name: string) =>
      name === "activityLogService" ? registered.service : undefined,
  },
}));

import type { ActivityWriteDb } from "../../../services/dashboard/activity-log-service";
import {
  publishesDocument,
  recordMutationActivity,
  recordSingleActivity,
  type PublicationFacts,
} from "../record-activity";

const logged: Array<Record<string, unknown>> = [];
const tx = { insert: vi.fn(), select: vi.fn() } as unknown as ActivityWriteDb;
const person = { type: "user" as const, id: "user-7" };

beforeEach(() => {
  logged.length = 0;
  registered.service = {
    logActivityInTx: async (_db, input) => {
      logged.push(input as Record<string, unknown>);
    },
  };
});

describe("whether a write published its document", () => {
  it.each<[string, PublicationFacts, boolean]>([
    [
      "a first publish",
      { statusBefore: "draft", statusAfter: "published" },
      true,
    ],
    [
      "a publish of a language never stored",
      { statusBefore: null, statusAfter: "published" },
      true,
    ],
    [
      "a promotion of pending edits onto the live document",
      {
        statusBefore: "published",
        statusAfter: "published",
        promotedPendingEdits: true,
      },
      true,
    ],
    [
      "a save of a live document that promotes nothing",
      { statusBefore: "published", statusAfter: "published" },
      false,
    ],
    [
      "a save that names no status",
      { statusBefore: "published", statusAfter: undefined },
      false,
    ],
    [
      "an unpublish",
      { statusBefore: "published", statusAfter: "draft" },
      false,
    ],
    [
      "an unpublish that promotes the pending edits as it withdraws",
      {
        statusBefore: "published",
        statusAfter: "draft",
        promotedPendingEdits: true,
      },
      false,
    ],
    [
      "a restore that lands published",
      { statusBefore: "draft", statusAfter: "published", restores: true },
      false,
    ],
    [
      "a restore that promotes",
      {
        statusBefore: "published",
        statusAfter: "published",
        promotedPendingEdits: true,
        restores: true,
      },
      false,
    ],
  ])("%s: %s", (_case, facts, published) => {
    expect(publishesDocument(facts)).toBe(published);
  });
});

describe("an entry's row", () => {
  const update = {
    action: "update" as const,
    collection: "pages",
    entryId: "page-1",
    previous: { title: "Old", status: "published" },
    data: { title: "New", status: "published" },
    actor: person,
  };

  it("marks a promotion, which changes no status, beside the fields it changed", async () => {
    await recordMutationActivity(() => tx, {
      ...update,
      publication: {
        statusBefore: "published",
        statusAfter: "published",
        promotedPendingEdits: true,
      },
    });
    expect(logged[0]?.metadata).toEqual({
      changedFields: ["title"],
      published: true,
    });
  });

  it("marks a promotion whose request also carried content as a save as well", async () => {
    await recordMutationActivity(() => tx, {
      ...update,
      publication: {
        statusBefore: "published",
        statusAfter: "published",
        promotedPendingEdits: true,
        requestEdits: true,
      },
    });
    expect(logged[0]?.metadata).toEqual({
      changedFields: ["title"],
      published: true,
      publishedWithEdits: true,
    });
  });

  it("marks nothing on a save that publishes nothing", async () => {
    await recordMutationActivity(() => tx, {
      ...update,
      publication: { statusBefore: "published", statusAfter: "published" },
    });
    expect(logged[0]?.metadata).toEqual({ changedFields: ["title"] });
  });

  it("never marks a create, which never joins another row", async () => {
    await recordMutationActivity(() => tx, {
      ...update,
      action: "create",
      previous: null,
      publication: { statusBefore: null, statusAfter: "published" },
    });
    expect(logged[0]).not.toHaveProperty("metadata");
  });

  it("stores no title for an entry that has none, never its id", async () => {
    // 🔴 The id once stood in for a missing title, and every reader then drew
    // it as though it were the entry's name.
    await recordMutationActivity(() => tx, {
      ...update,
      data: { body: "No title here" },
      previous: { body: "Before" },
    });
    expect(logged[0]).not.toHaveProperty("entryTitle");
    // The control: the row was written, naming its entry by id where ids go.
    expect(logged[0]?.entryId).toBe("page-1");
  });
});

describe("a Single's row", () => {
  const save = {
    slug: "site-settings",
    entryId: "doc-1",
    label: "Site Settings",
    actor: person,
  };

  it("names the fields a save changed, compared by value as an entry's are", async () => {
    await recordSingleActivity(() => tx, {
      ...save,
      previous: { headline: "Old", footer: "Same" },
      data: { headline: "New", footer: "Same" },
    });
    expect(logged[0]?.metadata).toEqual({ changedFields: ["headline"] });
  });

  it("marks a publish of every language, in the same shape as an entry's", async () => {
    await recordSingleActivity(() => tx, {
      ...save,
      publication: {
        statusBefore: "draft",
        statusAfter: "published",
        promotedPendingEdits: true,
      },
    });
    expect(logged[0]?.metadata).toEqual({ published: true });
  });

  it("carries no metadata when it could compare nothing and published nothing", async () => {
    await recordSingleActivity(() => tx, save);
    expect(logged[0]).not.toHaveProperty("metadata");
  });
});

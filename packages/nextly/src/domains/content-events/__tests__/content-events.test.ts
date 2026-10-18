/**
 * Content event kinds are registered and render their labels; the actor is
 * taken from the request's acting identity; and the writer refuses what the
 * record cannot hold, before writing anything.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { SHARED_PART } from "../../../schemas/content-events";
import type { VersionsDbApi } from "../../versions/db-api";
import { contentEventActor } from "../actor";
import {
  contentEventKind,
  contentEventKindNames,
  registerContentEventKind,
  renderContentEvent,
  resetContentEventKinds,
} from "../kinds";
import { recordContentEvent, type ContentEventInput } from "../record";

beforeEach(() => resetContentEventKinds());

const releasePayload = z.object({ release: z.string() });

/** A transaction that keeps what it is asked to insert and update. */
function capturingTx() {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const updates: { table: string; data: unknown; where: unknown }[] = [];
  const tx = {
    insert: (table: string, row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve(row);
    },
    update: (table: string, data: unknown, where: unknown) => {
      updates.push({ table, data, where });
      return Promise.resolve(0);
    },
  } as unknown as VersionsDbApi;
  return { tx, inserts, updates };
}

const base: ContentEventInput = {
  subject: { kind: "collection", slug: "posts", id: "e1" },
  kind: "published-by-release",
  actor: { kind: "release", id: "r1", name: "Autumn launch" },
  payload: { release: "Autumn launch" },
};

describe("content event kinds", () => {
  it("registers a kind and renders its label from the payload and actor", () => {
    registerContentEventKind({
      name: "published-by-release",
      label: "Published by release {release}",
      payload: releasePayload,
    });
    registerContentEventKind({
      name: "unpublished",
      label: "Unpublished by {actor}",
    });

    expect(contentEventKindNames()).toEqual([
      "published-by-release",
      "unpublished",
    ]);
    expect(
      renderContentEvent({
        kind: "published-by-release",
        actorName: null,
        payload: { release: "Autumn launch" },
      })
    ).toBe("Published by release Autumn launch");
    expect(
      renderContentEvent({
        kind: "unpublished",
        actorName: "Ana",
        payload: null,
      })
    ).toBe("Unpublished by Ana");
    // A gap shows as written rather than reading as something else.
    expect(
      renderContentEvent({
        kind: "unpublished",
        actorName: null,
        payload: null,
      })
    ).toBe("Unpublished by {actor}");
    // A kind no longer registered reads as its name.
    expect(
      renderContentEvent({ kind: "retired", actorName: null, payload: null })
    ).toBe("retired");
  });

  it("refuses a bad name, and a name another kind holds; accepts the same kind again", () => {
    for (const name of ["Published", "published_now", "", "a".repeat(65)]) {
      expect(() => registerContentEventKind({ name, label: "x" })).toThrow();
    }
    const kind = { name: "named", label: "Named {name}" };
    registerContentEventKind(kind);
    expect(() => registerContentEventKind({ ...kind })).not.toThrow();
    expect(() =>
      registerContentEventKind({ name: "named", label: "Renamed" })
    ).toThrow(/already registered/);
  });

  it("keeps a kind as registered, whatever the caller later does to its object", () => {
    const kind = { name: "kept", label: "Kept", endsSubject: false };
    registerContentEventKind(kind);
    kind.endsSubject = true;
    kind.name = "Not A Name";
    expect(contentEventKindNames()).toEqual(["kept"]);
    const stored = contentEventKind("kept");
    expect(stored).toMatchObject({ name: "kept", endsSubject: false });
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("takes a reloaded kind's new payload schema, as a development reload builds one", async () => {
    registerContentEventKind({
      name: "named",
      label: "Named {name}",
      payload: z.object({ name: z.string() }),
    });
    // The same kind, its schema rebuilt: accepted, and the newest one is used.
    expect(() =>
      registerContentEventKind({
        name: "named",
        label: "Named {name}",
        payload: z.object({ name: z.string().max(3) }),
      })
    ).not.toThrow();
    const { tx } = capturingTx();
    await expect(
      recordContentEvent(tx, {
        ...base,
        kind: "named",
        payload: { name: "toolong" },
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("contentEventActor", () => {
  it("takes each acting identity, with the name read for it", () => {
    expect(contentEventActor({ type: "user", id: "u1" }, "Ana")).toEqual({
      kind: "person",
      id: "u1",
      name: "Ana",
    });
    expect(contentEventActor({ type: "apiKey", id: "k1" }, "CI key")).toEqual({
      kind: "apiKey",
      id: "k1",
      name: "CI key",
    });
    expect(contentEventActor({ type: "system" }, null)).toEqual({
      kind: "system",
      name: null,
    });
    // A plugin-defined person keeps its own kind, so its id is never read as
    // a staff user's.
    expect(
      contentEventActor(
        { type: "principal", principal: { kind: "customer", id: "c1" } },
        "Kim"
      )
    ).toEqual({
      kind: "principal",
      principalKind: "customer",
      id: "c1",
      name: "Kim",
    });
  });

  it("refuses an actor without the id its kind needs", () => {
    expect(() => contentEventActor({ type: "user" }, "Ana")).toThrow();
    expect(() => contentEventActor({ type: "principal" }, null)).toThrow();
  });
});

describe("recordContentEvent refuses before writing", () => {
  beforeEach(() =>
    registerContentEventKind({
      name: "published-by-release",
      label: "Published by release {release}",
      payload: releasePayload,
    })
  );

  it("an unregistered kind, a payload its kind does not take, and an oversized payload", async () => {
    const { tx, inserts } = capturingTx();
    await expect(
      recordContentEvent(tx, { ...base, kind: "nobody" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      recordContentEvent(tx, { ...base, payload: { release: 7 } })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      recordContentEvent(tx, {
        ...base,
        payload: { release: "x".repeat(5000) },
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    registerContentEventKind({ name: "plain", label: "Plain" });
    await expect(
      recordContentEvent(tx, { ...base, kind: "plain", payload: { a: 1 } })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(inserts).toEqual([]);
  });

  it("a part that is not a language", async () => {
    const { tx, inserts } = capturingTx();
    for (const locale of ["", "~shared", "x".repeat(36)]) {
      await expect(
        recordContentEvent(tx, { ...base, parts: { locales: [locale] } })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(inserts).toEqual([]);
  });

  it("a bounded field longer than its column holds on any dialect", async () => {
    const { tx, inserts } = capturingTx();
    await expect(
      recordContentEvent(tx, {
        ...base,
        actor: { kind: "person", id: "u1", name: "x".repeat(256) },
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      recordContentEvent(tx, { ...base, toState: "x".repeat(65) })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The note fits MySQL's text column at four bytes a character.
    await expect(
      recordContentEvent(tx, { ...base, note: "x".repeat(4001) })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(inserts).toEqual([]);
    await recordContentEvent(tx, { ...base, note: "x".repeat(4000) });
    expect(inserts).toHaveLength(1);
  });

  it("parts on a release's event", async () => {
    const { tx, inserts } = capturingTx();
    const release = { kind: "release", id: "r1" } as const;
    for (const parts of [{ locales: ["en"] }, { shared: true }]) {
      await expect(
        recordContentEvent(tx, { ...base, subject: release, parts })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(inserts).toEqual([]);
    // No parts is what a release's event carries.
    await recordContentEvent(tx, {
      ...base,
      subject: release,
      parts: { locales: [] },
    });
    expect(inserts).toHaveLength(1);
  });

  it("stores whether the event ends its subject, from its kind", async () => {
    registerContentEventKind({
      name: "deleted",
      label: "Deleted",
      endsSubject: true,
    });
    const { tx, inserts } = capturingTx();
    await recordContentEvent(tx, { ...base, kind: "deleted", payload: null });
    await recordContentEvent(tx, base);
    expect(
      inserts
        .filter(i => i.table === "nextly_content_events")
        .map(i => i.row.endsSubject)
    ).toEqual([true, false]);
  });

  it("stamps the life a deletion ends with the deletion, and names itself", async () => {
    registerContentEventKind({
      name: "deleted",
      label: "Deleted",
      endsSubject: true,
    });
    const { tx, inserts, updates } = capturingTx();
    const { id } = await recordContentEvent(tx, {
      ...base,
      kind: "deleted",
      payload: null,
    });
    // The subject's events not yet ended, and only those, take its id.
    expect(updates).toEqual([
      {
        table: "nextly_content_events",
        data: { endedBy: id },
        where: {
          and: [
            { column: "subjectKind", op: "=", value: "collection" },
            { column: "subjectSlug", op: "=", value: "posts" },
            { column: "subjectId", op: "=", value: "e1" },
            { column: "endedBy", op: "IS NULL" },
          ],
        },
      },
    ]);
    expect(inserts[0]?.row.endedBy).toBe(id);
    // An ordinary event stamps nothing and is part of no ended life.
    await recordContentEvent(tx, base);
    expect(updates).toHaveLength(1);
    expect(inserts[1]?.row.endedBy).toBeNull();
  });

  it("writes each part once, and the shared marker", async () => {
    const { tx, inserts } = capturingTx();
    const { id } = await recordContentEvent(tx, {
      ...base,
      parts: { locales: ["en", "es", "en"], shared: true },
    });
    expect(inserts.map(i => i.table)).toEqual([
      "nextly_content_events",
      "nextly_content_event_parts",
      "nextly_content_event_parts",
      "nextly_content_event_parts",
    ]);
    expect(inserts.slice(1).map(i => i.row)).toEqual([
      { eventId: id, part: "en" },
      { eventId: id, part: "es" },
      { eventId: id, part: SHARED_PART },
    ]);
  });
});

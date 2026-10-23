/**
 * Which rows of the trail the feed shows as one: one person's updates of one
 * document, each within ten minutes of the next, with nothing they can see
 * between. And what a row says it changed, which is how a publish is told from
 * a save.
 */
import { describe, expect, it } from "vitest";

import {
  changedFieldsOf,
  changesStatus,
  isContentSave,
  isStatusOnlyChange,
  publishes,
} from "../activity-changes";
import { RUN_GAP_MS, runsOf } from "../activity-runs";

const T0 = Date.parse("2026-10-22T12:00:00Z");

let ids = 0;
/** A trail row, newest-first callers pass them in that order. */
function row(overrides: Record<string, unknown> = {}) {
  ids += 1;
  return {
    id: `r${ids}`,
    actorType: "user",
    userId: "ana",
    action: "update",
    collection: "posts",
    entryId: "p1",
    subjectKind: "collection",
    metadata: JSON.stringify({ changedFields: ["title", "updatedAt"] }),
    createdAt: new Date(T0),
    ...overrides,
  };
}

/** `minutes` before T0. */
const before = (minutes: number) => new Date(T0 - minutes * 60_000);

const counts = (rows: Record<string, unknown>[]) =>
  runsOf(rows).map(run => run.count);

describe("a run of saves", () => {
  it("joins saves 9:59 apart and splits them 10:01 apart", () => {
    // Written out in minutes and seconds, not derived from the constant: the
    // ten minutes are the rule, and a test computed from the code's own value
    // would agree with any value it held.
    const apart = (minutes: number, seconds: number) =>
      new Date(T0 - (minutes * 60 + seconds) * 1_000);
    expect(
      counts([row({ createdAt: before(0) }), row({ createdAt: apart(9, 59) })])
    ).toEqual([2]);
    expect(
      counts([row({ createdAt: before(0) }), row({ createdAt: apart(10, 1) })])
    ).toEqual([1, 1]);
    expect(RUN_GAP_MS).toBe(10 * 60 * 1_000);
  });

  it("is a chain: each save within ten minutes of the next, however long the whole", () => {
    expect(
      counts([0, 9, 18, 27].map(minutes => row({ createdAt: before(minutes) })))
    ).toEqual([4]);
  });

  it("is broken by another person's save, or a save of another document, between", () => {
    expect(
      counts([
        row({ createdAt: before(0) }),
        row({ createdAt: before(1), userId: "ben" }),
        row({ createdAt: before(2) }),
      ])
    ).toEqual([1, 1, 1]);
    expect(
      counts([
        row({ createdAt: before(0) }),
        row({ createdAt: before(1), entryId: "p2" }),
        row({ createdAt: before(2) }),
      ])
    ).toEqual([1, 1, 1]);
  });

  it("holds one person's saves together across languages", () => {
    // A row shows no language, so saving the French and the English versions of
    // one page is one person working on one document.
    expect(
      counts([
        row({ createdAt: before(0), locale: "fr" }),
        row({ createdAt: before(1), locale: null }),
      ])
    ).toEqual([2]);
  });

  it("never takes in a create, a delete, a settings change or a row that names no document", () => {
    expect(
      counts([
        row({ createdAt: before(0) }),
        row({ createdAt: before(1), action: "create" }),
      ])
    ).toEqual([1, 1]);
    expect(
      counts([
        row({ createdAt: before(0), action: "delete" }),
        row({ createdAt: before(1), action: "delete" }),
      ])
    ).toEqual([1, 1]);
    expect(
      counts([
        row({ createdAt: before(0), entryId: null }),
        row({ createdAt: before(1), entryId: null }),
      ])
    ).toEqual([1, 1]);
    // A settings change, stated or filed under a settings namespace before the
    // kind was recorded, even one that carries an id.
    expect(
      counts([
        row({ createdAt: before(0), subjectKind: "settings", entryId: "smtp" }),
        row({ createdAt: before(1), subjectKind: "settings", entryId: "smtp" }),
      ])
    ).toEqual([1, 1]);
    expect(
      counts([
        row({
          createdAt: before(0),
          subjectKind: null,
          collection: "email-providers",
          entryId: "smtp",
        }),
        row({
          createdAt: before(1),
          subjectKind: null,
          collection: "email-providers",
          entryId: "smtp",
        }),
      ])
    ).toEqual([1, 1]);
  });

  it("keeps a publish as its own row, even one made with an edit, and it breaks the run", () => {
    const publish = (fields: string[], minutes: number) =>
      row({
        createdAt: before(minutes),
        metadata: JSON.stringify({ changedFields: fields }),
      });
    expect(
      counts([
        row({ createdAt: before(0) }),
        row({ createdAt: before(1) }),
        publish(["status", "updatedAt"], 2),
        row({ createdAt: before(3) }),
        publish(["status", "title", "updatedAt"], 4),
        row({ createdAt: before(5) }),
      ])
    ).toEqual([2, 1, 1, 1, 1]);
  });

  it("keeps a promotion of pending edits as its own row, and a Single's publish, though neither changes the status", () => {
    // 🔴 A promotion leaves the status published, so its changed fields hold
    // the edits it put live and no `status`: only its mark says it published.
    const promotion = row({
      createdAt: before(1),
      metadata: JSON.stringify({
        changedFields: ["title", "updatedAt"],
        published: true,
      }),
    });
    expect(
      counts([
        row({ createdAt: before(0) }),
        promotion,
        row({ createdAt: before(2) }),
      ])
    ).toEqual([1, 1, 1]);
    const single = (minutes: number, metadata: unknown) =>
      row({
        createdAt: before(minutes),
        subjectKind: "single",
        metadata: JSON.stringify(metadata),
      });
    expect(
      counts([
        single(0, { changedFields: ["headline"] }),
        single(1, { published: true }),
        single(2, { changedFields: ["headline"] }),
      ])
    ).toEqual([1, 1, 1]);
  });

  it("keeps an entry's update that records no changed fields out of a run", () => {
    // Written before changed fields were recorded, or by a save that changed
    // nothing: either way it cannot show it was not a publish.
    expect(
      counts([
        row({ createdAt: before(0), metadata: null }),
        row({ createdAt: before(1), metadata: null }),
      ])
    ).toEqual([1, 1]);
  });

  it("still joins a Single's saves written before they recorded changed fields", () => {
    expect(
      counts([
        row({ createdAt: before(0), subjectKind: "single", metadata: null }),
        row({ createdAt: before(1), subjectKind: "single", metadata: null }),
      ])
    ).toEqual([2]);
  });

  it("takes in a save of an already published entry that changed only its title", () => {
    // `status` is listed only when it changed: a plain save of a live document
    // carries no `status`, so it joins the run before it.
    expect(
      counts([
        row({ createdAt: before(0) }),
        row({
          createdAt: before(1),
          metadata: { changedFields: ["title", "updatedAt"] },
        }),
      ])
    ).toEqual([2]);
  });

  it("names the run's newest row and its oldest", () => {
    const newest = row({ createdAt: before(0) });
    const middle = row({ createdAt: before(1) });
    const oldest = row({ createdAt: before(2) });
    const [run] = runsOf([newest, middle, oldest]);
    expect(run).toEqual({ latest: newest, oldest, count: 3 });
  });
});

describe("what a row changed", () => {
  it("reads the changed fields from stored text or a decoded object, and nothing else", () => {
    expect(changedFieldsOf('{"changedFields":["title"]}')).toEqual(["title"]);
    expect(changedFieldsOf({ changedFields: ["title", 3] })).toEqual(["title"]);
    expect(changedFieldsOf(null)).toBeUndefined();
    expect(changedFieldsOf("not json")).toBeUndefined();
    expect(changedFieldsOf({ changedFields: "title" })).toBeUndefined();
  });

  it("calls any change of status a status change, and only a lone one status-only", () => {
    const fields = (changedFields: string[]) => ({ changedFields });
    // A re-publish: status and the write's own stamp.
    expect(isStatusOnlyChange(fields(["status", "updatedAt"]))).toBe(true);
    // A first publish also stamps when the entry was first published.
    expect(
      isStatusOnlyChange(fields(["firstPublishedAt", "status", "updatedAt"]))
    ).toBe(true);
    // A save and publish together is a status change and not status-only.
    expect(changesStatus(fields(["status", "title", "updatedAt"]))).toBe(true);
    expect(isStatusOnlyChange(fields(["status", "title", "updatedAt"]))).toBe(
      false
    );
    // A save is neither, nor is a row that says nothing.
    expect(changesStatus(fields(["title", "updatedAt"]))).toBe(false);
    expect(isStatusOnlyChange(fields(["updatedAt"]))).toBe(false);
    expect(changesStatus(null)).toBe(false);
    expect(isStatusOnlyChange(null)).toBe(false);
  });

  it("reads a publish from its mark, apart from whether the status changed", () => {
    expect(publishes('{"changedFields":["title"],"published":true}')).toBe(
      true
    );
    expect(publishes({ published: "yes" })).toBe(false);
    expect(publishes({ changedFields: ["status"] })).toBe(false);
    expect(publishes(null)).toBe(false);
    // `changesStatus` stays literal: a promotion published, and changed no status.
    expect(changesStatus({ changedFields: ["title"], published: true })).toBe(
      false
    );
  });

  it("tells a save of a document's content from a change to whether it is live", () => {
    const update = (metadata: unknown) => isContentSave("update", metadata);
    expect(isContentSave("create", null)).toBe(true);
    expect(isContentSave("delete", null)).toBe(false);
    // A save, and a save and first publish together, made by one person.
    expect(update({ changedFields: ["title", "updatedAt"] })).toBe(true);
    expect(
      update({ changedFields: ["status", "title"], published: true })
    ).toBe(true);
    // A publish or an unpublish on its own is not a save.
    expect(update({ changedFields: ["status", "updatedAt"] })).toBe(false);
    expect(
      update({ changedFields: ["firstPublishedAt", "status"], published: true })
    ).toBe(false);
    // 🔴 Nor is a promotion, though its changed fields name content: the edits
    // it put live were each recorded when they were saved.
    expect(update({ changedFields: ["title"], published: true })).toBe(false);
    expect(update({ published: true })).toBe(false);
    // A row that does not say what it changed was a save by somebody.
    expect(update(null)).toBe(true);
  });
});

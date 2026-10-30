/**
 * The event a trail row records, as Team activity names it: read from the
 * row's action and the marks a publish writes, the same marks Continue where
 * you left off reads to tell a publish from a save. None for a row whose record leaves the
 * operation open, by the rule the feed's runs read it by, and none for an
 * install-level settings change, which is no entry's or Single's event.
 */
import { describe, expect, it } from "vitest";

import { EMAIL_PROVIDER_ACTIVITY_COLLECTION } from "../../../domains/email/provider-activity";
import { activityEventOf, isContentSave } from "../activity-changes";
import { runKeyOf } from "../activity-runs";

/** An entry's row of the trail, as the feed reads it. */
const entryRow = (action: string, metadata: unknown) => ({
  action,
  metadata,
  subjectKind: "collection",
  collection: "posts",
});

describe("the event a trail row records", () => {
  it.each([
    ["a create", "create", null, "created"],
    ["a delete", "delete", null, "deleted"],
    ["an edit", "update", { changedFields: ["title"] }, "saved"],
    [
      "a first publish",
      "update",
      { changedFields: ["status", "firstPublishedAt"], published: true },
      "published",
    ],
    // Its status was already published, so only the mark says it went live.
    [
      "a promotion of pending edits",
      "update",
      { changedFields: ["title"], published: true },
      "published",
    ],
    [
      "a publish that carried edits of its own",
      "update",
      {
        changedFields: ["status", "title"],
        published: true,
        publishedWithEdits: true,
      },
      "published",
    ],
    // Every path that publishes writes the mark, so a status change without it took the
    // document out of live.
    ["an unpublish", "update", { changedFields: ["status"] }, "unpublished"],
    [
      "an unpublish with an edit",
      "update",
      { changedFields: ["status", "title"] },
      "unpublished",
    ],
  ])("names %s", (_, action, metadata, event) => {
    expect(activityEventOf(entryRow(action, metadata))).toBe(event);
  });

  it("reads metadata stored as JSON text as the decoded object", () => {
    expect(
      activityEventOf(
        entryRow(
          "update",
          JSON.stringify({ changedFields: ["status"], published: true })
        )
      )
    ).toBe("published");
  });

  it("names nothing for an action the trail does not write", () => {
    expect(activityEventOf(entryRow("login", null))).toBeUndefined();
  });

  it("never calls a row a save that Recently edited declines to call one", () => {
    // A publish on its own, and a promotion that carried no edits: Recently edited does not take
    // them as the document's latest save, and Team activity does not call them saves.
    for (const metadata of [
      { changedFields: ["status"], published: true },
      { changedFields: ["title"], published: true },
    ]) {
      expect(isContentSave("update", metadata)).toBe(false);
      expect(activityEventOf(entryRow("update", metadata))).toBe("published");
    }
  });

  it("names nothing for an entry's update that does not say what it did, as the runs read it", () => {
    // Written before the changed fields were recorded, or by a save that changed nothing: it may
    // have been a publish or an unpublish, so it is no save. The runs keep it out of a run for
    // the same reason, by the same rule; an edit that says what it changed is the control.
    for (const metadata of [null, {}, JSON.stringify({})]) {
      const row = {
        ...entryRow("update", metadata),
        entryId: "p1",
        userId: "u1",
      };
      expect(activityEventOf(row)).toBeUndefined();
      expect(runKeyOf(row)).toBeUndefined();
    }
    const edit = {
      ...entryRow("update", { changedFields: ["title"] }),
      entryId: "p1",
      userId: "u1",
    };
    expect(activityEventOf(edit)).toBe("saved");
    expect(runKeyOf(edit)).toBeDefined();
  });

  it("reads a Single's update that does not say what it did as a save, as its runs always have", () => {
    const row = {
      action: "update",
      metadata: null,
      subjectKind: "single",
      collection: "home",
      entryId: "s1",
      userId: "u1",
    };
    expect(activityEventOf(row)).toBe("saved");
    expect(runKeyOf(row)).toBeDefined();
  });

  it.each(["create", "update", "delete"])(
    "names nothing for a settings change's %s, which is no entry's or Single's event",
    action => {
      // Stated as a settings change, and one filed under a settings namespace before the kind was
      // recorded; the same change recorded against an entry is the control.
      expect(
        activityEventOf({
          action,
          metadata: { changedFields: ["host"] },
          subjectKind: "settings",
          collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
        })
      ).toBeUndefined();
      expect(
        activityEventOf({
          action,
          metadata: { changedFields: ["host"] },
          subjectKind: null,
          collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
        })
      ).toBeUndefined();
      expect(
        activityEventOf(entryRow(action, { changedFields: ["host"] }))
      ).toBeDefined();
    }
  );
});

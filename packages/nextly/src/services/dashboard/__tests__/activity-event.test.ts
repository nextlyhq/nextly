/**
 * The event a trail row records, as Team activity names it: read from the
 * row's action and the marks a publish writes, the same marks Recently edited
 * reads to tell a publish from a save.
 */
import { describe, expect, it } from "vitest";

import { activityEventOf, isContentSave } from "../activity-changes";

describe("the event a trail row records", () => {
  it.each([
    ["a create", "create", null, "created"],
    ["a delete", "delete", null, "deleted"],
    ["an edit", "update", { changedFields: ["title"] }, "saved"],
    // Written before the changed fields were recorded: a person still saved it.
    ["an update that does not say what it changed", "update", null, "saved"],
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
    expect(activityEventOf(action, metadata)).toBe(event);
  });

  it("reads metadata stored as JSON text as the decoded object", () => {
    expect(
      activityEventOf(
        "update",
        JSON.stringify({ changedFields: ["status"], published: true })
      )
    ).toBe("published");
  });

  it("names nothing for an action the trail does not write", () => {
    expect(activityEventOf("login", null)).toBeUndefined();
  });

  it("never calls a row a save that Recently edited declines to call one", () => {
    // A publish on its own, and a promotion that carried no edits: Recently edited does not take
    // them as the document's latest save, and Team activity does not call them saves.
    for (const metadata of [
      { changedFields: ["status"], published: true },
      { changedFields: ["title"], published: true },
    ]) {
      expect(isContentSave("update", metadata)).toBe(false);
      expect(activityEventOf("update", metadata)).toBe("published");
    }
  });
});
